# 可选原视频模型复核

用于进一步分析视野倾向、机位/人物运动与来光证据，不把模型估计当成真实摄影参数。正常本地拉片仍不需要密钥。配置存在不等于未来所有素材都获准上传；仅在用户授权当前素材的外部模型分析后执行。

## 配置与当前验证

配置放在 Skill 和报告目录之外，例如 `~/.codex/secrets/film-scene-reconstruction.env`，权限0600。命令行只传配置文件路径，不传密钥；密钥不进日志、HTML、ZIP或镜头JSON。

适配器使用的变量均带 `FILM_ANALYSIS_` 前缀，完整示例见 [`.env.example`](../.env.example)：

| 配置 | 用途 |
| --- | --- |
| `INPUT_MODE` | 默认 `upload_url`：先上传，再提交视频 URL；只有明确选择 `inline` 才使用原来的内联视频方式，不自动回退 |
| `UPLOAD_API_URL` | RunningHub 风格上传接口的完整 HTTPS 地址；必须从所用平台的文档核对，不从 LLM Base URL 拼接 |
| `UPLOAD_API_KEY` | 可选的上传专用密钥；留空则使用 `API_KEY`，上传认证为 Bearer |
| `MAX_UPLOAD_BYTES` / `UPLOAD_TIMEOUT_SECONDS` | 本机原视频字节预算 / 上传超时预算；上传超时不填时沿用 `TIMEOUT_SECONDS` |
| `PROVIDER` / `API_BASE_URL` / `MODEL` / `API_KEY` | 模型网关、原模型名和认证，不写死模型或环境地址 |
| `PROTOCOL` / `REQUEST_PATH` | `gemini_generate_content`；路径从网关官方示例核对，保留 `{model}` 占位 |
| `AUTH_HEADER` / `AUTH_SCHEME` | 模型接口的认证位置与前缀 |
| `MAX_REQUEST_BYTES` / `MAX_OUTPUT_TOKENS` / `TIMEOUT_SECONDS` | 模型 JSON 请求体大小 / 输出 / 超时的本机预算，与上传原文件的大小预算分开 |
| `VIDEO_FPS` | 可选的上游采样率请求；不声称上游一定逐帧采用 |

这些预算不是平台或模型的能力上限。不要仅因原文件大于 `MAX_REQUEST_BYTES` 就放弃 URL 复核，也不要为过预算偷偷改配置或转码；超过的是哪一项，就明确报告哪一项。

RunningHub 的[新上传接口](https://www.runninghub.ai/runninghub-api-doc-en/api-425761098)使用 `multipart/form-data` 的 `file` 字段；全球站文档示例为 `https://www.runninghub.ai/openapi/v2/media/upload/binary`。[中国站文档](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749007)给出中国站地址。把与密钥地区/账号匹配的**最终完整地址**填入本机配置，不自动轮询 `.cn` / `.ai` 或跟随重定向。示例响应存在 `code:0` / `code:200` 两种成功形式，适配器均接受，但仍要求有效的 `data.download_url`；`fileName` / `filename` 只是工作流内部路径，不拼成外链。临时链接会过期，不能当长期素材存储。

模型接入见 [RunningHub 模型目录](https://www.runninghub.ai/zh-cn/call-api/llm/models) 与[官方入门](https://www.runninghub.ai/runninghub-api-doc-en/)。原生 Gemini 使用 `/v1beta/models/{model}:generateContent`，模型名保留厂商前缀与斜线。LLM API 需要相应的 Enterprise-Shared Key；模型卡只标图片输入不能证明视频已开放。

[Google 文件输入文档](https://ai.google.dev/gemini-api/docs/generate-content/file-input-methods)描述 `fileData.fileUri` / `file_uri` 视频 URL 输入和签名 URL；`mimeType` 为视频类型，`videoMetadata` 可附采样请求。这证明协议形式，不替代网关实测。网关、所用模型、上传接口和文件大小限制各自核对，不把一次 URL 成功或 VIDEO 用量记录推广为所有模型都支持。

## 两阶段执行

先完成并验证本地镜头底稿，再dry-run：

```bash
python3 {baseDir}/scripts/video_model_enrich.py \
  --video <原视频> --shots shots.json --scene scene.json \
  --output-dir model-analysis/run
```

默认 URL 模式的 dry-run 校验视频与底稿的片长、尺寸和来源，显示文件哈希、原视频大小、输入方式、两个接口及各自预算；不读成 base64、不上传、不请求模型，也不预造视频 URL。此时 `request_bytes` 尚未知，`request_bytes_minimum` 只是不含实际 URL 的本地 JSON 大小下限。缺上传配置就说明缺什么，不擅自回到内联方式。

确认当前素材已获授权后，使用同一命令加 `--execute`：

1. 建立排他请求账本 `request-status.json`，再上传原始视频字节，保留原音轨，不转码、不抽帧。上传失败、缺少 URL、资源类型/返回大小不符时停止，不调用模型。
2. 上传成功后，原生 Gemini 请求只带 `fileData:{mimeType:"video/mp4",fileUri:<download_url>}` 与分析提示词，发起一次模型请求；不把 URL 当普通文字让模型猜内容。实际 JSON 请求大小另行检查。
3. 分别记录上传与模型阶段、尝试次数和结果。任一步失败、超时、URL 过期或中断都不自动重传、不重试模型、不换域名、不改输入方式。同目录账本会阻止重复执行；不要通过换目录绕过它，需先核查状态/费用并取得新的调用授权。
4. 密钥不放 URL 查询参数；带密钥请求不跟随重定向。上传只发到显式配置的上传接口；模型密钥只发到其配置的同源路由。返回的临时视频 URL 仅在内存中交给模型，不写进日志、JSON 候选或 HTML；落盘结果和报错会去除密钥与签名链接。
5. 保存去敏的 `provider-response.json`，将**同一候选内的文本片段按原顺序无缝拼接**，不在 JSON 的半个词或字符串中间加换行、不拼接多个候选。遇到截断或无效 JSON 就保留响应停止，不再发模型请求；解析修复只能离线进行。
6. 先保存候选，验证镜号覆盖、证据时间、数值前提和等效口径。HTTP 成功、模型自称“看过”或格式验证通过都不证明观察正确；检查上游 VIDEO 用量，并逐镜对照片内独特细节，尤其检查黑场、分屏、叠化和后半段有无错位。

复核时同时保留原始结果，另存 `analysis-reviewed.json`：检查具体画面依据，做有明确前提的几何一致性检查。比如模型给了等效焦距与水平视角，两者口径未明确或不自洽就不同时采用；可保留低可信候选，也可不提供数值。镜号与画面错位、人数或场景不符时，不直接移植进报告；先离线校对，无法确认则保留原分析并说明未采用。不得为消除“未确认”而强行填数。

确认复核通过，在副本的 `provenance.review.approved` 记录true，再执行离线归并：

```bash
python3 {baseDir}/scripts/video_model_enrich.py \
  --video <原视频> --shots shots.json --scene scene.json \
  --output-dir model-analysis/run \
  --response-file model-analysis/run/analysis-reviewed.json --apply
```

归并前验证视频哈希、机器底稿绑定与场景结构；备份为 `scene.before-model.json`。已有备份或证据ID冲突会拒绝静默覆盖。默认只更新视野估计和其证据，不改时间轴、实测运动值、人物/摄影机轨迹，也不自动接受模型的语音转写。

## 显示与真实性

报告分开呈现“视野倾向/模型候选等效焦段”和“真实焦距/传感器/裁切待核实”。模型候选应显示假设、可信度、局限和可回看的依据。未标定视角仍由原有显示方案控制，不直接拿估计值改三维摄影机以冒充校准。

保存原音轨不等于音频逐句准确性已验收；上游自报听见声音也不能替代听写核对。本阶段默认不把台词写入主拉片，声音任务另行按授权执行。

## 自测

```bash
python3 {baseDir}/scripts/test_video_model_enrich.py
```

本地离线测试覆盖 URL 默认路径、原文件上传与视频 URL 请求的衔接、独立预算、无网络 dry-run、两种上传成功码、无效 URL / 上传错误、阶段记录、防重复与无重试、密钥/临时链接去敏、碎片化 JSON、镜头和证据范围，以及离线审核归并与原字段保护。它们不发出真实请求，不能说成真实上游测试；真实调用结果由该轮账本说明。
