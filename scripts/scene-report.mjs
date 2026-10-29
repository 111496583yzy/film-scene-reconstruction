#!/usr/bin/env node
// Independent, local-only report builder. No recognition, model call or upload.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATUSES = new Set(['observed', 'inferred', 'proposal', 'unknown']);
const CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown']);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const point = p => Array.isArray(p) && p.length === 2 && p.every(v => finite(v) && v >= 0 && v <= 100);
const array = v => Array.isArray(v) ? v : [];
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function fingerprint(shots) {
  // Annotation edits are allowed; source, cut/motion/metadata changes invalidate binding.
  return createHash('sha256').update(JSON.stringify({
    source: shots.source, meta: shots.meta, seedCuts: shots.seedCuts, manualCuts: shots.manualCuts,
    shots: array(shots.shots).map(({id, start, end, seconds, motion}) => ({id, start, end, seconds, motion})),
  })).digest('hex');
}
export function unknown(text = '未确认，待检查画面') {
  return { status: 'unknown', confidence: 'unknown', text, evidenceIds: [], alternatives: [] };
}
export function initScene(shots) {
  return {
    schemaVersion: 2,
    title: shots.title || '电影拍摄现场推演',
    binding: { fingerprint: fingerprint(shots) },
    scope: { description: '待填写分析范围；这是骨架，不是完成的分析', provenance: [], limitations: ['相对坐标示意，非实测场地图；未确认项目保留未知。'] },
    evidence: [],
    scenes: [{ id: 'R1', name: '场景待确认', orientation: '待根据画面锚点确定方向', scaleNote: '相对坐标 0–100，无米制标定', volume: {width:100,depth:100,height:30,humanHeight:7.5,claim:{status:'proposal',confidence:'low',text:'仅作三维搭建的未标定空间骨架，不表示真实房间尺寸。',evidenceIds:[],alternatives:[]}}, extras: [], elements: [] }],
    setups: [],
    shots: array(shots.shots).map(s => ({
      shotId: s.id, sceneId: 'R1', setupId: null, subjects: [], lighting: [],
      cameraNote: unknown(), lens: unknown(), lightNote: unknown(), interpretation: unknown(), reproduction: unknown('未请求或尚未制定复拍方案'),
    })),
  };
}

export function validateScene(shots, doc) {
  const errors = [], warnings = [];
  const error = (at, msg) => errors.push(`${at}: ${msg}`);
  const warn = (at, msg) => warnings.push(`${at}: ${msg}`);
  if (!shots || typeof shots !== 'object' || !doc || typeof doc !== 'object') return {ok:false, errors:['输入必须是 JSON 对象'], warnings};
  if (doc.schemaVersion !== 2) error('schemaVersion', '只支持三维版本 2；旧平面数据须补充 volume、高度和立体场景，不能直接改版本号掩盖缺失');
  if (doc.binding?.fingerprint !== fingerprint(shots)) error('binding', '镜头底稿已改变或绑定错误；重新关联场景，不要直接替换指纹掩盖变更');
  if (!nonempty(doc.scope?.description)) error('scope', '缺少分析范围说明');
  if (!Array.isArray(doc.scope?.provenance) || !Array.isArray(doc.scope?.limitations)) error('scope', 'provenance / limitations 必须为数组');
  for (const key of ['evidence', 'scenes', 'setups', 'shots']) if (!Array.isArray(doc[key])) error(key, '必须为数组');
  const baseShots = new Map();
  let last = 0;
  const duration = shots.meta?.durationSeconds;
  if (!finite(duration) || duration <= 0) error('shots.meta', '片长必须为正数');
  for (const s of array(shots.shots)) {
    if (!s || !nonempty(s.id) || baseShots.has(s.id)) { error('shots', '镜号缺失或重复'); continue; }
    baseShots.set(s.id, s);
    if (![s.start,s.end,s.seconds].every(finite) || s.end <= s.start || Math.abs(s.start-last) > .05 || Math.abs(s.seconds-(s.end-s.start)) > .025) error(s.id, '底稿时间轴不连续或时长错误');
    last = s.end;
  }
  if (!baseShots.size || !finite(last) || Math.abs(last-duration) > .25) error('shots', '时间轴未覆盖片长');
  function index(items, label) {
    const map = new Map();
    for (const item of array(items)) {
      if (!item || !nonempty(item.id) || map.has(item.id)) error(label, 'id 缺失或重复');
      else map.set(item.id, item);
    }
    return map;
  }
  const evidence = index(doc.evidence, 'evidence'), scenes = index(doc.scenes, 'scenes'), setups = index(doc.setups, 'setups');
  if (!scenes.size) error('scenes', '至少需要一个场景；未知场景可以留空元素');
  for (const [id, e] of evidence) {
    if (!new Set(['frame','author','document']).has(e.kind) || !nonempty(e.text)) error(id, '证据需要 kind 和具体描述');
    if (e.kind === 'frame' || e.kind === 'author') {
      const s = baseShots.get(e.shotId);
      if (!s || !finite(e.at) || e.at < s.start-.01 || e.at >= s.end) error(id, '证据时间必须在所引用镜头内（不含出点）');
      if (e.kind === 'author' && !nonempty(e.locator)) error(id, '作者标注需要来源定位，不能伪装成电影观察');
    }
    if (e.kind === 'document' && !nonempty(e.locator)) error(id, '文档证据需要可核对的来源定位');
  }
  function claim(c, at) {
    if (!c || !STATUSES.has(c.status) || !CONFIDENCES.has(c.confidence) || !nonempty(c.text) || !Array.isArray(c.evidenceIds) || !Array.isArray(c.alternatives)) { error(at, '缺少合法的 status / confidence / text / evidenceIds / alternatives'); return; }
    for (const id of c.evidenceIds) if (!evidence.has(id)) error(at, `找不到证据 ${id}`);
    if (c.status === 'unknown') {
      if (c.confidence !== 'unknown') error(at, '未知结论不能标为已知可信度');
      warn(at, c.text);
    } else if (c.confidence === 'unknown') error(at, '非未知结论必须标注可信度');
    if ((c.status === 'observed' || c.status === 'inferred') && !c.evidenceIds.length) error(at, '观察 / 推测必须引用证据');
    if (c.status === 'observed' && c.evidenceIds.length && c.evidenceIds.every(id => evidence.get(id)?.kind === 'author')) error(at, '仅有作者标注不能证明真实片场事实；改为推测或引用原片 / 可核对资料');
    if (c.status === 'inferred' && !c.alternatives.length) warn(at, '推测尚未记录替代解释或排除依据');
  }
  function position(p, at) { if (p !== null && !point(p)) error(at, '坐标应为 [x,y]，范围 0–100；未知用 null'); }
  function camera(cam, at) {
    if (!cam) { error(at, '缺少 camera'); return; }
    position(cam.position, `${at}.position`); position(cam.target, `${at}.target`);
    if ((cam.position === null) !== (cam.target === null)) error(at, '机位与朝向须同时未知或同时填写');
    if (point(cam.position) && point(cam.target) && Math.hypot(cam.position[0]-cam.target[0], cam.position[1]-cam.target[1]) < .01) error(at, '机位和朝向目标不能重合');
    if (cam.viewAngleDeg !== null && (!finite(cam.viewAngleDeg) || cam.viewAngleDeg <= 0 || cam.viewAngleDeg >= 170)) error(at, '视角未知用 null；已填写必须在 0–170 度之间');
    for(const key of ['elevation','targetElevation'])if(cam[key]!==undefined&&(!finite(cam[key])||cam[key]<0))error(at,`${key} 必须为非负相对高度`);
    if(cam.previewAngleDeg!==undefined){
      if(cam.viewAngleDeg!==null||!finite(cam.previewAngleDeg)||cam.previewAngleDeg<=0||cam.previewAngleDeg>=170)error(at,'示意视锥只用于未标定视角，角度须合法');
      claim(cam.previewClaim,`${at}.previewClaim`);
      if(cam.previewClaim?.status!=='proposal')error(at,'未标定视锥必须明确标为 proposal，不能伪称实际视角');
    }
    claim(cam.claim, `${at}.claim`);
    if (cam.claim?.status === 'unknown' && (cam.position !== null || cam.viewAngleDeg !== null)) error(at, '未知机位不能绘制确定的位置或视角');
  }
  function validatePerson(obj,at,volume){
    for(const k of ['seatPad','offerings','backpack'])if(obj[k]!==undefined&&typeof obj[k]!=='boolean')error(at,`${k} 须为布尔值`);
    if(obj.seatedStyle!==undefined&&!['chair','cross-legged'].includes(obj.seatedStyle))error(at,'坐姿 seatedStyle 不合法');
    if(obj.hairStyle!==undefined&&!['short','long','bald','bob'].includes(obj.hairStyle))error(at,'hairStyle 不合法');
    if(obj.pose!==undefined&&!['standing','seated','kneeling','prone'].includes(obj.pose))error(at,'人物 pose 不合法');
    if(obj.outfit!==undefined&&obj.outfit!=='coat-boots')error(at,'outfit 不合法');
    if(obj.motion){
      claim(obj.motion.claim,`${at}.motion`);const path=array(obj.motion.path);if(path.length<2||path[0]?.at!==0||path.at(-1)?.at!==1)error(at,'人物运动须覆盖镜内时间0–1');let last=-1;
      for(const p of path){if(!p||!finite(p.at)||p.at<0||p.at>1||p.at<=last||!point(p.position)||!finite(p.headingDeg))error(at,'人物轨迹须有递增时间、合法位置与朝向');last=p?.at;}
      if(obj.motion.claim?.status==='unknown')error(at,'未知人物运动不能伪造轨迹');
    }
    if(obj.elevation!==undefined&&(!finite(obj.elevation)||obj.elevation<0))error(at,'人物 elevation 不合法');
    if(obj.headingDeg!==undefined&&!finite(obj.headingDeg))error(at,'人物朝向不合法');
    if(obj.modelHeight!==undefined&&(!finite(obj.modelHeight)||obj.modelHeight<=0||(volume&&obj.modelHeight>volume.height)))error(at,'人物 modelHeight 不合法');
  }
  function lightConfig(obj,at){
    if(!obj)return;
    if(obj.shape!==undefined&&!['softbox','ceiling-panel','bulb','strip','window','flag'].includes(obj.shape))error(at,'灯具 shape 不合法');
    if(obj.size!==undefined&&(!Array.isArray(obj.size)||obj.size.length!==2||!obj.size.every(n=>finite(n)&&n>0)))error(at,'灯具 size 须为正数宽高');
    if(obj.offset!==undefined&&(!Array.isArray(obj.offset)||obj.offset.length!==3||!obj.offset.every(finite)))error(at,'灯具 offset 须为三维向量');
    for(const k of ['elevation','targetElevation'])if(obj[k]!==undefined&&(!finite(obj[k])||obj[k]<0))error(at,'灯位相对高度不合法');
    if(!new Set(['key','fill','rim','ambient','negative-fill','practical','unknown']).has(obj.role))error(at,'灯光 role 不合法');
    position(obj.target,`${at}.target`);
  }
  for (const [id, scene] of scenes) {
    if (!nonempty(scene.name) || !nonempty(scene.orientation) || !nonempty(scene.scaleNote)) error(id, '缺少场景名 / 方位 / 相对尺度说明');
    const vol=scene.volume;
    if(!vol||!['width','depth','height','humanHeight'].every(k=>finite(vol[k])&&vol[k]>0)||vol.humanHeight>=vol.height)error(id,'缺少合法的三维体积和人物示意高度；不得退回二维投影冒充 3D');
    if(vol){claim(vol.claim,`${id}.volume`);if(vol.claim?.status==='unknown')error(id,'三维相对尺寸须明确是推测或显示方案，不能把未知参数填成测量值');}
    if(scene.extras!==undefined&&!Array.isArray(scene.extras))error(id,'extras 必须为逐个人物点位数组，不以虚构人数充实场景');
    index(scene.extras||[],`${id}.extras`);
    for(const extra of array(scene.extras)){if(!extra)continue;position(extra.position,`${id}.${extra.id}`);claim(extra.claim,`${id}.${extra.id}`);validatePerson(extra,`${id}.${extra.id}`,vol);if(extra.claim?.status==='unknown'&&extra.position!==null)error(id,'未知群演位置不能画成确定点位');}
    if(scene.environment!==undefined&&!['day','night'].includes(scene.environment))error(id,'environment 须为 day 或 night');
    if(scene.orientationMarkers!==undefined&&!Array.isArray(scene.orientationMarkers))error(id,'orientationMarkers 必须为数组');
    for(const marker of array(scene.orientationMarkers)){if(!marker||!nonempty(marker.label)||!point(marker.position))error(id,'场内方向标记需要文字与合法位置');}
    if(scene.fixtures!==undefined&&!Array.isArray(scene.fixtures))error(id,'fixtures 必须为数组');
    index(scene.fixtures||[],`${id}.fixtures`);
    for(const f of array(scene.fixtures)){if(!f)continue;position(f.position,`${id}.${f.id}`);claim(f.claim,`${id}.${f.id}`);lightConfig(f,`${id}.${f.id}`);if(f.claim?.status==='unknown'&&f.position!==null)error(id,'未知灯位不能绘成确定位置');}
    if(scene.floorTiles!==undefined&&(!finite(scene.floorTiles)||scene.floorTiles<1))error(id,'地砖间隔必须至少为一个相对单位');
    if(scene.overview){for(const k of ['position','target'])if(!Array.isArray(scene.overview[k])||scene.overview[k].length!==3||!scene.overview[k].every(finite))error(id,'总览机位须提供三维 position / target');for(const k of ['padding','zoom'])if(scene.overview[k]!==undefined&&(!finite(scene.overview[k])||scene.overview[k]<=0))error(id,'总览 padding / zoom 须为正数');if(scene.overview.position?.length===3&&scene.overview.target?.length===3&&scene.overview.position.every((v,i)=>v===scene.overview.target[i]))error(id,'总览位置与目标不能重合');}
    if(scene.annexes!==undefined&&!Array.isArray(scene.annexes))error(id,'annexes 必须为数组');
    index(scene.annexes||[],`${id}.annexes`);
    for(const annex of array(scene.annexes)){if(!annex)continue;if(annex.side!=='entry'||!['width','depth','height'].every(k=>finite(annex[k])&&annex[k]>0))error(id,'附属走廊须有入口侧与正数长宽高');claim(annex.claim,`${id}.${annex.id}`);}
    if (!Array.isArray(scene.elements)) error(id, 'elements 必须为数组');
    index(scene.elements, `${id}.elements`);
    for (const el of array(scene.elements)) {
      if (!el) continue;
      if (!nonempty(el.label) || !new Set(['wall','door','window','stage','furniture','zone','curtain','portrait','stairs','pillar']).has(el.kind)) error(id, '场景元素需要 label 和合法 kind');
      const b = el.box;
      if (!Array.isArray(b) || b.length !== 4 || !b.every(finite) || b[0] < 0 || b[1] < 0 || b[2] <= 0 || b[3] <= 0 || b[0]+b[2] > 100.01 || b[1]+b[3] > 100.01) error(`${id}.${el.id}`, 'box 为相对 [x,y,width,height]，必须在 0–100 内');
      if(el.height!==undefined&&(!finite(el.height)||el.height<=0))error(`${id}.${el.id}`,'三维 height 必须为正数');
      if(el.elevation!==undefined&&(!finite(el.elevation)||el.elevation<0))error(`${id}.${el.id}`,'三维 elevation 必须为非负数');
      if(scene.volume&&finite(el.height)&&((el.elevation||0)+el.height)>scene.volume.height*1.1)error(`${id}.${el.id}`,'物件超过配置的场景高度');
      if(el.kind!=='zone'&&el.height===undefined)error(`${id}.${el.id}`,'立体物件必须给 height，不能默认画成平面矩形');
      if(el.textureData!==undefined&&(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(el.textureData)||el.textureData.length>2000000))error(`${id}.${el.id}`,'纹理只接受内嵌 PNG/JPEG，禁止远程地址或脚本协议');
      if(el.panelCount!==undefined&&(!Number.isInteger(el.panelCount)||el.panelCount<1||el.panelCount>100))error(`${id}.${el.id}`,'墙板分格数量不合法');
      claim(el.claim, `${id}.${el.id}`);
      if (el.claim?.status === 'unknown') error(`${id}.${el.id}`, '未知结构不要画出具体矩形；移入 scope.limitations');
    }
  }
  for (const [id, setup] of setups) {
    if (!scenes.has(setup.sceneId) || !nonempty(setup.label)) error(id, '机位组缺少合法场景 / 标签');
    camera(setup.camera, id);
  }
  const covered = new Set();
  for (const s of array(doc.shots)) {
    if (!s) { error('scene.shots', '镜头不能为空'); continue; }
    const at = s.shotId;
    if (!baseShots.has(at) || covered.has(at)) error('scene.shots', `未知或重复镜头 ${at}`);
    covered.add(at);
    if (!scenes.has(s.sceneId)) error(at, '未引用有效场景');
    if (s.setupId !== null && (!setups.has(s.setupId) || setups.get(s.setupId).sceneId !== s.sceneId)) error(at, '机位不存在或不属于这个场景');
    if (s.setupId === null) warn(at, '机位尚未确定，不绘制摄影机');
    for (const key of ['cameraNote','lens','lightNote','interpretation','reproduction']) claim(s[key], `${at}.${key}`);
    if(s.lens?.estimate){
      const estimate=s.lens.estimate;
      if(!['wide','normal','narrow','undetermined'].includes(estimate.view_category)||!Array.isArray(estimate.assumptions))error(at,'模型视野估计缺少类别/假设');
      if(typeof s.lens.actual_capture_parameters?.verified!=='boolean')error(at,'模型候选必须明确区分真实拍摄参数是否核实');
      if(s.lens.actual_capture_parameters?.verified===true&&s.lens.status!=='observed')error(at,'模型推测不能标为真实参数已验证');
      if(s.lens.actual_capture_parameters?.verified!==true&&s.lens.status!=='unknown')warn(`${at}.lens.actual`,'真实焦距、传感器与裁切仍缺原始记录；模型估计不等于实测。');
    }
    if (!Array.isArray(s.subjects) || !Array.isArray(s.lighting)) error(at, 'subjects / lighting 必须为数组');
    for (const key of ['subjects','lighting']) {
      index(s[key], `${at}.${key}`);
      for (const obj of array(s[key])) {
        if (!obj) continue;
        if (!nonempty(obj.label)) error(at, '人物 / 灯位缺少标签');
        position(obj.position, `${at}.${obj.id}`); claim(obj.claim, `${at}.${obj.id}`);
        if (obj.claim?.status === 'unknown' && obj.position !== null) error(at, '未知位置不要绘成确定点位');
        if(key==='subjects')validatePerson(obj,`${at}.${obj.id}`,scenes.get(s.sceneId)?.volume);
        if (key === 'lighting') {
          lightConfig(obj,`${at}.${obj.id}`);
        }
      }
    }
    if (s.cameraMotion) {
      claim(s.cameraMotion.claim, `${at}.cameraMotion`);
      const path = array(s.cameraMotion.path);
      if (!setups.has(s.setupId) || path.length < 2 || path[0]?.at !== 0 || path.at(-1)?.at !== 1) error(at, '运动轨迹须关联机位且覆盖镜内归一化时间 0–1，至少两点');
      let prev = -1;
      for (const p of path) {
        if (!p || !finite(p.at) || p.at < 0 || p.at > 1 || p.at <= prev || !point(p.position) || !point(p.target) || Math.hypot(p.position[0]-p.target[0],p.position[1]-p.target[1]) < .01) error(at, '运动轨迹时间须递增，位置与朝向必须有效且不重合');
        prev = p?.at;
      }
      if (s.cameraMotion.claim?.status === 'unknown') error(at, '未知运动不绘制轨迹');
    }
  }
  for (const id of baseShots.keys()) if (!covered.has(id)) error(id, '缺少逐镜推演条目（未知也应明确记录）');
  return {ok: errors.length === 0, errors, warnings};
}

export function bundleFrames(shots, baseDir) {
  const frames = {}, missing = [];
  for (const s of array(shots.shots)) for (const pick of ['a','b']) {
    const name = `${s.id}${pick}`;
    // Only derived file names; no arbitrary paths from the source data.
    if (!/^S\d+[ab]$/.test(name)) { missing.push(name); continue; }
    const path = join(baseDir, shots.params?.frameDir || 'frames', `${name}.jpg`);
    if (existsSync(path)) frames[name] = 'data:image/jpeg;base64,'+readFileSync(path).toString('base64');
    else missing.push(name);
  }
  return {frames, missing};
}
export function videoUrl(source, baseDir, outDir) {
  if (!source) return '';
  // A report must never silently upload or autoplay a remote URL.
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) throw new Error('视频只接受本地文件路径，不接受 URL / data / 脚本协议');
  const local = resolve(baseDir, source);
  return relative(outDir, local).split(/[\\/]/).map(encodeURIComponent).join('/');
}
export function loadIcons(directory=join(HERE,'../assets/vendor/lucide')) {
  const manifest=readJson(join(directory,'manifest.json')),icons={};
  for(const [name,hash] of Object.entries(manifest.icons)){
    if(!/^[a-z0-9-]+$/.test(name))throw new Error('图标名称不合法');
    const file=readFileSync(join(directory,name+'.svg'),'utf8');
    if(createHash('sha256').update(file).digest('hex')!==hash)throw new Error(`图标完整性校验失败：${name}`);
    const body=file.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1];
    if(!body||/<(?:script|foreignObject|style|image|use)\b|\bon[a-z]+\s*=|(?:javascript|https?):/i.test(body))throw new Error(`图标内容不合法：${name}`);
    icons[name]=body;
  }
  return icons;
}
export function renderReport(shots, scene, {baseDir=process.cwd(), outDir=baseDir, video=shots.source} = {}) {
  const checks = validateScene(shots, scene);
  if (!checks.ok) throw new Error('场景结构校验失败：\n'+checks.errors.join('\n'));
  const {frames, missing} = bundleFrames(shots, baseDir);
  const payload = {shots, scene, checks, frames, missing, icons:loadIcons(), video:videoUrl(video,baseDir,outDir)};
  const html = readFileSync(join(HERE,'../assets/scene-report.html'),'utf8');
  const replacements={
    '<!--REPORT_TITLE-->':escapeHtml(scene.title || shots.title),
    '/*REPORT_STYLE*/':readFileSync(join(HERE,'../assets/scene-report.css'),'utf8'),
    '/*REPORT_DATA*/':safeJson(payload),
    '/*REPORT_MODEL*/':readFileSync(join(HERE,'../assets/ui-state.cjs'),'utf8'),
    '<!--REPORT_LICENSE-->':'<!-- Lucide icon license\n'+readFileSync(join(HERE,'../assets/vendor/lucide/LICENSE.txt'),'utf8').replace(/--/g,'—')+'\n-->',
    '/*REPORT_3D*/':readFileSync(join(HERE,'../assets/vendor/scene3d.bundle.js'),'utf8'),
    '/*REPORT_SCRIPT*/':readFileSync(join(HERE,'../assets/scene-report.js'),'utf8'),
  };
  // A single template pass: annotation text cannot be reinterpreted as a later placeholder.
  return html.replace(/<!--REPORT_(?:TITLE|LICENSE)-->|\/\*REPORT_(?:STYLE|DATA|MODEL|3D|SCRIPT)\*\//g,match=>replacements[match]);
}

function getOption(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${flag} 缺少值`);
  return args[i+1];
}
const USAGE = `电影机位与灯光推演（本地、无上传）\n  init <shots.json> --out <scene.json>\n  validate <shots.json> <scene.json>\n  render <shots.json> <scene.json> --out <report.html> [--video <local-video>]\n`;
export function main(argv) {
  const [cmd, shotsFile, sceneFile] = argv;
  if (!cmd || ['--help','-h'].includes(cmd)) { process.stdout.write(USAGE); return; }
  if (!['init','validate','render'].includes(cmd)) throw new Error(USAGE);
  if (!shotsFile) throw new Error('缺少 shots.json');
  const shots = readJson(shotsFile);
  if (cmd === 'init') {
    const out = getOption(argv,'--out');
    if (!out) throw new Error('init 需要 --out');
    writeFileSync(out,JSON.stringify(initScene(shots),null,2)+'\n',{flag:'wx'});
    process.stdout.write(`已建立未知骨架：${out}；请检查画面后填写，未做自动推演。\n`); return;
  }
  if (!sceneFile || sceneFile.startsWith('--')) throw new Error('缺少 scene.json');
  const scene = readJson(sceneFile), checks = validateScene(shots,scene);
  if (cmd === 'validate') {
    process.stdout.write(JSON.stringify(checks,null,2)+'\n');
    if (!checks.ok) process.exitCode = 1;
    return;
  }
  const out = getOption(argv,'--out');
  if (!out || extname(out).toLowerCase() !== '.html') throw new Error('render 需要 --out <report.html>');
  for (const input of [shotsFile,sceneFile,getOption(argv,'--video') || shots.source].filter(Boolean)) {
    const inputPath = input === shots.source ? resolve(dirname(resolve(shotsFile)),input) : resolve(input);
    if (resolve(out) === inputPath) throw new Error('输出不能覆盖输入');
  }
  const report = renderReport(shots,scene,{baseDir:dirname(resolve(shotsFile)),outDir:dirname(resolve(out)),video:getOption(argv,'--video') || shots.source});
  // Compute fully before writing: failed validation preserves an existing report.
  writeFileSync(out,report);
  process.stdout.write(`已生成 ${out} · 结构校验通过 · ${checks.warnings.length} 条待补/提示；结构通过不等于真实片场已验证。\n`);
}
let isMain = false;
try { isMain = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch {}
if (isMain) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 1; }
}
