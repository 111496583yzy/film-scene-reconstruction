(function(root){
'use strict';
const VERSION=1;
const LIMITS=Object.freeze({shots:1000,actors:500,scenes:200,elements:1000,historyBytes:24*1024*1024,fileBytes:24*1024*1024});
const POSES=['standing','seated','kneeling','prone'];
const ELEMENTS=['wall','door','window','stage','furniture','zone','curtain','portrait','stairs','pillar'];
const copy=x=>JSON.parse(JSON.stringify(x));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const point=x=>Array.isArray(x)&&x.length===2&&x.every(n=>finite(n)&&n>=0&&n<=100);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=240;
const id=x=>typeof x==='string'&&x.length>0&&x.length<=120&&!/[\x00-\x1f]/.test(x);
const color=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
const reference=x=>typeof x==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x)&&x.length<LIMITS.fileBytes;
const claim=()=>({status:'proposal',confidence:'low',text:'用户排戏方案；相对摆位和显示参数，不是原片实测。',evidenceIds:[],alternatives:[]});
const unique=(prefix,items)=>{let n=1;const ids=new Set(items.map(x=>x.id));while(ids.has(prefix+n))n++;return prefix+n;};
const keep=(o,keys)=>Object.fromEntries(keys.filter(k=>o&&o[k]!==undefined).map(k=>[k,copy(o[k])]));
const ACTOR_KEYS=['color','skinColor','hairColor','hairStyle','outfit','topColor','bootColor','trimColor','bottomColor','backpack','modelHeight','figureModel'];
const VISUAL_KEYS=['faceColor','hat','gesture','gift','seatedStyle'];
const ELEMENT_KEYS=['id','label','kind','box','height','elevation','color','cutaway','model','detail','panelCount','textureData','headingDeg','levels'];
const LIGHT_KEYS=['id','label','position','target','elevation','targetElevation','role','shape','size','offset','showBeam','sourceType'];
function pose(position=[50,50],headingDeg=0,elevation=0,body='standing'){return{position:copy(position),headingDeg,elevation,pose:body};}
function camera(position=[50,83],target=[50,50],elevation=6,targetElevation=5.5){return{position:copy(position),target:copy(target),elevation,targetElevation};}
function sceneTemplate(){return{id:'R1',name:'我的片场',orientation:'相对摆位，不指定真实方位',scaleNote:'排戏示意，无米制标定',volume:{width:100,depth:100,height:30,humanHeight:8,claim:claim()},floorColor:'#b5b0a1',environment:'day',elements:[],extras:[],fixtures:[]};}
function createProject(title='我的排戏方案'){
 return{kind:'film-rehearsal',schemaVersion:VERSION,title,source:null,actors:[{id:'P1',label:'人物 A',color:'#527f9d',modelHeight:8,hairStyle:'short'},{id:'P2',label:'人物 B',color:'#af785c',modelHeight:8,hairStyle:'long'}],scenes:[sceneTemplate()],shots:[{id:'S1',label:'镜头 1',sceneId:'R1',duration:6,aspect:16/9,referenceShotId:null,actors:[{id:'P1',assetId:'P1',start:pose([40,50],270),end:pose([40,50],270),moving:false},{id:'P2',assetId:'P2',start:pose([60,50],90),end:pose([60,50],90),moving:false}],camera:{start:camera(),end:camera(),moving:false,viewAngle:65,targetActorId:null}}]};
}
function safeScene(raw){
 const s=keep(raw,['id','name','orientation','scaleNote','volume','floorColor','floorTiles','environment','overview','noFloor','orientationMarkers','annexes']);
 s.volume.claim=claim();s.elements=(raw.elements||[]).map(e=>({...keep(e,ELEMENT_KEYS),claim:claim()}));s.extras=[];s.fixtures=(raw.fixtures||[]).map(l=>({...keep(l,LIGHT_KEYS),claim:claim()}));
 return s;
}
function fromReport(shots,doc,{shotId=null,all=false}={}){
 const selected=all?shots.shots:shots.shots.filter(s=>s.id===(shotId||shots.shots[0]?.id));
 if(!selected.length)throw new Error('没有可复制的镜头。');
 const p={kind:'film-rehearsal',schemaVersion:VERSION,title:(doc.title||shots.title||'拉片')+' · 我的排戏',source:{title:doc.title||shots.title||'原片分析',fingerprint:doc.binding?.fingerprint||'',shotIds:selected.map(s=>s.id)},actors:[],scenes:[],shots:[]};
 const notes=new Map(doc.shots.map(s=>[s.shotId,s])),setups=new Map(doc.setups.map(s=>[s.id,s])),scenes=new Map(doc.scenes.map(s=>[s.id,s]));
 for(const base of selected){
  const n=notes.get(base.id),rawScene=scenes.get(n?.sceneId);if(!n||!rawScene)throw new Error('原报告缺少对应场景，未复制。');
  if(!p.scenes.some(s=>s.id===rawScene.id)){if(base.size==='none'){const blank=sceneTemplate();blank.id=rawScene.id;blank.name='新片场（原镜头无实体场景）';p.scenes.push(blank);}else p.scenes.push(safeScene(rawScene));}
  const instances=[];
  for(const original of [...(n.subjects||[]),...(rawScene.extras||[])]){
   if(!point(original.position))continue;
   const assetId=String(original.id),instanceId=instances.some(a=>a.id===assetId)?unique('P',instances):assetId;
   if(!p.actors.some(a=>a.id===assetId))p.actors.push({id:assetId,label:original.label||assetId,...keep(original,ACTOR_KEYS),modelHeight:original.modelHeight||rawScene.volume.humanHeight});
   const start=pose(original.position,original.headingDeg||0,original.elevation||0,original.pose||'standing');let end=copy(start),moving=false;
   if(original.motion?.path?.length){const a=original.motion.path[0],b=original.motion.path.at(-1);start.position=copy(a.position);start.headingDeg=a.headingDeg??start.headingDeg;start.elevation=a.elevation??start.elevation;end={...copy(start),position:copy(b.position),headingDeg:b.headingDeg??start.headingDeg,elevation:b.elevation??start.elevation};moving=true;}
   instances.push({id:instanceId,assetId,start,end,moving,visual:keep(original,VISUAL_KEYS),...keep(original,['visibleFrom','visibleUntil']),...(original.motion?.path?.length?{path:copy(original.motion.path)}:{})});
  }
  const rawCam=setups.get(n.setupId)?.camera;let start=rawCam?.position?camera(rawCam.position,rawCam.target,rawCam.elevation??6,rawCam.targetElevation??5.5):camera(),end=copy(start),moving=false;
  if(n.cameraMotion?.path?.length){const a=n.cameraMotion.path[0],b=n.cameraMotion.path.at(-1);start={...start,...keep(a,['position','target','elevation','targetElevation'])};end={...copy(start),...keep(b,['position','target','elevation','targetElevation'])};moving=true;}
  p.shots.push({id:base.id,label:base.frame?base.frame.slice(0,36):base.id,sceneId:n.sceneId,duration:base.seconds,aspect:shots.meta.width/shots.meta.height,referenceShotId:base.id,actors:instances,camera:{start,end,moving,viewAngle:rawCam?.viewAngleDeg??rawCam?.previewAngleDeg??65,targetActorId:null,...(n.cameraMotion?.path?.length?{path:copy(n.cameraMotion.path)}:{})}});
 }
 assertProject(p);return p;
}
function validateProject(p){
 const errors=[];const bad=s=>{if(errors.length<12)errors.push(s);};
 if(!p||typeof p!=='object'||Array.isArray(p))return{ok:false,errors:['不是有效的排戏工程。']};
 if(p.kind!=='film-rehearsal'||p.schemaVersion!==VERSION)return{ok:false,errors:['这不是当前版本支持的排戏工程，当前方案保持不变。']};
 if(!text(p.title))bad('方案名称不能为空或过长。');
 for(const [key,max] of [['actors',LIMITS.actors],['scenes',LIMITS.scenes],['shots',LIMITS.shots]])if(!Array.isArray(p[key])||p[key].length>max)bad('工程中的'+({actors:'人物',scenes:'场景',shots:'镜头'})[key]+'列表无效或过大。');
 if(errors.length)return{ok:false,errors};
 const map=(xs,label)=>{const m=new Map();for(const o of xs){if(!o||!id(o.id)||m.has(o.id))bad(label+'编号缺失或重复。');else m.set(o.id,o);}return m;};
 const actors=map(p.actors,'人物'),scenes=map(p.scenes,'场景');map(p.shots,'镜头');
 if(!p.scenes.length||!p.shots.length)bad('至少保留一个场景和一个镜头。');
 for(const a of p.actors){if(!a||!text(a.label))bad('人物名称无效。');if(a?.referenceImage!==undefined&&!reference(a.referenceImage))bad('人物参考图必须是工程内的PNG、JPEG或WebP图片。');if(a?.color!==undefined&&!color(a.color))bad('人物颜色无效。');if(a?.modelHeight!==undefined&&(!finite(a.modelHeight)||a.modelHeight<=0||a.modelHeight>10000))bad('人物显示高度无效。');}
 function checkPose(o,label){if(!o||!point(o.position)||!finite(o.headingDeg)||!finite(o.elevation)||o.elevation<0||!POSES.includes(o.pose))bad(label+'站位、朝向或姿势无效。');}
 function checkTrack(path,isCamera){if(path===undefined)return;if(!Array.isArray(path)||path.length<2||path.length>1000||path[0]?.at!==0||path.at(-1)?.at!==1){bad('运动路线必须包含有效的起终点。');return;}let last=-1;for(const node of path){if(!node||!finite(node.at)||node.at<=last||node.at<0||node.at>1||!point(node.position)||(isCamera&&!point(node.target))||(node.elevation!==undefined&&(!finite(node.elevation)||node.elevation<0))||(node.targetElevation!==undefined&&(!finite(node.targetElevation)||node.targetElevation<0))||(node.headingDeg!==undefined&&!finite(node.headingDeg)))bad('运动路线节点无效。');last=node?.at;}}
 function checkCamera(o){if(!o||!point(o.position)||!point(o.target)||!finite(o.elevation)||o.elevation<0||!finite(o.targetElevation)||o.targetElevation<0)bad('摄影机位置或高度无效。');else if(Math.hypot(o.position[0]-o.target[0],o.position[1]-o.target[1])<.01&&Math.abs(o.elevation-o.targetElevation)<.01)bad('摄影机不能与观看目标重合。');}
 for(const s of p.scenes){
  if(!s||!text(s.name)||!s.volume||!['width','depth','height','humanHeight'].every(k=>finite(s.volume[k])&&s.volume[k]>0&&s.volume[k]<=100000)||s.volume.humanHeight>=s.volume.height){bad('场景体积无效。');continue;}
  if(!Array.isArray(s.elements)||s.elements.length>LIMITS.elements){bad('布景列表无效。');continue;}map(s.elements,'布景');
  for(const e of s.elements){if(!e||!text(e.label)||!ELEMENTS.includes(e.kind)||!Array.isArray(e.box)||e.box.length!==4||!e.box.every(finite)||e.box[0]<0||e.box[1]<0||e.box[2]<=0||e.box[3]<=0||e.box[0]+e.box[2]>100.01||e.box[1]+e.box[3]>100.01||!finite(e.height)||e.height<=0||!finite(e.elevation??0)||(e.elevation??0)<0)bad('布景位置或尺寸超出场景。');if(e?.panelCount!==undefined&&(!Number.isInteger(e.panelCount)||e.panelCount<1||e.panelCount>100))bad('墙面分格数量无效。');if(e?.kind==='curtain'&&Math.max(e.box?.[2]||0,e.box?.[3]||0)*Math.max(s.volume.width,s.volume.depth)/100>3000)bad('窗帘显示区域过大。');if(e?.textureData!==undefined&&!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(e.textureData))bad('布景纹理不能引用外部网址。');}
  if(s.floorTiles!==undefined&&(!finite(s.floorTiles)||s.floorTiles<1))bad('场景网格间距必须大于等于1。');
  if(s.extras!==undefined&&(!Array.isArray(s.extras)||s.extras.length))bad('排戏人物必须放在镜头人物列表中。');
  if(s.orientationMarkers!==undefined&&(!Array.isArray(s.orientationMarkers)||s.orientationMarkers.length>50||s.orientationMarkers.some(m=>!m||!text(m.label)||!point(m.position)||!finite(m.elevation??0))))bad('场景方向标记无效。');
  if(s.annexes!==undefined&&(!Array.isArray(s.annexes)||s.annexes.length>50||s.annexes.some(a=>!a||a.side!=='entry'||!['width','depth','height'].every(k=>finite(a[k])&&a[k]>0&&a[k]<=2000))))bad('场景附属区域无效。');
  if(s.referenceImage!==undefined&&!reference(s.referenceImage))bad('场景参考图必须嵌入工程。');
  if(s.environment!==undefined&&!['day','night'].includes(s.environment))bad('场景展示环境无效。');
  if(s.overview&&(!['position','target'].every(k=>Array.isArray(s.overview[k])&&s.overview[k].length===3&&s.overview[k].every(finite))))bad('场景总览方向无效。');
  if(s.fixtures!==undefined&&(!Array.isArray(s.fixtures)||s.fixtures.length>200)){bad('灯光显示列表无效。');}else for(const l of s.fixtures||[]){if(!l||(!point(l.position)&&l.position!==null)||(!point(l.target)&&l.target!==null)||!finite(l.elevation??0)||(l.elevation??0)<0||!finite(l.targetElevation??0)||(l.targetElevation??0)<0||(l.size!==undefined&&(!Array.isArray(l.size)||l.size.length!==2||!l.size.every(n=>finite(n)&&n>0&&n<=2000)))||(l.offset!==undefined&&(!Array.isArray(l.offset)||l.offset.length!==3||!l.offset.every(finite))))bad('灯光显示区域无效。');}
 }
 for(const s of p.shots){
  if(!s||!text(s.label)||!scenes.has(s.sceneId)||!finite(s.duration)||s.duration<=0||s.duration>3600||!finite(s.aspect)||s.aspect<=.1||s.aspect>10){bad('镜头名称、场景、时长或画幅无效。');continue;}
  if(!Array.isArray(s.actors)||s.actors.length>LIMITS.actors){bad('镜头人物列表无效。');continue;}map(s.actors,'镜头人物');
  for(const a of s.actors){if(!a||!actors.has(a.assetId))bad('镜头引用的人物不存在。');checkPose(a?.start,'起点');checkPose(a?.end,'终点');if(a?.visual!==undefined&&(!a.visual||typeof a.visual!=='object'||Array.isArray(a.visual)||(a.visual.faceColor!==undefined&&!color(a.visual.faceColor))||['hat','gift'].some(k=>a.visual[k]!==undefined&&typeof a.visual[k]!=='boolean')))bad('镜头内的人物造型状态无效。');if(!finite(a?.visibleFrom??0)||!finite(a?.visibleUntil??1)||(a?.visibleFrom??0)<0||(a?.visibleUntil??1)>1||(a?.visibleFrom??0)>(a?.visibleUntil??1))bad('人物出现时段无效。');checkTrack(a?.path,false);if(typeof a?.moving!=='boolean')bad('人物走位设置无效。');}
  if(!s.camera){bad('镜头缺少摄影机。');continue;}checkCamera(s.camera.start);checkCamera(s.camera.end);checkTrack(s.camera.path,true);
  if(!finite(s.camera.viewAngle)||s.camera.viewAngle<=0||s.camera.viewAngle>=170||typeof s.camera.moving!=='boolean')bad('取景宽窄或运镜设置无效。');
  if(s.camera.targetActorId!==null&&!s.actors.some(a=>a.id===s.camera.targetActorId))bad('摄影机跟随的人物不在当前镜头中。');
 }
 return{ok:errors.length===0,errors};
}
function assertProject(p){const v=validateProject(p);if(!v.ok)throw new Error(v.errors.join('\n'));return p;}
function parseProject(raw){
 if(typeof raw!=='string'||raw.length>LIMITS.fileBytes)throw new Error('工程文件过大或无法读取。');
 let p;try{p=JSON.parse(raw,(k,v)=>{if(['__proto__','prototype','constructor'].includes(k))throw new Error('不安全的工程字段。');return v;});}catch(e){throw new Error('工程文件格式不正确，当前方案没有改变。');}
 assertProject(p);return copy(p);
}
function interpolate(a,b,t,angle=false){if(angle)return a+(((b-a+540)%360)-180)*t;return a+(b-a)*t;}
function samplePose(a,b,t){return{...copy(a),position:a.position.map((v,i)=>interpolate(v,b.position[i],t)),elevation:interpolate(a.elevation,b.elevation,t),headingDeg:interpolate(a.headingDeg,b.headingDeg,t,true)};}
function sampleCamera(a,b,t){return{position:a.position.map((v,i)=>interpolate(v,b.position[i],t)),target:a.target.map((v,i)=>interpolate(v,b.target[i],t)),elevation:interpolate(a.elevation,b.elevation,t),targetElevation:interpolate(a.targetElevation,b.targetElevation,t)};}
function sampleTrack(start,end,path,t,isCamera){const sample=isCamera?sampleCamera:samplePose;if(!path?.length)return sample(start,end,t);let i=path.findIndex((n,k)=>k<path.length-1&&t>=n.at&&t<=path[k+1].at);if(i<0)i=path.length-2;const a={...copy(start),...keep(path[i],['position','target','elevation','targetElevation','headingDeg'])},b={...copy(end),...keep(path[i+1],['position','target','elevation','targetElevation','headingDeg'])};return sample(a,b,(t-path[i].at)/(path[i+1].at-path[i].at));}
function frame(p,shotId,progress=0){
 const s=p.shots.find(s=>s.id===shotId);if(!s)throw new Error('找不到镜头。');const t=Math.max(0,Math.min(1,finite(progress)?progress:0)),scene=p.scenes.find(r=>r.id===s.sceneId);
 const subjects=s.actors.filter(a=>t>=(a.visibleFrom??0)&&t<=(a.visibleUntil??1)).map(a=>{const asset=p.actors.find(x=>x.id===a.assetId),at=sampleTrack(a.start,a.moving?a.end:a.start,a.moving?a.path:null,t,false);return{...keep(asset,ACTOR_KEYS),...keep(a.visual,VISUAL_KEYS),...at,id:a.id,label:asset.label,claim:claim()};});
 const cam=sampleTrack(s.camera.start,s.camera.moving?s.camera.end:s.camera.start,s.camera.moving?s.camera.path:null,t,true);
 if(s.camera.targetActorId){const who=subjects.find(a=>a.id===s.camera.targetActorId);if(who){cam.target=copy(who.position);cam.targetElevation=who.elevation+(who.modelHeight||scene.volume.humanHeight)*.72;}}
 const setup={id:'C'+(p.shots.indexOf(s)+1),sceneId:s.sceneId,label:'我的机位',camera:{...cam,viewAngleDeg:null,previewAngleDeg:s.camera.viewAngle,previewClaim:claim(),claim:claim()}};
 return{scene,note:{shotId:s.id,sceneId:s.sceneId,setupId:setup.id,subjects,lighting:[],cameraNote:claim(),lens:claim(),lightNote:claim(),interpretation:claim(),reproduction:claim()},setup,aspect:s.aspect};
}
function shotAtTime(p,seconds){let cursor=0;for(let i=0;i<p.shots.length;i++){const s=p.shots[i];if(seconds<cursor+s.duration||i===p.shots.length-1)return{shot:s,index:i,local:Math.max(0,Math.min(s.duration,seconds-cursor)),start:cursor};cursor+=s.duration;}return null;}
const duration=p=>p.shots.reduce((v,s)=>v+s.duration,0);
function edit(project,command){
 if(!command||typeof command!=='object'||typeof command.type!=='string')throw new Error('编辑参数不完整。');const p=copy(project),s=command.shotId?p.shots.find(x=>x.id===command.shotId):p.shots[0],endpoint=command.endpoint==='end'?'end':'start';if(!s)throw new Error('镜头已变化，请重新选择，其他镜头没有修改。');if(['actor-pose','actor-asset','camera-pose','camera','shot','element','scene'].includes(command.type)&&(!command.patch||typeof command.patch!=='object'||Array.isArray(command.patch)))throw new Error('编辑参数不完整，方案没有修改。');
 const instance=()=>{const a=s.actors.find(a=>a.id===command.actorId);if(!a)throw new Error('没有选中人物。');return a;};
 if(command.type==='title')p.title=command.value;
 else if(command.type==='actor-pose'){const a=instance();Object.assign(a[endpoint],keep(command.patch,['position','headingDeg','elevation','pose']));delete a.path;if(endpoint==='end')a.moving=true;}
 else if(command.type==='actor-full-shot'){const a=instance();delete a.visibleFrom;delete a.visibleUntil;}
 else if(command.type==='actor-motion')instance().moving=!!command.value;
 else if(command.type==='actor-asset'){const a=instance(),asset=p.actors.find(x=>x.id===a.assetId);Object.assign(asset,keep(command.patch,['label','referenceImage',...ACTOR_KEYS]));if(command.patch.referenceImage===null)delete asset.referenceImage;}
 else if(command.type==='camera-pose'){Object.assign(s.camera[endpoint],keep(command.patch,['position','target','elevation','targetElevation']));delete s.camera.path;if(endpoint==='end')s.camera.moving=true;}
 else if(command.type==='camera'){Object.assign(s.camera,keep(command.patch,['moving','viewAngle','targetActorId']));}
 else if(command.type==='shot'){Object.assign(s,keep(command.patch,['label','duration','aspect','sceneId']));}
 else if(command.type==='add-actor'){
  let assetId=command.assetId;if(assetId&&!p.actors.some(a=>a.id===assetId))throw new Error('所选人物资料不存在。');if(!assetId){assetId=unique('P',p.actors);const name='人物 '+(p.actors.length+1);p.actors.push({id:assetId,label:name,color:'#728ba5',modelHeight:p.scenes.find(x=>x.id===s.sceneId).volume.humanHeight,hairStyle:'short'});}s.actors.push({id:unique('P',s.actors),assetId,start:pose(),end:pose(),moving:false});
 }
 else if(command.type==='remove-actor'){const a=instance();s.actors=s.actors.filter(x=>x.id!==a.id);if(s.camera.targetActorId===a.id)s.camera.targetActorId=null;}
 else if(command.type==='clone-shot'){const n=copy(s);n.id=unique('S',p.shots);n.label=s.label+' · 副本';n.referenceShotId=null;p.shots.splice(p.shots.indexOf(s)+1,0,n);}
 else if(command.type==='remove-shot'){if(p.shots.length<=1)throw new Error('至少保留一个镜头。');p.shots=p.shots.filter(x=>x.id!==s.id);}
 else if(command.type==='move-shot'){if(![-1,1].includes(command.delta))throw new Error('镜头移动方向无效。');const i=p.shots.indexOf(s),j=Math.max(0,Math.min(p.shots.length-1,i+command.delta));p.shots.splice(i,1);p.shots.splice(j,0,s);}
 else if(command.type==='new-scene'){const n=sceneTemplate();n.id=unique('R',p.scenes);n.name='场景 '+(p.scenes.length+1);p.scenes.push(n);s.sceneId=n.id;}
 else if(['element','add-element','remove-element','scene'].includes(command.type)){
  let scene=p.scenes.find(x=>x.id===s.sceneId);if(command.scope!=='scene'&&p.shots.filter(x=>x.sceneId===scene.id).length>1){scene=copy(scene);scene.id=unique('R',p.scenes);scene.name+=' · 当前镜';p.scenes.push(scene);s.sceneId=scene.id;}
  if(command.type==='scene'){Object.assign(scene,keep(command.patch,['name','referenceImage']));if(command.patch.referenceImage===null)delete scene.referenceImage;}
  else if(command.type==='element'){const e=scene.elements.find(x=>x.id===command.elementId);if(!e)throw new Error('没有选中布景。');Object.assign(e,keep(command.patch,ELEMENT_KEYS.filter(k=>k!=='id')));}
  else if(command.type==='remove-element')scene.elements=scene.elements.filter(x=>x.id!==command.elementId);
  else{
   const templates={table:{label:'桌子',kind:'furniture',model:'table',box:[42,42,16,12],height:3.2,color:'#a9936f'},chair:{label:'座椅',kind:'furniture',model:'bench',box:[45,45,7,7],height:4,color:'#8b9c9f'},wall:{label:'墙体',kind:'wall',box:[12,15,65,2],height:20,color:'#b9b4a6'},door:{label:'门框',kind:'door',box:[42,15,14,2],height:16,color:'#a38e6e'},window:{label:'窗户',kind:'window',box:[20,15,26,1],height:13,color:'#b8c5c1'},stage:{label:'台面',kind:'stage',box:[38,35,24,18],height:1.5,color:'#9e8d75'}};
   const e=templates[command.preset];if(!e)throw new Error('不支持这种布景。');scene.elements.push({...copy(e),id:unique('E',scene.elements),elevation:0,claim:claim()});
  }
 }
 else throw new Error('不支持这项编辑。');
 assertProject(p);return p;
}
class History{
 constructor(project){this.project=assertProject(copy(project));this.past=[];this.future=[];this.dragBase=null;}
 push(before){this.past.push(before);let bytes=this.past.reduce((n,p)=>n+JSON.stringify(p).length,0);while(this.past.length>1&&(this.past.length>60||bytes>LIMITS.historyBytes))bytes-=JSON.stringify(this.past.shift()).length;this.future=[];}
 apply(command){const next=edit(this.project,command);if(JSON.stringify(next)!==JSON.stringify(this.project)){this.push(this.project);this.project=next;}return this.project;}
 begin(){if(this.dragBase)this.cancel();this.dragBase=this.project;}
 preview(command){if(!this.dragBase)this.begin();this.project=edit(this.dragBase,command);return this.project;}
 commit(){if(this.dragBase&&JSON.stringify(this.dragBase)!==JSON.stringify(this.project))this.push(this.dragBase);this.dragBase=null;return this.project;}
 cancel(){if(this.dragBase)this.project=this.dragBase;this.dragBase=null;return this.project;}
 undo(){this.cancel();if(this.past.length){this.future.push(this.project);this.project=this.past.pop();}return this.project;}
 redo(){this.cancel();if(this.future.length){this.past.push(this.project);this.project=this.future.pop();}return this.project;}
}
function demoProject(){let p=createProject('门口到桌边 · 排戏示例');for(const preset of ['door','table','chair'])p=edit(p,{type:'add-element',preset,scope:'scene'});const s=p.shots[0];s.label='人物 A 从门口走到桌边';s.actors[0].start=pose([49,20],180);s.actors[0].end=pose([49,46],270);s.actors[0].moving=true;s.actors[1].start=pose([61,48],90,0,'seated');s.actors[1].end=copy(s.actors[1].start);p=edit(p,{type:'clone-shot',shotId:s.id});p.shots[1].label='人物 B 的反应';p.shots[1].actors[0].start=copy(p.shots[1].actors[0].end);p.shots[1].actors[0].moving=false;p.shots[1].camera.start=camera([51,61],[61,48],6,4.5);p.shots[1].camera.end=copy(p.shots[1].camera.start);p.shots[1].camera.viewAngle=48;assertProject(p);return p;}
function serializeProject(p){assertProject(p);const raw=JSON.stringify(p,null,2)+'\n';if(raw.length>LIMITS.fileBytes)throw new Error('工程过大，请减少参考图后保存。');return raw;}
function persistDraft(storage,p,key){try{const raw=serializeProject(p);storage.setItem(key,raw);return{saved:true,error:null};}catch(e){return{saved:false,error:e.message||'本机草稿无法保存。'};}}
function standaloneHtml(project,resources){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const data=serializeProject(project).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'),close='<'+ '/script>';
 for(const k of ['styles','template','three','model','controller'])if(typeof resources?.[k]!=='string'||!resources[k])throw new Error('缺少离线排戏资源：'+k);
 const script=(id,type,code)=>'<script id="'+id+'"'+(type?' type="'+type+'"':'')+'>'+code.replace(/<\/script/gi,'<\\/script')+close;
 return '<!doctype html><html lang="zh-CN" data-theme="'+(resources.theme==='dark'?'dark':'light')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(project.title)+'</title><style id="report-style">'+resources.styles+'</style></head><body>'+resources.template+script('rehearsal-data','application/json',data)+script('report-3d','',resources.three)+script('rehearsal-model','',resources.model)+script('rehearsal-license','text/plain',String(resources.license||'').replace(/</g,'&lt;'))+script('rehearsal-controller','',resources.controller)+'</body></html>';
}
const api={standaloneHtml,serializeProject,persistDraft,VERSION,LIMITS,copy,claim,pose,camera,createProject,fromReport,validateProject,assertProject,parseProject,frame,shotAtTime,duration,edit,History,demoProject};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FilmRehearsalProject=api;
})(typeof globalThis!=='undefined'?globalThis:this);
