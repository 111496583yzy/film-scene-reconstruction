# Qwen Omni 可选扩展

## 什么时候调用

仅在用户明确要求完整台词、语气/情绪、音乐/环境声/动作声，或明确指定全模态模型时，运行音频增强阶段。普通拉片仍保持原来的零 API key 工作流。

## 输入与输出

- 输入：本地原视频 + 已通过基础验证的 `shots.json`；模型同时读取视频画面与音轨。
- 必需的本机环境变量：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`。Base URL 必须和密钥所属地域/工作空间一致；不要把 API Key 放进项目文件或命令行参数。
- Chat Completions 的视频帧抽取由服务端管理；报告中的台词时间属于模型估计，不声称可由客户端指定抽帧率。
- 模型输出是近似时间戳。按照句段与镜头区间的重叠映射，不改变 `start/end/seconds/motion/seedCuts/manualCuts/meta`。
- 使用 `--response-file` 或测试脚本验证离线结果，不会联网。实际 API 调用用 `--execute`；写回 shot JSON 还需 `--apply`，写回前先备份。

## 临时上传与数据边界

模型读取本地视频前，脚本会将视频上传到百炼的临时对象存储，取得短期 OSS URL，再用该 URL 调用 Chat Completions 视频输入。官方临时 URL 48 小时到期；API 调用必须附带 OSS 解析 Header。脚本不把临时 URL、授权 Header 或 API Key 写入文件和日志。单次失败不重试；原片和原始镜头 JSON 保留。

如果 API Key 曾粘贴到聊天或日志，按已暴露处理：撤销并轮换，之后只把新值放到本机密钥环境变量。

## 质量与归并

返回结构必须包含 `transcript_segments`、`sound_events`。每段有起止秒、说话人、台词、情绪、声学依据、置信度和字幕一致性；时间必须落在视频时长内。台词不清则保留不确定标记，不可借字幕猜听不清的声音。每个 segment 保留原始区间，并映射所有重叠的镜头及一个主镜头。跨切句子只在主镜头的 `audio` 字段展开，后续镜头注明延续，完整台词在独立 `audio-transcript.md` 内可查。

情绪是对声音的解释，不是商品事实，也不是可确定的演员状态；低置信度标记待核。合并后必须重新运行完整 `validate`，且检查原始机器字段前后完全一致。报告不通过则恢复 `shots.before-qwen-omni.json`。
