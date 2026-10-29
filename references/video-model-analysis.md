# 可选原视频模型复核

用于进一步分析视野倾向、机位/人物运动与来光证据，不把模型估计当成真实摄影参数。正常本地拉片仍不需要密钥。配置存在不等于未来所有素材都获准上传；仅在用户授权当前素材的外部模型分析后执行。

## 配置与当前验证

配置放在 Skill 和报告目录之外，例如 `~/.codex/secrets/film-scene-reconstruction.env`，权限0600。命令行只传配置文件路径，不传密钥；密钥不进日志、HTML、ZIP或镜头JSON。

适配器从配置读取：

- FILM_ANALYSIS_PROVIDER、API_BASE_URL、MODEL、API_KEY（均以 FILM_ANALYSIS_ 为前缀）
- PROTOCOL=gemini_generate_content
- REQUEST_PATH：经所用网关官方示例核对，保留 `{model}` 占位
- AUTH_HEADER、AUTH_SCHEME：认证位置与前缀
- MAX_REQUEST_BYTES、MAX_OUTPUT_TOKENS、TIMEOUT_SECONDS：本机调用预算，不伪称模型能力上限
- VIDEO_FPS：可选，请求上游采样率；不声称上游一定逐帧采用

当前用户选择的 RunningHub 接入说明见 [模型目录](https://www.runninghub.ai/zh-cn/call-api/llm/models) 与 [官方入门](https://www.runninghub.ai/runninghub-api-doc-en/)。原生Gemini示例使用 `/v1beta/models/{model}:generateContent` 和 Bearer 认证，模型名保留厂商前缀与斜线。LLM API需要Enterprise-Shared Key；模型页仅写“图片输入”时不能据此断言视频已开放。

[Google GenerateContent文档](https://ai.google.dev/api/generate-content)定义了 `inlineData` 的 video MIME 与 videoMetadata；它证明原生协议格式，不代替网关的实际能力验证。当前本机这次8秒测试已返回VIDEO输入用量。不要把这个单次验证写死成所有平台、所有模型的能力。

## 两阶段执行

先完成并验证本地镜头底稿，再dry-run：

```bash
python3 {baseDir}/scripts/video_model_enrich.py \
  --video <原视频> --shots shots.json --scene scene.json \
  --output-dir model-analysis/run
```

dry-run显示模型、请求路径、输入类型、文件哈希和大小，不显示密钥、不上传。脚本校验视频与机器底稿的片长、尺寸和来源副本。确认授权与预算后才加 `--execute`：

- 直接提交原始视频字节（保留原音轨），不自动抽帧冒充原视频、不偷偷转码或上传其他平台。
- 原生视频请求只发一次；失败不重试。请求前写入账本，同目录已有账本就拒绝重复提交；超时不能声称没有计费。
- 带密钥请求不跟随重定向，认证不放URL查询参数，拒绝把密钥发往其他来源。
- 先保存去敏后的上游结果与候选JSON，验证镜号覆盖、证据时刻、数值、假设与等效口径。HTTP成功或模型自称“看过”不等于能力确认；查看上游VIDEO用量并对照片内独特细节。

复核时同时保留原始结果，另存 `analysis-reviewed.json`：检查具体画面依据，做有明确前提的几何一致性检查。比如模型给了等效焦距与水平视角，两者口径未明确或不自洽就不同时采用；可保留低可信候选，也可不提供数值。不得为消除“未确认”而强行填数。

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

本地模拟覆盖协议、密钥去敏、单次调用、无重定向、镜头和证据范围、估计前提、重复归并与原始字段保护；不能把它说成真实上游测试。真实调用结果用单独账本说明成功、失败或未验证。
