# 电影机位与灯光推演 · Film Scene Reconstruction

[![像素星云：AI 生图、AI 视频、商品图和无限画布，点击访问官网](assets/readme/pixel-nebula-banner.svg)](https://www.yzycolour.top/)

<p align="center"><strong><a href="https://www.yzycolour.top/">立即体验像素星云 · www.yzycolour.top →</a></strong></p>

一个独立的 Codex Skill：给一段电影或视频，拆镜头、分析人物与摄影机调度、推演来光，并生成与原片同步的三维拉片工作台。

## 能做什么

- 用 ffprobe / ffmpeg 建立镜头底稿，再检查误切和漏切。
- 生成真正可旋转、缩放的 WebGL 三维片场：人物、布景、摄影机、视锥和灯位。
- 同一机位在播放进度条的色段、镜头卡、三维摄影机与视锥中保持同色，不额外增加一排机位条。三维默认只显示当前机位；主动打开「机位对照」才显示其他候选位置的简化标记，不暗示同时摆放多台摄影机。
- 支持跨镜头的事件阶段条与随播放更新的事件说明、证据跳转；不把事件变化误当成剪辑切点。未填写事件的旧报告仍可直接打开。
- 原片、镜头导航、三维和分析侧栏同步；可点击证据时间回看依据。
- 支持室内及露天示意场景、人物动作与相机运动分开表示。
- 可选：经授权先上传原视频获取临时 URL，再交给原生视频模型复核；保留估计前提、可信度和原始参数待核实状态。

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

## 排戏模式：把分析变成自己的方案

在新生成的报告顶部点 **「排我的戏」**，可复制当前镜头为独立方案；原片分析、证据和切点保持只读。也可以不提供视频，直接新建排戏页：

```bash
node scripts/rehearsal.mjs new --out reports/rehearsal.html
node scripts/rehearsal.mjs demo --out reports/rehearsal-demo.html
```

- 拖人物、拖蓝色摄影机；旋转空白区域只是观察，不会改变拍摄机位。
- 设置起点、终点和镜头用时，一边摆位，一边看右侧真实机位画面，播放走位与运镜预演。
- 名称、颜色、造型参考是人物的全工程资料；站位和摄影机只改当前镜头。布景默认也只改当前镜，共用场景会按需复制。
- 可以复用已有角色、添加门窗桌椅、切换/新建场景、复制与调整镜头顺序；支持撤销、重做和拖拽取消。
- 「保存工程」下载 JSON，之后用「打开工程」继续修改；「导出可播放页面」可在没有原片的情况下独立打开。还可导出当前机位的分镜图和俯视走位图。
- 参考图保存在工程里，只作人物/场景对照，不会自动变成三维模型。本机草稿只是恢复缓存，不替代工程文件；浏览器不允许缓存时会明确提示。

从已有文件新建排戏页：

```bash
node scripts/rehearsal.mjs from-report shots.json scene.json --shot S01 --out reports/rehearsal.html
node scripts/rehearsal.mjs from-report shots.json scene.json --all --out reports/rehearsal-all.html
node scripts/rehearsal.mjs validate my-project.json
node scripts/rehearsal.mjs render my-project.json --out reports/reopened.html
```

首期是相对坐标的排戏替身与镜头预演，不是精细骨骼动画、照片三维重建或物理布光仿真；不自动调用 AI 生成模型。导入的多点路线会先保留，重新摆起终点后按新起终点预演。详细边界与验收见 [排戏模式](references/rehearsal.md)。

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

配置文件权限设为 `0600`。不要提交 API Key，也不要覆盖已有的有效配置。默认 `FILM_ANALYSIS_INPUT_MODE=upload_url`，需要配置 `UPLOAD_API_URL`（完整上传地址）和 `MAX_UPLOAD_BYTES`（本机上传预算）；均带 `FILM_ANALYSIS_` 前缀。上传接口与密钥须属于同一地区/账号，不自动尝试其他域名。模型、接口和认证方式以你所用平台的文档与实际验证为准；模型卡标“图片输入”不能自动当作视频支持。

模型复核先 dry-run，获准后才执行；原视频只上传一次，模型只请求一次。上传和模型请求分别记录状态，失败不自动重试，也不退回内联视频或抽帧。临时 URL 只在本次请求中使用，不写进日志或报告。结果先保存候选，复核后再离线归并，不改原始切点、运动值或相机/人物轨迹。原来的内联方式仅在明确选择 `FILM_ANALYSIS_INPUT_MODE=inline` 时保留，不是自动回退。

## 检查

以下是本地离线检查，不上传视频、不调用付费模型：

```bash
node scripts/selftest.mjs
node scripts/scene-selftest.mjs
node scripts/scene-3d-selftest.mjs
node scripts/ui-selftest.mjs
node scripts/rehearsal-selftest.mjs
python3 scripts/test_qwen_omni_enrich.py
python3 scripts/test_video_model_enrich.py
```

它们覆盖数据、协议、失败恢复和接口约定，不替代真实浏览器中的三维、播放、键盘、窄屏和文字选区验收。

`examples/` 为脚本测试样例；其中 `scene-demo*` 是合成三维夹具，不是真实影片的片场结论。仓库不包含用户视频、私有分析报告或本机密钥。

## 开发与许可

修改三维源代码后，用 `scripts/build-3d.mjs` 和你本机含 `three` / `esbuild` 的依赖目录重建；分发和正常使用只需要已打包资产。

保留 [Apache-2.0 许可](LICENSE)。复制保留的逐镜工具、Three.js、Lucide / Feather 归属与许可见 [NOTICE.md](NOTICE.md) 及随包许可文件。
