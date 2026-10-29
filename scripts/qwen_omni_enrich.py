#!/usr/bin/env python3
"""Optional audio/video enrichment for ReelBench video-shots JSON.

This stage never computes or edits machine-derived cut boundaries or motion.
It reads a local video and shots.json, uploads the clip to DashScope's temporary
storage, calls Qwen3.8-Omni-Flash once, and aligns returned speech/audio notes
to the existing shot intervals. API credentials are read only from the process
environment; request URLs and credentials are never written to artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

MODEL = "qwen3.8-omni-flash"
VALID_CONFIDENCE = {"high", "medium", "low", "unknown"}
VALID_CAPTION_MATCH = {"match", "conflict", "not_visible", "unknown"}

PROMPT = """请把这段视频作为音视频材料整体分析，输出严格 JSON，不要 Markdown 代码块。

目标：尽量完整、逐句转写实际听到的中文口播/对白；识别画内说话人，标注语气和可确认的音乐/环境声/动作声，并给每句标注大致起止秒数。画面字幕只用来核对，不可据字幕补造听不清的词；字幕和声音冲突时按声音转写并标 conflict；声音听不清就保留 [听不清]，降低 confidence，不要猜。情绪只依据可听到的音高、力度、语速、笑声和停顿判断；不要把面部表情当成声音证据。说话人能从画面确认时用 P1、P2，否则用 unknown；画外音用 VO。

按完整语义短句分段，尽量让每段不跨明显硬切；时间戳用视频起点的秒数，可到 0.1 秒，不要伪装成逐字级精确。每个 segment 的时间必须在片长内。

仅输出以下 JSON 结构：
{
  "transcript_segments": [
    {"start_s": 0.0, "end_s": 1.4, "speaker_id": "P1", "text": "逐字口播", "emotion": "开心兴奋/平静/不确定等；无明显情绪写 neutral", "emotion_evidence": "仅写听觉依据；没有写 none", "confidence": "high|medium|low|unknown", "caption_match": "match|conflict|not_visible|unknown"}
  ],
  "sound_events": [
    {"start_s": 0.0, "end_s": 2.0, "kind": "music|ambience|sfx|nonverbal", "description": "可听到的声音", "confidence": "high|medium|low|unknown"}
  ],
  "overall_notes": "音轨总体情况；没有则写空字符串"
}

没有听到的台词不要因为画面上有字幕就伪装成已听清。"""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def extract_text(response: dict[str, Any]) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"]
    fragments: list[str] = []
    for item in response.get("output", []) if isinstance(response.get("output"), list) else []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) if isinstance(item.get("content"), list) else []:
            if isinstance(content, dict) and content.get("type") in {"output_text", "text"}:
                value = content.get("text")
                if isinstance(value, str):
                    fragments.append(value)
    if fragments:
        return "\n".join(fragments)
    raise ValueError("Responses API response had no text output")


def parse_model_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.S | re.I)
    if fenced:
        stripped = fenced.group(1)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Model output was not valid JSON")
        parsed = json.loads(stripped[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Model JSON root must be an object")
    return parsed


def validate_analysis(data: dict[str, Any], duration: float) -> dict[str, Any]:
    segments = data.get("transcript_segments")
    events = data.get("sound_events", [])
    if not isinstance(segments, list) or not isinstance(events, list):
        raise ValueError("JSON must contain transcript_segments and sound_events arrays")
    cleaned_segments: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise ValueError(f"transcript_segments[{index}] must be an object")
        start = segment.get("start_s")
        end = segment.get("end_s")
        text = segment.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(f"transcript_segments[{index}] needs numeric start_s/end_s")
        if start < 0 or end <= start or end > duration + 0.25:
            raise ValueError(f"transcript_segments[{index}] has time outside the source duration")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"transcript_segments[{index}].text is empty")
        confidence = str(segment.get("confidence", "unknown")).lower()
        if confidence not in VALID_CONFIDENCE:
            confidence = "unknown"
        caption_match = str(segment.get("caption_match", "unknown")).lower()
        if caption_match not in VALID_CAPTION_MATCH:
            caption_match = "unknown"
        cleaned_segments.append({
            "start_s": round(float(start), 3),
            "end_s": round(float(end), 3),
            "speaker_id": str(segment.get("speaker_id") or "unknown"),
            "text": text.strip(),
            "emotion": str(segment.get("emotion") or "unknown"),
            "emotion_evidence": str(segment.get("emotion_evidence") or "none"),
            "confidence": confidence,
            "caption_match": caption_match,
        })
    cleaned_events: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise ValueError(f"sound_events[{index}] must be an object")
        start = event.get("start_s")
        end = event.get("end_s")
        desc = event.get("description")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(f"sound_events[{index}] needs numeric start_s/end_s")
        if start < 0 or end <= start or end > duration + 0.25:
            raise ValueError(f"sound_events[{index}] has time outside the source duration")
        if not isinstance(desc, str) or not desc.strip():
            raise ValueError(f"sound_events[{index}].description is empty")
        confidence = str(event.get("confidence", "unknown")).lower()
        if confidence not in VALID_CONFIDENCE:
            confidence = "unknown"
        cleaned_events.append({
            "start_s": round(float(start), 3),
            "end_s": round(float(end), 3),
            "kind": str(event.get("kind") or "nonverbal"),
            "description": desc.strip(),
            "confidence": confidence,
        })
    cleaned_segments.sort(key=lambda item: (item["start_s"], item["end_s"]))
    cleaned_events.sort(key=lambda item: (item["start_s"], item["end_s"]))
    return {
        "transcript_segments": cleaned_segments,
        "sound_events": cleaned_events,
        "overall_notes": str(data.get("overall_notes") or "").strip(),
    }


def map_analysis_to_shots(shots_doc: dict[str, Any], analysis: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    shots = shots_doc.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("shots.json has no shots array")
    duration = float((shots_doc.get("meta") or {}).get("durationSeconds") or shots[-1].get("end") or 0)
    if duration <= 0:
        raise ValueError("Cannot determine source duration")
    validated = validate_analysis(analysis, duration)
    result = json.loads(json.dumps(shots_doc, ensure_ascii=False))
    shot_state: dict[str, dict[str, Any]] = {}
    for shot in result["shots"]:
        shot_id = str(shot["id"])
        shot_state[shot_id] = {"speech": [], "continuations": [], "events": [], "tone": []}
        old_audio = str(shot.get("audio") or "").strip()
        if old_audio and not shot.get("subtitleEvidence"):
            shot["subtitleEvidence"] = old_audio
    mapped_segments: list[dict[str, Any]] = []
    for index, segment in enumerate(validated["transcript_segments"], start=1):
        overlaps: list[tuple[float, dict[str, Any]]] = []
        for shot in result["shots"]:
            overlap = max(0.0, min(segment["end_s"], float(shot["end"])) - max(segment["start_s"], float(shot["start"])))
            if overlap > 0:
                overlaps.append((overlap, shot))
        if not overlaps:
            continue
        overlaps.sort(key=lambda item: (-item[0], float(item[1]["start"])))
        primary = overlaps[0][1]
        shot_ids = [str(shot["id"]) for _, shot in sorted(overlaps, key=lambda item: float(item[1]["start"]))]
        segment_id = f"A{index:03d}"
        enriched = {**segment, "id": segment_id, "shot_ids": shot_ids, "primary_shot_id": str(primary["id"])}
        mapped_segments.append(enriched)
        for _, shot in overlaps:
            state = shot_state[str(shot["id"])]
            state["tone"].append({
                "segment_id": segment_id,
                "speaker_id": segment["speaker_id"],
                "emotion": segment["emotion"],
                "emotion_evidence": segment["emotion_evidence"],
                "confidence": segment["confidence"],
            })
            if shot["id"] == primary["id"]:
                state["speech"].append(enriched)
            else:
                state["continuations"].append(segment_id)
    mapped_events: list[dict[str, Any]] = []
    for index, event in enumerate(validated["sound_events"], start=1):
        event_id = f"E{index:03d}"
        ids = []
        for shot in result["shots"]:
            overlap = max(0.0, min(event["end_s"], float(shot["end"])) - max(event["start_s"], float(shot["start"])))
            if overlap > 0:
                ids.append(str(shot["id"]))
                shot_state[str(shot["id"])]["events"].append({**event, "id": event_id})
        mapped_events.append({**event, "id": event_id, "shot_ids": ids})
    for shot in result["shots"]:
        state = shot_state[str(shot["id"])]
        speech = sorted(state["speech"], key=lambda item: item["start_s"])
        old_evidence = str(shot.get("subtitleEvidence") or "").strip()
        rendered: list[str] = []
        for segment in speech:
            rendered.append(
                f"{segment['speaker_id']}（语气：{segment['emotion']}；听辨：{segment['confidence']}；"
                f"{segment['start_s']:.1f}–{segment['end_s']:.1f}s）：{segment['text']}"
            )
        if state["continuations"]:
            rendered.append("延续到本镜：" + ", ".join(state["continuations"]) + "（完整句在语音转写表）")
        for event in state["events"]:
            if event["confidence"] in {"high", "medium"}:
                rendered.append(f"{event['kind']}（{event['confidence']}）：{event['description']}")
        if not rendered and old_evidence:
            rendered.append("未识别到清晰人声；保留的画面字幕线索（未当作听辨台词）：" + old_evidence)
        if not rendered and str(shot.get("category")) == "dialogue":
            rendered.append("模型未识别到可确认口播；需人工复核")
        shot["audio"] = "；".join(rendered)
        shot["audioSegments"] = [item["id"] for item in speech]
        shot["audioContinuation"] = sorted(set(state["continuations"]))
        shot["audioTone"] = state["tone"]
    result["audioAnalysis"] = {
        "model": MODEL,
        "source": "user-authorized Qwen Omni multimodal pass",
        "transcriptSegments": mapped_segments,
        "soundEvents": mapped_events,
        "overallNotes": validated["overall_notes"],
        "timestampNote": "Qwen timestamps are approximate model estimates; ReelBench shot boundaries remain the machine source of truth.",
    }
    return result, result["audioAnalysis"]


def extract_model_text(api_result: dict[str, Any]) -> str:
    if isinstance(api_result.get("output_text"), str):
        return api_result["output_text"]
    choices = api_result.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            pieces = [item.get("text", "") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
            if pieces:
                return "\n".join(pieces)
    pieces: list[str] = []
    for item in api_result.get("output", []) if isinstance(api_result.get("output"), list) else []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) if isinstance(item.get("content"), list) else []:
            if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                pieces.append(content["text"])
    if not pieces:
        raise ValueError("Model response had no text output")
    return "\n".join(pieces)


def upload_video_temp(path: Path, api_key: str, base_url: str) -> str:
    import requests
    root = urllib.parse.urlsplit(base_url)
    origin = f"{root.scheme}://{root.netloc}"
    policy_url = origin + "/api/v1/uploads"
    policy_response = requests.get(
        policy_url,
        params={"action": "getPolicy", "model": MODEL},
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=60,
    )
    if policy_response.status_code != 200:
        raise RuntimeError(f"DashScope temporary upload policy failed: HTTP {policy_response.status_code}")
    policy_data = policy_response.json().get("data")
    if not isinstance(policy_data, dict):
        raise RuntimeError("DashScope temporary upload policy response has no data object")
    file_key = f"{policy_data['upload_dir']}/video-shots-{sha256_file(path)[:12]}.mp4"
    with path.open("rb") as video_file:
        files = {
            "OSSAccessKeyId": (None, policy_data["oss_access_key_id"]),
            "Signature": (None, policy_data["signature"]),
            "policy": (None, policy_data["policy"]),
            "x-oss-object-acl": (None, policy_data["x_oss_object_acl"]),
            "x-oss-forbid-overwrite": (None, policy_data["x_oss_forbid_overwrite"]),
            "key": (None, file_key),
            "success_action_status": (None, "200"),
            "file": (f"video-shots-{sha256_file(path)[:12]}.mp4", video_file, "video/mp4"),
        }
        upload_response = requests.post(policy_data["upload_host"], files=files, timeout=300)
    if upload_response.status_code != 200:
        raise RuntimeError(f"DashScope temporary video upload failed: HTTP {upload_response.status_code}")
    return "oss://" + file_key


def safe_api_error(response: Any) -> dict[str, Any]:
    details: dict[str, Any] = {"http_status": int(response.status_code)}
    try:
        body = response.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        for key in ("code", "request_id"):
            value = body.get(key)
            if isinstance(value, (str, int, float)):
                details[key] = str(value)[:160]
        error = body.get("error")
        message = body.get("message")
        if isinstance(error, dict):
            details["error_type"] = str(error.get("type", ""))[:100]
            message = message or error.get("message") or error.get("code")
            details["code"] = str(body.get("code") or error.get("code") or "")[:160]
        elif error and not details.get("code"):
            details["error_type"] = str(error)[:100]
        if isinstance(message, str) and message:
            message = re.sub(r"(?i)bearer\s+[^\s]+", "Bearer [redacted]", message)
            message = re.sub(r"sk-[A-Za-z0-9_.-]{8,}", "[redacted-key]", message)
            message = re.sub(r"oss://[^\s,\"']+", "[temporary-url-redacted]", message)
            message = re.sub(r"https?://[^\s,\"']+", "[url-redacted]", message)
            details["message"] = message[:400]
    return details


def request_qwen(video_url: str, base_url: str, api_key: str, error_path: Path) -> dict[str, Any]:
    import requests
    # Use the official Chat Completions video content shape (video_url object),
    # which is the documented route for DashScope temporary OSS video URLs.
    endpoint = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "video_url", "video_url": {"url": video_url}},
                {"type": "text", "text": PROMPT},
            ],
        }],
        "reasoning_effort": "none",
        "max_tokens": 6000,
        "modalities": ["text"],
        "stream": False,
    }
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-OssResourceResolve": "enable",
        },
        json=payload,
        timeout=(30, 600),
    )
    if response.status_code != 200:
        details = safe_api_error(response)
        atomic_write_json(error_path, details)
        raise RuntimeError(f"Qwen Omni request failed: {json.dumps(details, ensure_ascii=False)}")
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Qwen Omni response is not a JSON object")
    return data


def render_transcript(analysis: dict[str, Any]) -> str:
    lines = ["# Qwen Omni 音频/视频补充分析", "", "> 口播时间为模型估计；逐镜切点仍以 shots.json 的 ffmpeg/ffprobe 机器结果为准。低置信度和字幕冲突项请人工复核。", "", "## 逐句口播"]
    for segment in analysis["transcriptSegments"]:
        shot_ids = ", ".join(segment["shot_ids"]) or "未对齐"
        evidence = segment.get("emotion_evidence", "none")
        lines.append(
            f"- **{segment['start_s']:.1f}–{segment['end_s']:.1f}s** · {segment['speaker_id']} · "
            f"{segment['emotion']} · 置信度 {segment['confidence']} · 镜头 {shot_ids}\n  {segment['text']}\n  声学依据：{evidence}；画面字幕核对：{segment['caption_match']}"
        )
    if not analysis["transcriptSegments"]:
        lines.append("模型没有返回可确认的台词段。")
    lines.extend(["", "## 音乐/环境声/动作声"])
    for event in analysis["soundEvents"]:
        lines.append(f"- {event['start_s']:.1f}–{event['end_s']:.1f}s · {event['kind']} · 置信度 {event['confidence']} · 镜头 {', '.join(event['shot_ids']) or '未对齐'}：{event['description']}")
    if not analysis["soundEvents"]:
        lines.append("没有返回高置信度的独立声音事件。")
    lines.extend(["", "## 总体说明", analysis.get("overallNotes") or "无补充说明。", ""])
    return "\n".join(lines)


def run(args: argparse.Namespace) -> int:
    video = args.video.expanduser().resolve()
    shots_path = args.shots.expanduser().resolve()
    out_dir = args.output_dir.expanduser().resolve()
    if not video.is_file() or not shots_path.is_file():
        raise FileNotFoundError("视频文件或 shots.json 不存在")
    shots_doc = json.loads(shots_path.read_text(encoding="utf-8"))
    duration = float((shots_doc.get("meta") or {}).get("durationSeconds") or 0)
    if duration <= 0:
        raise ValueError("shots.json 缺少有效 meta.durationSeconds")
    base_url = (args.base_url or os.environ.get("DASHSCOPE_BASE_URL") or "").strip()
    if not base_url:
        raise ValueError("请通过 --base-url 或 DASHSCOPE_BASE_URL 设置百炼兼容 API 地址")
    if args.response_file:
        data = json.loads(args.response_file.read_text(encoding="utf-8"))
        model_text = data.get("output_text") if isinstance(data, dict) else None
        if not isinstance(model_text, str):
            model_text = json.dumps(data, ensure_ascii=False)
    elif not args.execute:
        preview = {
            "mode": "dry-run",
            "model": MODEL,
            "video": {"path": str(video), "size_bytes": video.stat().st_size, "sha256": sha256_file(video)},
            "shots_json": str(shots_path),
            "shot_count": len(shots_doc.get("shots", [])),
            "request_route": base_url.rstrip("/") + "/chat/completions",
            "api_key_source": "DASHSCOPE_API_KEY environment variable (value not displayed)",
            "store": False,
        }
        out_dir.mkdir(parents=True, exist_ok=True)
        atomic_write_json(out_dir / "request-preview.json", preview)
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0
    else:
        api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
        if not api_key:
            raise ValueError("DASHSCOPE_API_KEY is not set; no request was sent")
            out_dir.mkdir(parents=True, exist_ok=True)
        print("Uploading source video to DashScope temporary storage…", file=sys.stderr)
        video_url = upload_video_temp(video, api_key, base_url)
        print("Submitting one Qwen3.8-Omni-Flash analysis request…", file=sys.stderr)
        api_response = request_qwen(video_url, base_url, api_key, out_dir / "api-error.json")
        model_text = extract_model_text(api_response)
        # Save only the model text/usage/request id. Never save the temporary OSS URL or API key.
        atomic_write_json(out_dir / "api-result.json", {
            "request_id": api_response.get("id") or api_response.get("request_id"),
            "model": api_response.get("model", MODEL),
            "usage": api_response.get("usage"),
            "output_text": model_text,
        })
    parsed = parse_model_json(model_text)
    final_shots, analysis = map_analysis_to_shots(shots_doc, parsed)
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_json = {
        "model": MODEL,
        "source_video_sha256": sha256_file(video),
        "frame_sampling": "provider-managed by Chat Completions video input",
        "duration_seconds": duration,
        **analysis,
    }
    atomic_write_json(out_dir / "audio-analysis.json", audio_json)
    (out_dir / "audio-transcript.md").write_text(render_transcript(audio_json), encoding="utf-8")
    if args.apply:
        backup = shots_path.with_name("shots.before-qwen-omni.json")
        if not backup.exists():
            backup.write_text(shots_path.read_text(encoding="utf-8"), encoding="utf-8")
        atomic_write_json(shots_path, final_shots)
        print(f"Applied audio enrichment to {shots_path}; backup: {backup}")
    else:
        atomic_write_json(out_dir / "shots-enriched.json", final_shots)
        print(f"Created {out_dir / 'shots-enriched.json'}; source shots.json unchanged (pass --apply to replace).")
    print(f"Transcript segments: {len(analysis['transcriptSegments'])}; sound events: {len(analysis['soundEvents'])}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--shots", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-url", help="OpenAI-compatible DashScope base URL; not stored in output")
    parser.add_argument("--execute", action="store_true", help="Upload video and make one paid API request")
    parser.add_argument("--response-file", type=Path, help="Offline test: merge a supplied model JSON response without network")
    parser.add_argument("--apply", action="store_true", help="Replace shots.json after all validation passes; makes a backup first")
    args = parser.parse_args()
    if args.execute and args.response_file:
        parser.error("--execute and --response-file cannot be used together")
    try:
        return run(args)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError, KeyError, ImportError) as exc:
        # Avoid printing request bodies, headers, signed URLs, or secrets.
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
