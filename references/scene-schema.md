# scene.json v2（真实三维）

`shots.json` 保存剪辑和抽帧底稿；`scene.json` 保存有证据的空间推演。两者不得混写。运行 `scene-report.mjs init shots.json --out scene.json` 建骨架；完整的可执行示例见 `../examples/scene-demo.json` 和 `scene-demo-shots.json`（合成测试，不是影片现场数据）。

## 顶层

| 字段 | 说明 |
|---|---|
| `schemaVersion` | `2`；旧平面版本不能只改版本号，须补三维体积与物件高度 |
| `title` | 报告标题 |
| `binding.fingerprint` | 程序按来源、机器元数据、切点和逐镜时间 / 运动值计算的 SHA-256；不随描述编辑改变。切点 / 来源改变后不能仅重算指纹绕过复核 |
| `scope.description` | 本次分析范围及完成程度 |
| `scope.provenance` | 来源 / 派生步骤数组；可记录 source、startSeconds、durationSeconds、crop、removedAudio；报告原样显示。不得含凭据 |
| `scope.limitations` | 局限与未见区域的说明数组 |
| `evidence` | 证据条目数组 |
| `events` | 可选叙事阶段数组；独立于剪辑镜头，可以跨镜，不创造切点；省略或 `[]` 表示尚未划分 |
| `scenes` | 场景数组 |
| `setups` | 跨镜共享的物理机位假设数组，不是镜号 |
| `shots` | 每一个底稿镜头各有一条；未知也要显式记录 |

## 所有判断共用 Claim

```json
{
  "status": "inferred",
  "confidence": "medium",
  "text": "摄影机可能在舞台侧朝入口拍，位置只表示相对区域。",
  "evidenceIds": ["E01", "E03"],
  "alternatives": ["不同焦距配合后期裁切也可能得到类似构图。"]
}
```

- status：`observed` / `inferred` / `proposal` / `unknown`。
- confidence：`high` / `medium` / `low` / `unknown`；未知结论只能用 unknown。
- `observed`、`inferred` 必须引用已有证据。只引用 author 不能标 observed。
- `alternatives` 总是数组；推测无替代解释会提示复核。可写已排除原因，不必机械列多个假说。
- proposal 只是复拍方案，不证明原片现场存在它；unknown 必须说清哪里未知。

## 证据 Evidence

```json
{"id":"E01","kind":"frame","shotId":"S01","at":0.5,"text":"入口门框位于画面中央，白衣人物的肩背遮挡画面左前方。"}
```

`at` 是分析副本的秒，必须在 `[shot.start, shot.end)` 内。`kind` 可用：

- `frame`：本人检查的电影画面；文字只记看得见的线索。
- `author`：博主 / 讲解叠层；需 `shotId`、`at` 和 `locator`（讲解来源定位）。它不是原剧组资料。
- `document`：可核对的外部资料；需 `locator`（来源链接或文件页码），无 at 时页面只展示文字、不提供跳转。

提到画框哪一侧就写“画面左 / 右”；场景方位另外写，不能混同。

## 事件 / 叙事阶段（可选）

```json
{
  "id":"EV1", "label":"发现对方", "start":1.2, "end":7.4,
  "description":"人物先停下脚步，再转头看向对方；几个换镜共同完成这一次发现。",
  "claim":{"status":"inferred","confidence":"medium","text":"将停步、转头和视线反打归为同一个发现阶段，是叙事解释而非实测剪辑切点。","evidenceIds":["E01","E03"],"alternatives":["也可能是在注意画外声源，不能仅凭反打确认目光对象。"]}
}
```

- 顶层 `events` 可省略或为空数组，旧报告不需要补造事件。每项必须有唯一、非空 `id`、简短 `label`、非空 `description` 和完整 `claim`；不接受只有标题的阶段。
- `start / end` 是分析副本的有限数字秒，满足 `0 ≤ start < end ≤ 片长`。必须按开始时刻升序排列，不能重叠；可以首尾相接或留空档，不强求铺满全片。
- 阶段是对内容的人工划分，可以跨越多个镜头，也可以在一个长镜内部换阶段。不得为了配合事件条修改机器底稿、增加剪辑切点或把阶段边界称为实测切点。
- 播放命中采用 `[start,end)`：相接时属于后一阶段，空档不显示当前事件。只有最后阶段确实到达片尾时，播放停在精确片长仍显示最后阶段；尾部空档不自动延长。
- `description` 讲清楚这段发生了什么；`claim` 说明凭什么这样判断，并沿用上文的证据与真假标签规则。可见动作可用 observed，剧情动机、情绪或因果通常应标 inferred 并写替代解释；proposal 与 unknown 不能升级为原片事实。无证据就保留未知，不为显示事件条编剧情。

## 场景 Scene

```json
{
  "id":"R1", "name":"大厅", "orientation":"图上为舞台，图下为入口",
  "scaleNote":"相对坐标示意；无真实尺寸标定",
  "volume":{"width":100,"depth":130,"height":30,"humanHeight":7.5,"claim":{"status":"proposal","confidence":"low","text":"用于三维搭景的相对体积，不是实测尺寸。","evidenceIds":[],"alternatives":[]}},
  "extras":[],
  "elements":[{
    "id":"stage", "label":"舞台区域", "kind":"stage", "box":[15,3,70,15], "height":3, "elevation":0, "color":"#864047",
    "claim":{"status":"inferred","confidence":"medium","text":"按舞台边缘与反打关系组织的相对区域，不表示实际长宽。","evidenceIds":["E01"],"alternatives":["裁切会改变可见范围。"]}
  }]
}
```

坐标在 `[0,100] × [0,100]`，x 向图右，y 向图下；**不是米，不承诺真实长宽比**。`box=[x,y,width,height]` 必须在边界内。kind：`wall / door / window / stage / furniture / zone / curtain / portrait / stairs / pillar`。除 zone 外必须给正数 height，不能只画平面矩形。未见 / 未知结构不画确定矩形，写到 limitations。位置安排本身通常是 inferred，即便门窗“存在”是 observed。

## 机位组 Setup

```json
{
  "id":"A", "sceneId":"R1", "label":"舞台侧朝入口", "color":"#4f8dcc",
  "camera":{
    "position":[48,21], "elevation":6, "target":[50,82], "targetElevation":5, "viewAngleDeg":null,
    "claim":{"status":"inferred","confidence":"medium","text":"朝向入口的机位假设，位置未实测。","evidenceIds":["E01"],"alternatives":["也可能通过稍偏侧的机位配合裁切实现。"]}
  }
}
```

`position`、`target` 要么都为 null，要么都是合法点且不重合。未知位置不能画成确定点。`viewAngleDeg` 默认 null，仅画中心线；有依据填写视角才画扇形。**此字段不是焦距，三维视锥也不是像素级渲染拟合。**

`color` 可选，只接受完整的 `#rrggbb`（大小写均可）。同一机位在播放进度条的镜头色段、镜头卡和三维摄影机中使用同一颜色，不额外创建一排机位条；未配色的多机位报告按机位 ID 稳定分配，排序不改色，未知机位用灰色。旧版单机位 / 排戏方案无配色时保留原来的蓝色。颜色仅作识别，不代表机位可信度、运动类型或叙事阶段。

## 逐镜推演

```json
{
  "shotId":"S01", "sceneId":"R1", "setupId":"A",
  "subjects":[{"id":"P1","label":"白衣人物","position":[45,28],"claim":{"status":"inferred","confidence":"low","text":"按遮挡关系示意相对位置。","evidenceIds":["E01"],"alternatives":["距离未标定。"]}}],
  "lighting":[],
  "cameraNote":{"status":"unknown","confidence":"unknown","text":"机高与支撑设备未知。","evidenceIds":[],"alternatives":[]},
  "lens":{"status":"unknown","confidence":"unknown","text":"未得到焦距与传感器信息。","evidenceIds":[],"alternatives":[]},
  "lightNote":{"status":"unknown","confidence":"unknown","text":"暂未确定来光方向。","evidenceIds":[],"alternatives":[]},
  "interpretation":{"status":"unknown","confidence":"unknown","text":"叙事作用尚未分析。","evidenceIds":[],"alternatives":[]},
  "reproduction":{"status":"unknown","confidence":"unknown","text":"未请求复拍。","evidenceIds":[],"alternatives":[]}
}
```

`lighting` 条目：`id / label / position / target / role / claim`。role 为 `key / fill / rim / ambient / negative-fill / practical / unknown`。可填 `elevation` / `targetElevation`；灯具会以立体支架和灯面展示，但场景的展示照明不等于原片物理光照仿真。方向线不代表光强或衰减。没有位置证据时 position 为 null，只在 lightNote 写方向；未确定灯数时不凭空复制多盏。

可选 `cameraMotion={claim,path:[{at:0,position:[...],target:[...]},{at:1,position:[...],target:[...]}]}`。at 是镜内归一化时间 0–1，至少两点，严格递增且覆盖首尾；只用于有证据支持的运动示意。它是插值展示，不是从视频测出的三维轨迹；不拿它代替 zoom、rack-focus 或演员移动。

## 校验边界

校验覆盖来源绑定、镜头覆盖与时间连续性、证据时间与引用、机位所属场景与颜色格式、重复 ID、相对坐标范围、空值与真假标签、运动路径结构，以及事件的顺序、范围、无重叠与判断依据。未知和未记替代解释会提示，但不伪装成“真实性通过”。它不自动证明真实空间、光源、剧情或剪辑真值。


## 三维搭景与显示方案

- `volume.width / depth / height / humanHeight` 必须为正数，humanHeight 小于房间高度。它们用于相对缩放，不是米。必须有 claim，未知真实尺寸时用 proposal 明确“图示体积”，不能称测量值。
- 每个 element 的 box 仍用水平归一化坐标，`height / elevation` 使用 volume 的相对高度单位；color 为可选 #rrggbb 材质颜色。`cutaway:true` 的 wall 在默认剖视中隐藏，避免透明白墙遮白整个房间。不要为了可视化补造未见的门窗。
- `curtain` 有立体折褶；`portrait` 用简化立体人物浮雕指示挂画位置，不伪造影片美术素材；`stairs` 有立体台阶。furniture 可选 `model:"table" / "bench"`，也可用实体体块表达其他物件。
- `scene.extras` 是逐个背景人物配置，与逐镜 subjects 格式相同。每人要有 id、position、claim，可选 pose、headingDeg、elevation、modelHeight、color、backpack。默认人群不是平面贴图；头、躯干和四肢为三维几何体。示意数量 / 排列不得冒充人数统计。
- subjects 可选 `pose:"standing" / "seated" / "kneeling" / "prone"`、`headingDeg`、`elevation`、`modelHeight`、`color`、`backpack`。同一人物跨镜应保持身份、体量与服装识别；关键信息是位置、朝向和遮挡，不是精细脸部。
- camera 可选 `elevation / targetElevation`；未提供时，模型仅以未标定的人物尺度展示器材，不声称真实机高。
- 视角未知但需要示意视锥时，可写 `previewAngleDeg` 与 `previewClaim`。previewClaim 必须为 proposal，明确显示角度不是实测视角；已填 viewAngleDeg 时不再填写 previewAngleDeg。报告会单独展示这一显示假设。
- 播放联动采用真实三维摄影机、视锥和人物节点，不切换几张预渲染平面图。总览可自由旋转 / 缩放；机位视角按原片宽高比留边，避免横向裁窄改变遮挡关系。此视角隐藏浮动标签，防止遮挡与裁切。
- 渲染器打包在本 Skill 中，禁止交付运行时依赖原 video-shots、AI Paint 工程的 node_modules 或在线 CDN 的报告。WebGL 不可用时明确显示失败，不冒充平面降级已经完成 3D。


## 精细场景扩展（v2 可选字段）

- scene 可添加 `floorColor`（#rrggbb）、`floorTiles`（相对间隔，至少1）、`overview={position:[x,y,z],target:[x,y,z],padding:1.06}`；总览使用真实三维正交相机，机位视角用透视相机。
- `annexes=[{id,label,side:"entry",width,depth,height,stairs,claim}]`：入口外的附属体积；必须有证据或显示方案。
- element 可添加 `detail:"panelled",panelCount` 表达墙面分格；model 可用 aircon / light-frame / bench / table；textureData 仅可为内嵌 PNG/JPEG，不接受URL。
- 人物可加 `seatedStyle:"chair" / "cross-legged"`、`hairStyle:"short" / "long" / "bald"`、`seatPad:true`、`offerings:true`、`marker:"#rrggbb"`。小件由通用几何体构造；只在参考需要时配置。
- `scene.fixtures` 是共享灯组数组，每项与逐镜 lighting 相同，新增 shape（softbox / ceiling-panel / bulb / strip / window / flag）、size（正数宽高）、offset（三维相对偏移）、showBeam；所有灯组仍需 claim，不能因放了模型就当成真实灯位。
- setup 可加 color 保持机位组颜色一致。标注使用固定屏幕字号和避让，移动的是标签，不是机位/人物/灯具；无标定的视锥仍是 proposal。

完整精细度准则见 [3d-fidelity.md](3d-fidelity.md)。


## 露天场景与人物动作

- `scene.environment:"night" / "day"` 只控制分析模型的展示照明，不代表实际光功率；露天素材不自动添加墙或室内布景。场内方向徽标来自 `orientationMarkers:[{label,position,elevation}]`，未配置就不画，不写死舞台/入口。
- furniture 的通用 model 可用 tree / car / streetlight / bollard / building；具体数量和位置仍由证据与场景数据决定，车辆占位不等于精确交通轨迹。
- 人物可用 hairStyle:"bob" 与 outfit:"coat-boots"；颜色来自人物数据，造型只用于识别调度，不是本人精确建模或身份识别。
- `subject.motion={claim,path:[{at:0,position:[...],headingDeg:180},{at:1,position:[...],headingDeg:0}]}` 将人物位置/转向与 cameraMotion 分开。必须有首尾0/1、递增时间、位置、朝向与证据/方案标注。未确认物理轨迹时可明确标 proposal，禁止把演员转身画成摄像机360°环绕。
- 默认总览仅绘制当前机位与视锥；机位组是跨镜候选位置，不是同时在场的摄影机数量。用户主动打开「机位对照」时，其他候选仅画位置圆点与编号，不画完整机架、取景线或视锥；进入机位视角仍隐藏这些对照标记。标签也避开人物本体。
