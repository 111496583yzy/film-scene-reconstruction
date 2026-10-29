# 本副本的逐镜底稿流程

所有 `{baseDir}` 均指 `film-scene-reconstruction/SKILL.md` 所在目录，不是本 references 目录。

## 检测与抽帧

```bash
node {baseDir}/scripts/video-shots.mjs seed <video> --track track.json --title '<title>' > shots.json
node {baseDir}/scripts/video-shots.mjs frames shots.json --video <video>
node {baseDir}/scripts/video-shots.mjs sheet shots.json --cols 4 --rows 5
node {baseDir}/scripts/video-shots.mjs sheet shots.json --cols 4 --rows 5 --pick b
```

`seed` 用 ffprobe 取得副本片长、帧率、尺寸；ffmpeg 场景检测给出候选切点。暗场 / 同构图可能漏切，闪光 / 字幕 / 动作可能误切，必须看图和连续帧核对。可用 `--threshold 0.15` 重跑；重跑会清空旧标注，要先备份。

每镜 `a` / `b` 是镜内 15% / 85% 处采样。联系表能快速筛查，不能代替对不确定运镜的连续观察。运动量是低分辨率图像差分，不是摄影机运动测量。

只填景别、类别、运镜、画面、主体、字幕等人工字段；机器字段见 [schema.md](schema.md)。不会判断运镜时用 `unknown` 并写 note，不伪称固定。类别 `dialogue` 需要可核对台词；未请求语音转写时只记可读字幕，没有台词证据就使用更保守的类别并说明。

```bash
node {baseDir}/scripts/video-shots.mjs recut shots.json --track track.json \
  --split <真实漏切秒> --merge <误切秒> > shots.new.json
# 确认成功后再替换旧底稿，并重抽帧、复核受影响镜头
```

不要把镜头内变焦、变焦点、人物动作或摄影机运动的转变当作剪辑切点。同一镜可以在 note 和场景轨迹中记录多段运动。边界调整后原 scene.json 的绑定会失效，必须重新检查 scene.shots 与 evidence 的镜号和时间；不要只复制指纹。

## 校验与辅助报告

```bash
node {baseDir}/scripts/video-shots.mjs validate shots.json --track track.json --frames frames
node {baseDir}/scripts/video-shots.mjs render shots.json --md --track track.json > shots.md
# 辅助二维拉片表（不是本 Skill 的最终场景报告）
node {baseDir}/scripts/video-shots.mjs render shots.json --html --track track.json --video <video> > shots-report.html
```

底层校验沿用独立复制的 15 道门。跳过不是通过；运动量门若与视觉证据冲突，保留原始数值并报告复核结果，不改机器数据迎合校验。场景推演主报告必须另跑 `scene-report.mjs validate / render`。

## 可选声音分析

仅当用户明确要求台词 / 声音且授权执行时，阅读 [qwen-omni.md](qwen-omni.md) 后使用本副本的 `scripts/qwen_omni_enrich.py`。先 dry-run；外部调用前遵循原授权与配置规则，不默认上传视频。场景和机位分析本身不需要它。
