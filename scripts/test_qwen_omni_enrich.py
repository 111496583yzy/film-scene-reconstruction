#!/usr/bin/env python3
"""Offline regression tests for the optional Qwen Omni merge stage."""
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("qwen_omni_enrich.py")
spec = importlib.util.spec_from_file_location("qwen_omni_enrich", SCRIPT)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class QwenOmniMergeTests(unittest.TestCase):
    def setUp(self):
        self.shots = {
            "meta": {"durationSeconds": 5.0},
            "shots": [
                {"id": "S01", "start": 0.0, "end": 2.0, "seconds": 2.0, "motion": 5.2, "category": "dialogue", "audio": "字幕旧证据"},
                {"id": "S02", "start": 2.0, "end": 5.0, "seconds": 3.0, "motion": 3.1, "category": "subject", "audio": ""},
            ],
        }

    def test_sentence_crossing_cut_maps_without_changing_machine_fields(self):
        data = {"transcript_segments": [{"start_s": 1.5, "end_s": 3.2, "speaker_id": "P1", "text": "你好。", "emotion": "开心", "emotion_evidence": "语速快、音高上扬", "confidence": "high", "caption_match": "match"}], "sound_events": []}
        merged, analysis = mod.map_analysis_to_shots(self.shots, data)
        seg = analysis["transcriptSegments"][0]
        self.assertEqual(seg["shot_ids"], ["S01", "S02"])
        self.assertEqual(seg["primary_shot_id"], "S02")
        for i in range(2):
            for field in ("start", "end", "seconds", "motion"):
                self.assertEqual(merged["shots"][i][field], self.shots["shots"][i][field])
        self.assertIn("你好。", merged["shots"][1]["audio"])
        self.assertIn("A001", merged["shots"][0]["audio"])

    def test_uncertain_audio_keeps_caption_as_unverified_evidence(self):
        data = {"transcript_segments": [], "sound_events": [], "overall_notes": "未听清"}
        merged, _ = mod.map_analysis_to_shots(self.shots, data)
        self.assertIn("字幕旧证据", merged["shots"][0]["audio"])
        self.assertIn("未识别到清晰人声", merged["shots"][0]["audio"])

    def test_bad_timestamps_are_rejected_before_mutation(self):
        data = {"transcript_segments": [{"start_s": -0.2, "end_s": 1.0, "text": "错"}], "sound_events": []}
        with self.assertRaises(ValueError):
            mod.map_analysis_to_shots(self.shots, data)


    def test_chat_completion_text_extraction(self):
        response = {"choices": [{"message": {"content": "\n{\"transcript_segments\":[],\"sound_events\":[]}\n"}}]}
        self.assertIn("transcript_segments", mod.extract_model_text(response))

    def test_bad_json_and_fenced_json(self):
        with self.assertRaises(ValueError):
            mod.parse_model_json("not-json")
        parsed = mod.parse_model_json('```json\n{"transcript_segments":[],"sound_events":[]}\n```')
        self.assertEqual(parsed["transcript_segments"], [])


if __name__ == "__main__":
    unittest.main()
