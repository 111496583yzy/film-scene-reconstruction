# 电影机位与灯光推演 · Film Scene Reconstruction

一个独立的 Codex Skill：给一段电影或视频，拆镜头、分析人物与摄影机调度、推演来光，并生成与原片同步的三维拉片工作台。

## 能做什么

- 用 ffprobe / ffmpeg 建立镜头底稿，再检查误切和漏切。
- 生成真正可旋转、缩放的 WebGL 三维片场：人物、布景、摄影机、视锥和灯位。
- 当前摄影机、脚架、取景线和机位编号亮蓝高亮，其他候选机位弱化，便于从浅色布景中找到当前取景位置。
- 原片、镜头导航、三维和分析侧栏同步；可点击证据时间回看依据。
- 支持室内及露天示意场景、人物动作与相机运动分开表示。
- 可选：经授权调用原生视频模型复核视野倾向，保留估计前提、可信度和原始参数待核实状态。

**这是有证据的拍摄方案推演，不是摄影测量或剧组参数读取器。** 焦距、机高和灯具没有原始资料时，不会把模型估计伪装成实测。

## 在 Codex 中使用

仓库根目录就是 Skill 根目录，入口是 [`SKILL.md`](SKILL.md)。将目录放到你的 Codex Skill 目录；已有安装不需要重复复制。

发来视频或本机文件路径，然后输入：

```text
用 $film-scene-reconstruction 完整拉片这个视频，
分析景别、运镜、机位、灯光与视野倾向，生成三维交互报告。
```

要让已配置的外部模型参与，再明确补充：

```text
允许上传本视频到已配置的模型复核，最多调用一次。
```

只使用本地流程可以写：

```text
仅本地分析，不上传、不调用外部模型。
```

报告里的“载入原片”只用于恢复播放，不会自动分析新视频。新视频需要重新交给 Codex。

## 依赖与离线运行

基础流程需要 Node.js 18+、ffmpeg、ffprobe；可选模型复核需要 Python 3（标准库即可）。正常使用不需要 `npm install`。Three.js 和 Lucide 图标已内嵌在独立资产中，不依赖运行时 CDN。

详细流程：

- [逐镜底稿](references/shot-workflow.md)
- [三维精细度与证据要求](references/3d-fidelity.md)
- [推演方法](references/inference-guide.md)
- [数据结构](references/scene-schema.md)
- [单屏工作台](references/report-ui.md)
- [可选原视频模型](references/video-model-analysis.md)

## 可选模型配置

参考 [`.env.example`](.env.example)，将实际配置放在仓库之外，例如：

```text
~/.codex/secrets/film-scene-reconstruction.env
```

配置文件权限设为 `0600`。不要提交 API Key，也不要覆盖已有的有效配置。模型、接口和认证方式以你所用平台的文档与实际验证为准；模型卡标“图片输入”不能自动当作视频支持。

模型复核先 dry-run，获准后才执行；失败不自动重试，也不偷偷退回抽帧。结果先保存候选，复核后再离线归并，不改原始切点、运动值或相机/人物轨迹。

## 检查

以下是本地离线检查，不上传视频、不调用付费模型：

```bash
node scripts/selftest.mjs
node scripts/scene-selftest.mjs
node scripts/scene-3d-selftest.mjs
node scripts/ui-selftest.mjs
python3 scripts/test_qwen_omni_enrich.py
python3 scripts/test_video_model_enrich.py
```

它们覆盖数据、协议、失败恢复和接口约定，不替代真实浏览器中的三维、播放、键盘、窄屏和文字选区验收。

`examples/` 为脚本测试样例；其中 `scene-demo*` 是合成三维夹具，不是真实影片的片场结论。仓库不包含用户视频、私有分析报告或本机密钥。

## 开发与许可

修改三维源代码后，用 `scripts/build-3d.mjs` 和你本机含 `three` / `esbuild` 的依赖目录重建；分发和正常使用只需要已打包资产。

保留 [Apache-2.0 许可](LICENSE)。复制保留的逐镜工具、Three.js、Lucide / Feather 归属与许可见 [NOTICE.md](NOTICE.md) 及随包许可文件。
