#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {worldPoint,boxWorld,horizontalToVerticalFov,interpolatePose,frustumCorners,geometrySummary,interpolateSubject} from '../assets/scene-math.mjs';
import {CAMERA_ANNOTATION,cameraAnnotationStyle} from '../assets/scene-style.mjs';
import ReportModel from '../assets/ui-state.cjs';
import {validateScene,renderReport,initScene} from './scene-report.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const shots=JSON.parse(readFileSync(join(root,'examples/scene-demo-shots.json'),'utf8'));
const scene=JSON.parse(readFileSync(join(root,'examples/scene-demo.json'),'utf8'));
let passed=0;
function test(name,fn){try{fn();passed++;}catch(e){process.stderr.write(`FAIL ${name}: ${e.stack}\n`);process.exitCode=1;}}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} !== ${b}`);
test('camera annotation normalizes a semantic theme color',()=>assert.equal(cameraAnnotationStyle('  #2457DF  ').color,'#2457df'));
test('camera annotation rejects malformed or missing theme colors',()=>{for(const value of [undefined,null,42,{},'', 'red','#abc','#2457dfff','url(https://example.invalid)'])assert.equal(cameraAnnotationStyle(value).color,CAMERA_ANNOTATION.fallbackColor);});
test('camera label and outline use one annotation color',()=>{const s=cameraAnnotationStyle('#3163d9');assert.equal(s.color,'#3163d9');assert.equal(s.labelText,'#ffffff');assert.equal(s.edgeOpacity,1);});
test('camera fill stays translucent without weakening its edges',()=>{const s=cameraAnnotationStyle();assert.ok(s.fillOpacity>0&&s.fillOpacity<=.06);assert.ok(s.edgeOpacity>=.9);assert.ok(s.bodyEmissive>0&&s.tripodEmissive>0);});
test('camera style resolution never mutates its shared defaults',()=>{const before={...CAMERA_ANNOTATION};const s=cameraAnnotationStyle('#123456');s.fillOpacity=1;assert.deepEqual({...CAMERA_ANNOTATION},before);assert.ok(cameraAnnotationStyle().fillOpacity<1);});
function colorLuminance(hex){const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;}
function colorContrast(a,b){const v=[colorLuminance(a),colorLuminance(b)].sort((x,y)=>x-y);return(v[1]+.05)/(v[0]+.05);}
test('declared camera label pair retains readable contrast',()=>{const s=cameraAnnotationStyle();assert.ok(colorContrast(s.labelText,s.color)>=4.5);});
test('default camera annotation separates from declared neutral floor and dark backdrop',()=>{const s=cameraAnnotationStyle();for(const bg of ['#cac3b4','#0a0a0a'])assert.ok(colorContrast(s.color,bg)>=3);});
const volume={width:100,depth:140,height:30,humanHeight:7.5};
// Exercise the shipped renderer functions with lightweight display objects. These
// tests cover color/geometry orchestration, not WebGL rendering or visual QA.
const rendererSource=readFileSync(join(root,'assets/scene3d-source.mjs'),'utf8');
function rendererFunction(start,end,name,environment){
  const from=rendererSource.indexOf(start),to=rendererSource.indexOf(end,from);
  assert.ok(from>=0&&to>from,`renderer function ${name} is available`);
  const body=rendererSource.slice(from,to).replace(/^ ([a-zA-Z]+)\(/,'function $1(');
  return Function(...Object.keys(environment),`${body};return ${name};`)(...Object.values(environment));
}
function displayHarness({others=false}={}){
  const rigs=[],lines=[],labels=[],legs=[],meshes=[];
  class Color{constructor(value){this.value=value?.value??value;}copy(value){this.value=value?.value??value;return this;}}
  class Vector3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}distanceTo(b){return Math.hypot(this.x-b.x,this.y-b.y,this.z-b.z);}}
  class Group{
    constructor(){this.children=[];this.position={copy:p=>this.location=p};}
    add(...objects){this.children.push(...objects);}lookAt(){}rotateY(){}
    traverse(fn){fn(this);for(const child of this.children)child.traverse?child.traverse(fn):fn(child);}
    clear(){this.children=[];}
  }
  class Geometry{constructor(...values){this.values=values;}setAttribute(name,value){this[name]=value;}computeVertexNormals(){}}
  class SphereGeometry extends Geometry{}
  const material=(color,extra={})=>({color:new Color(color),emissive:new Color(extra.emissive??0),...extra,clone(){return material(this.color,{...extra});}});
  const mesh=(geometry,mat,parent,position)=>{const o={geometry,material:mat,position,rotation:{}};parent.add(o);meshes.push(o);return o;};
  const THREE={Color,Group,Vector3,SphereGeometry,BoxGeometry:Geometry,CylinderGeometry:Geometry,BufferGeometry:Geometry,Float32BufferAttribute:Geometry,DoubleSide:2,Plane:class{constructor(normal,constant){Object.assign(this,{normal,constant});}},MeshBasicMaterial:class{constructor(options){Object.assign(this,options);}},Mesh:class{constructor(geometry,mat){Object.assign(this,{geometry,material:mat});}}};
  const env={THREE,CAMERA_ANNOTATION,worldPoint,frustumCorners,V:p=>new Vector3(...p),material,mesh,
    beam(parent,a,b,r,color){const o=mesh(new Geometry(r,r),material(color),parent);legs.push({a,b,r,color,o});return o;},
    line(parent,points,color,opacity,dashed){const o={material:{color,opacity},points};lines.push({points,color,opacity,dashed,o});parent.add(o);return o;}};
  const makeRig=rendererFunction('function makeRig(', '\nfunction drawFrustum(', 'makeRig',env);
  const drawFrustum=rendererFunction('function drawFrustum(', '\nfunction lightRig(', 'drawFrustum',env);
  const drawDynamic=rendererFunction(' drawDynamic(){', '\n setOptions(', 'drawDynamic',{
    ...env,ReportModel,cameraAnnotationStyle,interpolatePose,interpolateSubject,
    disposeGroup:g=>{g.clear();for(const list of [rigs,lines,labels,legs,meshes])list.length=0;},mannequin(){},lightRig(){},asColor:v=>v,
    makeRig(parent,cam,vol,color,opacity=1){const result=makeRig(parent,cam,vol,color,opacity);rigs.push({cam,color,opacity,result});return result;},
    drawFrustum,
    makeLabel(name,text,options={}){const label={name,text,options,material:{},position:{set(...p){label.location=p;}}};labels.push(label);return label;},
  });
  const viewer={vol:volume,sceneData:{},scene:{background:{set(){}}},dynamicGroup:new Group(),showLights:false,showOthers:others,aspect:2,progress:0,mode:'overview',container:{dataset:{}},camSnap(){return null;},render(){},fadeLabels(){},tweenFrom(){},applyShotView(){}};
  viewer.drawDynamic=drawDynamic;
  viewer.setShot=rendererFunction(' setShot(', '\n drawDynamic(', 'setShot',{});
  viewer.setOptions=rendererFunction(' setOptions(', '\n setTheme(', 'setOptions',{});
  viewer.setTheme=rendererFunction(' setTheme(', '\n setMode(', 'setTheme',{});
  return{viewer,drawDynamic,makeRig,drawFrustum,Group,Color,rigs,lines,labels,legs,meshes,get markers(){return meshes.filter(m=>m.geometry instanceof SphereGeometry);}};
}
const cameraSetups=[
  {id:'A',label:'左侧',sceneId:'R1',color:'#e2ac45',camera:{position:[20,35],target:[50,60],elevation:6,viewAngleDeg:60}},
  {id:'B',label:'右侧',sceneId:'R1',color:'#865ce6',camera:{position:[80,35],target:[50,60],elevation:6,viewAngleDeg:50}},
  {id:'unknown',sceneId:'R1',color:'#6c9bcc',camera:{position:null,target:null,viewAngleDeg:null}},
  {id:'elsewhere',sceneId:'R2',color:'#ce6c88',camera:{position:[40,40],target:[50,60],elevation:6,viewAngleDeg:60}},
];
function drawSetup(h,index=0,setups=cameraSetups){h.viewer.setShot({shotId:`S${index}`,setupId:setups[index].id,sceneId:setups[index].sceneId,subjects:[]},setups[index],setups,2,0);return h;}
const rigAt=(h,setup)=>h.rigs.find(r=>JSON.stringify(r.cam.position)===JSON.stringify(setup.camera.position));
const markerAt=(h,setup)=>h.markers.find(m=>JSON.stringify(m.position)===JSON.stringify(worldPoint(setup.camera.position,setup.camera.elevation??volume.humanHeight*.78,volume)));
const annotationColor=(h,setup)=>rigAt(h,setup)?.color.value??markerAt(h,setup)?.material.color.value;
test('renderer uses the report model as its only setup color source',()=>{assert.match(rendererSource,/import ReportModel from '\.\/ui-state\.cjs'/);assert.ok(!rendererSource.includes("getPropertyValue('--camera')"));});
test('constructor and default display keep candidate comparison disabled',()=>{const constructor=rendererSource.slice(rendererSource.indexOf(' constructor('),rendererSource.indexOf('\n setScene('));assert.match(constructor,/this\.showOthers=false/);const h=drawSetup(displayHarness());assert.equal(h.viewer.showOthers,false);assert.equal(h.rigs.length,1);assert.equal(h.labels.length,1);assert.equal(h.markers.length,0);assert.equal(h.viewer.otherRigs.children.length,0);assert.equal(h.lines.length,7);});
test('the current camera body and tripod retain its setup color',()=>{const h=drawSetup(displayHarness()),active=h.rigs[0];assert.equal(active.color.value,cameraSetups[0].color);assert.equal(active.opacity,1);for(const body of active.result.group.children.slice(0,2)){assert.equal(body.material.color.value,cameraSetups[0].color);assert.equal(body.material.opacity,1);}for(const leg of h.legs)assert.equal(leg.o.material.color.value,cameraSetups[0].color);});
test('comparison opt-in adds only a colored sphere and ID for each known same-scene candidate',()=>{const h=drawSetup(displayHarness({others:true})),marker=markerAt(h,cameraSetups[1]);assert.equal(h.rigs.length,1);assert.equal(h.legs.length,3);assert.equal(h.markers.length,1);assert.ok(marker);assert.deepEqual(marker.geometry.values,[.6,10,8]);assert.equal(marker.material.color.value,cameraSetups[1].color);assert.equal(marker.material.opacity,.55);assert.equal(marker.material.transparent,true);assert.deepEqual(marker.position,worldPoint(cameraSetups[1].camera.position,6,volume));assert.ok(h.labels.some(l=>l.name==='B'));assert.ok(!h.labels.some(l=>/unknown|elsewhere/.test(l.name)));});
test('comparison never draws a non-current frustum, fill or targeting line',()=>{const h=drawSetup(displayHarness({others:true}));assert.equal(h.lines.length,7);assert.ok(h.lines.every(l=>l.color.value===cameraSetups[0].color));const meshes=[];h.viewer.otherRigs.traverse(o=>{if(o.geometry)meshes.push(o);});assert.equal(meshes.length,1);assert.equal(meshes[0],h.markers[0]);assert.equal(h.viewer.activeRig.children.filter(o=>o.geometry?.position).length,1);});
test('turning comparison on and off changes markers only and clears all candidate objects',()=>{const h=drawSetup(displayHarness()),pos=h.rigs[0].result.pos;h.viewer.setOptions({lights:false,others:true});assert.equal(h.markers.length,1);assert.equal(h.labels.length,2);assert.equal(h.rigs.length,1);assert.equal(h.lines.length,7);assert.equal(h.viewer.container.dataset.cameraDisplay,'comparison');assert.deepEqual(JSON.parse(h.viewer.container.dataset.comparisonSetups),['B']);h.viewer.setOptions({lights:false,others:false});assert.equal(h.markers.length,0);assert.equal(h.labels.length,1);assert.equal(h.viewer.otherRigs.children.length,0);assert.equal(h.rigs.length,1);assert.equal(h.lines.length,7);assert.equal(h.viewer.container.dataset.cameraDisplay,'current-only');assert.deepEqual(JSON.parse(h.viewer.container.dataset.comparisonSetups),[]);assert.deepEqual(h.rigs[0].result.pos,pos);});
test('switching the active shot preserves colors between a marker and the current rig',()=>{const a=drawSetup(displayHarness({others:true}),0),b=drawSetup(displayHarness({others:true}),1);for(const setup of cameraSetups.slice(0,2))assert.equal(annotationColor(a,setup),annotationColor(b,setup));});
test('theme changes preserve identity colors and the user comparison choice',()=>{for(const others of [false,true]){const h=drawSetup(displayHarness({others})),before=h.labels.map(l=>[l.text,l.options.background]);h.viewer.setTheme('light');assert.equal(h.viewer.showOthers,others);assert.deepEqual(h.labels.map(l=>[l.text,l.options.background]),before);h.viewer.setTheme('dark');assert.equal(h.viewer.showOthers,others);assert.deepEqual(h.labels.map(l=>[l.text,l.options.background]),before);}});
test('shot and within-shot updates never automatically enable comparison',()=>{const h=drawSetup(displayHarness());drawSetup(h,1);assert.equal(h.viewer.showOthers,false);assert.equal(h.markers.length,0);h.viewer.setShot({...h.viewer.note},h.viewer.setup,cameraSetups,2,.5);assert.equal(h.viewer.showOthers,false);assert.equal(h.markers.length,0);h.viewer.setOptions({lights:false,others:true});drawSetup(h,0);assert.equal(h.viewer.showOthers,true);assert.equal(h.markers.length,1);});
test('every current or candidate label gets contrast text from the shared color model',()=>{for(const h of [drawSetup(displayHarness({others:true}),0),drawSetup(displayHarness({others:true}),1)])for(const label of h.labels){assert.equal(label.text,ReportModel.colorText(label.options.background));assert.ok(colorContrast(label.text,label.options.background)>=4.5);}});
test('current camera is a full rig with a larger label, candidates are only small markers',()=>{const h=drawSetup(displayHarness({others:true}));assert.ok(h.labels.find(l=>l.name.startsWith('A ·')).options.height>h.labels.find(l=>l.name==='B').options.height);assert.equal(h.rigs.length,1);assert.equal(h.legs.length,3);assert.equal(h.markers.length,1);});
test('an unknown current position draws no camera equipment or labels by default',()=>{const h=drawSetup(displayHarness(),2);assert.equal(h.viewer.activeRig,null);assert.equal(h.rigs.length,0);assert.equal(h.legs.length,0);assert.equal(h.lines.length,0);assert.equal(h.markers.length,0);assert.equal(h.labels.length,0);});
test('comparison with an unknown current camera still adds no equipment or unknown marker',()=>{const h=drawSetup(displayHarness({others:true}),2);assert.equal(h.viewer.activeRig,null);assert.equal(h.rigs.length,0);assert.equal(h.legs.length,0);assert.equal(h.lines.length,0);assert.equal(h.markers.length,2);assert.ok(h.labels.every(l=>l.name==='A'||l.name==='B'));});
test('other-scene candidates never appear in comparison',()=>{const h=drawSetup(displayHarness({others:true}));assert.equal(markerAt(h,cameraSetups[3]),undefined);assert.ok(!h.labels.some(l=>l.name==='elsewhere'));});
test('single uncolored rehearsal setup keeps the shared blue fallback',()=>{const setup={...cameraSetups[0]};delete setup.color;const h=drawSetup(displayHarness(),0,[setup]);assert.equal(h.rigs[0].color.value,'#4c8dff');assert.equal(h.rigs[0].color.value,ReportModel.setupColor(setup,[]));});
test('uncolored multi-setup markers keep identity colors after reordering',()=>{const setups=cameraSetups.slice(0,2).map(({color,...s})=>s),a=drawSetup(displayHarness({others:true}),0,setups),b=drawSetup(displayHarness({others:true}),0,[...setups].reverse());for(const setup of setups){assert.equal(annotationColor(a,setup),ReportModel.setupColor(setup,setups));assert.equal(annotationColor(a,setup),annotationColor(b,setup));}});
test('a current unmeasured angle draws no frustum even if a candidate angle is known',()=>{const setups=cameraSetups.slice(0,2).map((s,i)=>({...s,camera:{...s.camera,viewAngleDeg:i?50:null}})),h=drawSetup(displayHarness({others:true}),0,setups);assert.equal(h.lines.length,0);assert.equal(h.rigs.length,1);assert.equal(h.markers.length,1);assert.equal(h.viewer.activeRig.children.filter(o=>o.geometry?.position).length,0);});
test('a known setup is restored after visiting an unknown camera position',()=>{const h=drawSetup(displayHarness());assert.ok(h.viewer.activeRig);drawSetup(h,2);assert.equal(h.viewer.activeRig,null);drawSetup(h,1);assert.ok(h.viewer.activeRig);assert.deepEqual(h.viewer.pose.position,cameraSetups[1].camera.position);assert.equal(h.rigs.at(-1).color.value,cameraSetups[1].color);});
test('comparison styling does not change camera geometry or source facts',()=>{const before=structuredClone(cameraSetups),a=drawSetup(displayHarness(),0),b=drawSetup(displayHarness({others:true}),0);assert.deepEqual(rigAt(a,cameraSetups[0]).result.pos,rigAt(b,cameraSetups[0]).result.pos);assert.deepEqual(rigAt(a,cameraSetups[0]).result.target,rigAt(b,cameraSetups[0]).result.target);assert.deepEqual(a.lines.map(l=>l.points),b.lines.map(l=>l.points));drawSetup(b,1);b.viewer.setTheme('light');b.viewer.setOptions({lights:false,others:false});assert.deepEqual(cameraSetups,before);});
test('center is a real XYZ position with elevation',()=>assert.deepEqual(worldPoint([50,50],6,volume),[0,6,0]));
test('horizontal depth maps to Z, not a 2D skew',()=>assert.deepEqual(worldPoint([100,100],12,volume),[50,12,70]));
test('unknown position remains absent',()=>assert.equal(worldPoint(null,0,volume),null));
test('room bounds and box scale',()=>{const b=boxWorld([10,20,30,40],volume);b.center.forEach((n,i)=>near(n,[-25,0,-14][i]));near(b.width,30);near(b.depth,56);});
test('horizontal and vertical angle are not confused',()=>near(horizontalToVerticalFov(90,2),53.13010235415598));
test('square image preserves fov',()=>near(horizontalToVerticalFov(50,1),50));
test('invalid angle rejected',()=>{for(const f of [0,170,-1,NaN])assert.throws(()=>horizontalToVerticalFov(f,2));});
test('invalid aspect rejected',()=>assert.throws(()=>horizontalToVerticalFov(60,0)));
const corners=frustumCorners([0,5,0],[0,5,-10],60,2,1,10);
test('8 actual 3D frustum corners',()=>{assert.equal(corners.length,8);assert.ok(corners.every(p=>p.length===3&&p.every(Number.isFinite)));});
test('frustum near/far distances',()=>{corners.slice(0,4).forEach(p=>near(p[2],-1));corners.slice(4).forEach(p=>near(p[2],-10));});
test('far plane is larger in real perspective',()=>near(Math.abs(corners[4][0]/corners[0][0]),10));
test('3D vertical spread is nonzero',()=>assert.ok(Math.max(...corners.map(p=>p[1]))-Math.min(...corners.map(p=>p[1]))>5));
test('horizontal/vertical ratio matches source film',()=>{const c=corners.slice(4);near((Math.max(...c.map(p=>p[0]))-Math.min(...c.map(p=>p[0])))/(Math.max(...c.map(p=>p[1]))-Math.min(...c.map(p=>p[1]))),2);});
test('tilted view has finite 3D geometry',()=>assert.ok(frustumCorners([4,9,8],[0,2,-3],75,2.38,.5,9).flat().every(Number.isFinite)));
test('vertical view does not degenerate',()=>assert.ok(frustumCorners([0,10,0],[0,0,0],60,1,1,10).flat().every(Number.isFinite)));
test('overlapping camera/target refused',()=>assert.throws(()=>frustumCorners([0,0,0],[0,0,0],60,1,1,10)));
test('invalid near/far refused',()=>assert.throws(()=>frustumCorners([0,0,0],[0,0,-1],60,1,10,1)));
const cam={position:[10,20],target:[50,60],elevation:5};const path=[{at:0,position:[10,20],target:[50,60],elevation:5},{at:1,position:[20,40],target:[60,70],elevation:9}];
test('movement interpolates XYZ elevation and target',()=>{const c=interpolatePose(cam,path,.5);assert.deepEqual(c.position,[15,30]);assert.deepEqual(c.target,[55,65]);assert.equal(c.elevation,7);});
test('movement start clamps',()=>assert.deepEqual(interpolatePose(cam,path,-10).position,[10,20]));
test('movement end clamps',()=>assert.deepEqual(interpolatePose(cam,path,10).position,[20,40]));
test('no path does not invent camera movement',()=>assert.deepEqual(interpolatePose(cam,null,.6),cam));
test('interpolation does not mutate source pose',()=>{interpolatePose(cam,path,.5);assert.equal(cam.elevation,5);assert.deepEqual(cam.position,[10,20]);});
function bad(name,mutate,pattern){test(name,()=>{const d=structuredClone(scene);mutate(d);const r=validateScene(shots,d);assert.equal(r.ok,false);assert.match(r.errors.join('\n'),pattern);});}
bad('old planar schema rejected',d=>d.schemaVersion=1,/三维版本/);
bad('no volume cannot pose as 3D',d=>delete d.scenes[0].volume,/三维体积/);
bad('zero room height rejected',d=>d.scenes[0].volume.height=0,/三维体积/);
bad('negative depth rejected',d=>d.scenes[0].volume.depth=-1,/三维体积/);
bad('invalid human scale rejected',d=>d.scenes[0].volume.humanHeight=50,/三维体积/);
bad('flat stage without height rejected',d=>delete d.scenes[0].elements[0].height,/立体物件/);
bad('height exceeds room rejected',d=>d.scenes[0].elements[0].height=100,/超过配置/);
bad('negative camera elevation rejected',d=>d.setups[0].camera.elevation=-1,/相对高度/);
bad('schematic frustum cannot imply calibration',d=>{d.setups[1].camera.previewAngleDeg=60;d.setups[1].camera.previewClaim={status:'observed',confidence:'low',text:'合成伪校准',evidenceIds:['E1'],alternatives:[]};},/proposal/);
bad('cannot combine calibrated and schematic fov',d=>{d.setups[0].camera.previewAngleDeg=60;d.setups[0].camera.previewClaim={status:'proposal',confidence:'low',text:'仅示意',evidenceIds:[],alternatives:[]};},/示意视锥/);
bad('invalid pose rejected',d=>d.shots[0].subjects[0].pose='billboard',/pose/);
bad('invalid human height rejected',d=>d.shots[0].subjects[0].modelHeight=-2,/modelHeight/);
bad('negative light height rejected',d=>d.shots[0].lighting[0].elevation=-1,/灯位相对高度/);
bad('invalid cross-legged style rejected',d=>d.shots[0].subjects[0].seatedStyle='flat-sticker',/seatedStyle/);
bad('invalid hair geometry style rejected',d=>d.shots[0].subjects[0].hairStyle='remote-mesh',/hairStyle/);
bad('floor detail cannot create runaway mesh count',d=>d.scenes[0].floorTiles=.01,/地砖间隔/);
bad('invalid overview coordinates rejected',d=>d.scenes[0].overview.position=[1,2],/三维 position/);
bad('degenerate overview refused',d=>d.scenes[0].overview.position=[...d.scenes[0].overview.target],/不能重合/);
bad('zero framing margin refused',d=>d.scenes[0].overview.padding=0,/正数/);
bad('invalid corridor dimensions rejected',d=>d.scenes[0].annexes[0].depth=-10,/附属走廊/);
bad('corridor must preserve provenance',d=>delete d.scenes[0].annexes[0].claim,/合法/);
bad('shared lighting shape rejected',d=>d.scenes[0].fixtures[0].shape='unknown-device',/shape/);
bad('shared light size rejected',d=>d.scenes[0].fixtures[0].size=[0,5],/size/);
bad('shared light offset rejected',d=>d.scenes[0].fixtures[0].offset=[0,1],/三维向量/);
bad('duplicate global lighting IDs rejected',d=>d.scenes[0].fixtures.push(structuredClone(d.scenes[0].fixtures[0])),/重复/);
bad('remote textures rejected',d=>d.scenes[0].elements[0].textureData='https://example.invalid/texture.jpg',/内嵌 PNG/);
bad('script protocol cannot pose as a texture',d=>d.scenes[0].elements[0].textureData='javascript:alert(1)',/内嵌 PNG/);
bad('invalid panel subdivision rejected',d=>d.scenes[0].elements[0].panelCount=10000,/分格数量/);
bad('false string cannot turn seat pads on',d=>d.scenes[0].extras[0].seatPad='false',/布尔值/);
test('subject and camera movement stay separate',()=>{const p={position:[50,50],headingDeg:180,motion:{path:[{at:0,position:[50,50],headingDeg:180},{at:1,position:[50,45],headingDeg:0}]}};const q=interpolateSubject(p,.5);assert.deepEqual(q.position,[50,47.5]);assert.equal(q.headingDeg,90);assert.equal(p.headingDeg,180);});
test('subject yaw crosses zero without a fake full orbit',()=>{const p={motion:{path:[{at:0,position:[50,50],headingDeg:359},{at:1,position:[50,50],headingDeg:1}]}};near(interpolateSubject(p,.5).headingDeg,360);});
test('subject motion clamps to shot range',()=>{const p={motion:{path:[{at:0,position:[50,50],headingDeg:180},{at:1,position:[50,40],headingDeg:90}]}};assert.deepEqual(interpolateSubject(p,-1).position,[50,50]);assert.deepEqual(interpolateSubject(p,2).position,[50,40]);});
bad('incomplete subject path cannot simulate measured motion',d=>{d.shots[0].subjects[0].motion={claim:{status:'proposal',confidence:'low',text:'测试方案',evidenceIds:[],alternatives:[]},path:[{at:.1,position:[50,50],headingDeg:180},{at:.9,position:[50,40],headingDeg:0}]};},/人物运动/);
bad('subject yaw must be numeric',d=>{d.shots[0].subjects[0].motion={claim:{status:'proposal',confidence:'low',text:'测试方案',evidenceIds:[],alternatives:[]},path:[{at:0,position:[50,50],headingDeg:'front'},{at:1,position:[50,40],headingDeg:0}]};},/人物轨迹/);
bad('unknown motion must not animate',d=>{d.shots[0].subjects[0].motion={claim:{status:'unknown',confidence:'unknown',text:'未知',evidenceIds:[],alternatives:[]},path:[{at:0,position:[50,50],headingDeg:180},{at:1,position:[50,40],headingDeg:0}]};},/未知人物运动/);
bad('invalid environment cannot silently select a model',d=>d.scenes[0].environment='production',/environment/);
bad('invalid marker position rejected',d=>d.scenes[0].orientationMarkers=[{label:'测试',position:[500,50]}],/方向标记/);
test('night setting and bob coat illustration remain valid',()=>{const d=structuredClone(scene);d.scenes[0].environment='night';d.shots[0].subjects[0].hairStyle='bob';d.shots[0].subjects[0].outfit='coat-boots';assert.equal(validateScene(shots,d).ok,true);});
bad('model estimate cannot masquerade as verified lens data',d=>{d.shots[0].lens.estimate={view_category:'normal',assumptions:[]};d.shots[0].lens.actual_capture_parameters={verified:true};},/不能标为真实参数已验证/);
test('model estimate keeps actual parameters explicitly unknown',()=>{const d=structuredClone(scene);d.shots[0].lens.estimate={view_category:'normal',assumptions:[]};d.shots[0].lens.actual_capture_parameters={verified:false};const r=validateScene(shots,d);assert.equal(r.ok,true);assert.ok(r.warnings.some(w=>w.includes('真实焦距')));});
test('detailed fixture stays valid with embedded local texture',()=>{const d=structuredClone(scene);d.scenes[0].elements[0].textureData='data:image/png;base64,iVBORw0KGgo=';assert.equal(validateScene(shots,d).ok,true);});
test('empty draft is explicit unconfirmed 3D scaffold',()=>{const d=initScene(shots);assert.equal(d.schemaVersion,2);assert.equal(d.scenes[0].volume.claim.status,'proposal');assert.ok(validateScene(shots,d).warnings.length>0);});
test('real solid count excludes flat zone',()=>{const r=geometrySummary({volume,elements:[{kind:'wall',height:30},{kind:'zone',height:.1}],extras:[{}]});assert.equal(r.solidElements,1);assert.equal(r.walls,1);assert.equal(r.backgroundPeople,1);});
test('render embeds runnable 3D bundle, data and no remote import',()=>{const html=renderReport(shots,scene,{baseDir:root});assert.match(html,/<div id="stage-3d"/);assert.ok(!/<svg id="map"/.test(html));assert.ok(!/<script[^>]+src=/.test(html));assert.match(html,/FilmScene3D/);assert.match(html,/WebGLRenderer/);});
test('annotation template-looking text remains data',()=>{const d=structuredClone(scene);d.shots[0].cameraNote.text='/*REPORT_3D*/ <!--REPORT_TITLE--> $&';const h=renderReport(shots,d,{baseDir:root});const raw=h.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(raw).scene.shots[0].cameraNote.text,d.shots[0].cameraNote.text);});
if(!process.exitCode)console.log(`✅ ${passed} 组三维几何与失败恢复检查通过（真实界面仍需单独验收）`);
