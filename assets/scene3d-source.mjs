import {installSceneEditing} from './scene-editor3d.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {worldPoint,boxWorld,horizontalToVerticalFov,interpolatePose,interpolateSubject,frustumCorners,geometrySummary} from './scene-math.mjs';
import {CAMERA_ANNOTATION,cameraAnnotationStyle} from './scene-style.mjs';
import ReportModel from './ui-state.cjs';

const COLORS={floor:0xcac3b4,wall:0xe7dacc,trim:0xb49764,carpet:0x864047,skin:0xd2b499,light:0xf0ca6e,person:0xeee9df,dark:0x28333b};
const asColor=(v,fallback)=>/^#[0-9a-f]{6}$/i.test(v||'')?new THREE.Color(v):new THREE.Color(fallback);
const V=p=>new THREE.Vector3(...p);
function disposeGroup(group){group.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material?.map?.dispose();});group.clear();}
function material(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.8,metalness:.02,...extra});}
function mesh(geometry,mat,parent,pos=[0,0,0],shadow=true){const o=new THREE.Mesh(geometry,mat);o.position.set(...pos);o.castShadow=shadow;o.receiveShadow=shadow;parent.add(o);return o;}
function box(parent,size,pos,color,extra){return mesh(new THREE.BoxGeometry(...size),material(color,extra),parent,pos);}
function sphere(parent,r,pos,color){return mesh(new THREE.SphereGeometry(r,12,8),material(color),parent,pos);}
function beam(parent,a,b,r,color){const A=V(a),B=V(b),delta=B.clone().sub(A);if(delta.length()<.001)return;const o=mesh(new THREE.CylinderGeometry(r,r,delta.length(),8),material(color),parent,A.clone().add(B).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return o;}
function line(parent,points,color,opacity=.8,dashed=false){const geo=new THREE.BufferGeometry().setFromPoints(points.map(V));const mat=dashed?new THREE.LineDashedMaterial({color,transparent:true,opacity,dashSize:1.2,gapSize:.6}):new THREE.LineBasicMaterial({color,transparent:true,opacity});const o=new THREE.Line(geo,mat);if(dashed)o.computeLineDistances();parent.add(o);return o;}
function makeLabel(name,color='#1c1c1e',options={}){
  const c=document.createElement('canvas');let ctx=c.getContext('2d');ctx.font='500 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  c.width=Math.min(760,Math.ceil(ctx.measureText(name).width)+36);c.height=44;ctx=c.getContext('2d');ctx.font='500 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.fillStyle=options.background||'rgba(245,245,247,.94)';ctx.beginPath();ctx.roundRect(1,2,c.width-2,39,19.5);ctx.fill();ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,c.width/2,22,c.width-16);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));sprite.userData.screenLabel={height:options.height||21,aspect:c.width/c.height};sprite.renderOrder=20;return sprite;
}
function mannequin(parent,config,volume,main=false){
  const p=worldPoint(config.position,config.elevation??0,volume);if(!p)return;
  const H=config.modelHeight??volume.humanHeight,s=H/8,g=new THREE.Group();g.position.set(...p);g.rotation.y=(config.headingDeg??0)*Math.PI/180;
  const cloth=asColor(config.color,main?COLORS.dark:COLORS.person),skin=asColor(config.skinColor,COLORS.skin),hair=asColor(config.hairColor,0x3f3730);
  const seated=config.pose==='seated',crossed=seated&&config.seatedStyle==='cross-legged',kneel=config.pose==='kneeling',prone=config.pose==='prone';
  const hip=crossed?1.05:seated?2.1:kneel?2.1:3.7;
  const styled=config.outfit==='coat-boots',body=mesh(new THREE.CylinderGeometry(.9,1.02,2.35,14),material(styled?asColor(config.topColor,0xe8e5dc):cloth),g,[0,hip+1.22,0]);body.scale.z=.65;
  sphere(g,.68,[0,hip+3.2,0],skin).scale.set(.95,1.08,.98);
  if(config.hairStyle!=='bald'){
    const cap=mesh(new THREE.SphereGeometry(.69,14,10,0,Math.PI*2,0,Math.PI*.53),material(hair),g,[0,hip+3.43,0]);cap.scale.z=.97;
    if(config.hairStyle==='long'||config.hairStyle==='bob')box(g,[1.15,config.hairStyle==='bob'?.95:1.3,.4],[0,hip+2.95,.52],hair);if(config.hairStyle==='bob')for(const side of [-1,1])box(g,[.26,.9,.65],[side*.59,hip+3.05,.14],hair);
  }
  box(g,[.42,.44,.4],[0,hip+2.57,0],skin);
  if(crossed){
    for(const side of [-1,1]){beam(g,[side*.48,hip,0],[side*1.67,.56,-.72],.4,cloth);beam(g,[side*1.67,.56,-.72],[-side*.63,.28,-1.46],.34,cloth);sphere(g,.32,[-side*.67,.25,-1.48],skin);}
  }else if(seated||kneel){
    for(const side of [-1,1]){beam(g,[side*.54,hip,0],[side*.7,hip-.5,-1.8],.36,cloth);beam(g,[side*.7,hip-.5,-1.8],[side*.9,.45,-2.3],.29,cloth);box(g,[.6,.4,1.1],[side*.9,.2,-2.5],cloth);}
  }else{
    for(const side of [-1,1]){beam(g,[side*.5,hip,0],[side*.55,styled?1.65:.5,0],.3,styled?skin:cloth);if(styled)beam(g,[side*.55,1.7,0],[side*.55,.4,0],.43,asColor(config.bootColor,0x2b2527));box(g,[.7,.45,1.35],[side*.55,.22,-.35],styled?asColor(config.bootColor,0x2b2527):cloth);}
  }
  if(styled){const trim=asColor(config.trimColor,0xa39379);box(g,[2.1,3.9,.35],[0,hip+.6,.58],cloth);for(const side of [-1,1]){box(g,[.68,4.0,.8],[side*.87,hip+.5,0],cloth);beam(g,[side*.75,hip+2.4,-.5],[side*.32,hip+.2,-.67],.24,trim);}box(g,[1.3,.7,.8],[0,hip-.3,0],asColor(config.bottomColor,0x40352e));const necklace=mesh(new THREE.TorusGeometry(.43,.045,6,18),material(0xb3a385,{metalness:.55}),g,[0,hip+2.4,-.42]);necklace.scale.y=.7;}
  const armBent=seated||config.gesture==='forward';
  for(const side of [-1,1]){
    const a=[side*1.0,hip+2.12,0],b=[side*1.35,hip+.9,armBent?-.65:0],end=config.gesture==='crossed'?[-side*.73,hip+1.0,-.9]:[side*.75,armBent?hip+.3:hip-.35,armBent?-1.05:-.1];
    beam(g,a,b,.27,cloth);beam(g,b,end,.235,cloth);sphere(g,.255,end,skin);
  }
  if(config.backpack){box(g,[1.6,2.25,.78],[0,hip+1.3,.76],0x8d8263);beam(g,[-.7,hip+2.4,-.43],[-.5,hip+.3,-.5],.12,0x9a9178);}
  if(prone){g.rotation.x=Math.PI*.5;g.position.y=(config.elevation??0)+.9*s;}
  g.scale.setScalar(s);g.userData.kind='person';g.userData.id=config.id;parent.add(g);return g;
}
// One instanced draw per mannequin part/style instead of thousands of per-person calls.
function crowd(parent,people,volume){
  const buckets=new Map();
  for(const p of people){if(!p.position)continue;const key=JSON.stringify([p.pose,p.seatedStyle,p.color,p.skinColor,p.hairColor,p.hairStyle]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}
  for(const group of buckets.values()){
    const tmp=new THREE.Group(),sample={...group[0],position:[50,50],headingDeg:0,elevation:0,modelHeight:8};
    mannequin(tmp,sample,{...volume,humanHeight:8},false);tmp.updateMatrixWorld(true);
    tmp.traverse(part=>{if(!part.isMesh)return;const instances=new THREE.InstancedMesh(part.geometry,part.material,group.length);instances.castShadow=true;instances.receiveShadow=true;instances.userData.kind='crowd-part';
      group.forEach((p,i)=>{const at=worldPoint(p.position,p.elevation??0,volume),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(p.headingDeg??0)*Math.PI/180),scale=(p.modelHeight??volume.humanHeight)/8,matrix=new THREE.Matrix4().compose(V(at),q,new THREE.Vector3(scale,scale,scale));matrix.multiply(part.matrixWorld);instances.setMatrixAt(i,matrix);});instances.instanceMatrix.needsUpdate=true;parent.add(instances);
    });
  }
  const withMats=people.filter(p=>p.seatPad&&p.position),withProps=people.filter(p=>p.offerings&&p.position);
  const build=(list,geometry,color,transform)=>{if(!list.length)return;const im=new THREE.InstancedMesh(geometry,material(color),list.length);im.receiveShadow=true;im.castShadow=true;list.forEach((p,i)=>{im.setMatrixAt(i,transform(p));});im.instanceMatrix.needsUpdate=true;parent.add(im);};
  build(withMats,new THREE.BoxGeometry(4.4,.12,4),0xc6ab67,p=>new THREE.Matrix4().compose(V(worldPoint(p.position,(p.elevation??0)+.08,volume)),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(p.headingDeg??0)*Math.PI/180),new THREE.Vector3(1,1,1)));
  const point=(p,dx,dz,dy)=>{const a=(p.headingDeg??0)*Math.PI/180,b=worldPoint(p.position,(p.elevation??0)+dy,volume);return [b[0]+dx*Math.cos(a)+dz*Math.sin(a),b[1],b[2]-dx*Math.sin(a)+dz*Math.cos(a)];};
  build(withProps,new THREE.CylinderGeometry(.55,.45,.23,14),0xbca363,p=>new THREE.Matrix4().makeTranslation(...point(p,.9,-2.15,.18)));
  build(withProps,new THREE.SphereGeometry(.3,10,8),0xc89045,p=>new THREE.Matrix4().makeTranslation(...point(p,.9,-2.15,.44)));
  build(withProps,new THREE.CylinderGeometry(.21,.18,.66,10),0xeee8da,p=>new THREE.Matrix4().makeTranslation(...point(p,-.8,-2.05,.4)));
}
function roomDetails(parent,scene,vol){
  if(scene.floorTiles){
    const points=[],spacing=scene.floorTiles;
    for(let x=-vol.width/2;x<=vol.width/2;x+=spacing)points.push(new THREE.Vector3(x,.015,-vol.depth/2),new THREE.Vector3(x,.015,vol.depth/2));
    for(let z=-vol.depth/2;z<=vol.depth/2;z+=spacing)points.push(new THREE.Vector3(-vol.width/2,.015,z),new THREE.Vector3(vol.width/2,.015,z));
    const geo=new THREE.BufferGeometry().setFromPoints(points);parent.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x777b80,transparent:true,opacity:.32})));
  }
  for(const a of scene.annexes||[]){
    if(a.side!=='entry')continue;
    const z=vol.depth/2+a.depth/2;box(parent,[a.width,1,a.depth],[0,-.65,z],0xa6a9ac);box(parent,[a.width,1,1],[0,-.1,z+a.depth/2],0xb0b3b5);
    for(const sign of [-1,1])box(parent,[.9,a.height,a.depth],[sign*a.width/2,a.height/2,z],0xa9a9ad);
    if(a.stairs){const step=a.depth*.52/6;for(let i=0;i<6;i++)box(parent,[a.width*.65,(i+1)*.65,step],[0,(i+1)*.325,z+a.depth/2-(i+.5)*step],0x70757a);}
  }
}
function wallDetail(parent,e,b,h){
  if(e.detail!=='panelled')return;
  const wide=b.width>b.depth,span=wide?b.width:b.depth,count=e.panelCount||Math.max(2,Math.floor(span/10));
  for(let i=0;i<count;i++){
    const t=-span/2+(i+.5)*span/count,offset=wide?[t,0,b.depth/2+.15]:[b.width/2+.15,0,t],panelW=span/count*.7;
    const g=new THREE.Group();g.position.set(...offset);if(!wide)g.rotation.y=Math.PI/2;
    box(g,[panelW,h*.48,.25],[0,h*.54,0],0xc9c0b5);
    for(const x of [-1,1])box(g,[.17,h*.48,.22],[x*panelW/2,h*.54,.24],0xded6c9);
    for(const y of [-1,1])box(g,[panelW,.18,.22],[0,h*.54+y*h*.24,.24],0xded6c9);
    parent.add(g);
  }
}

function outdoorElement(g,e,b,h,color){
  if(e.model==='tree'){
    beam(g,[0,0,0],[0,h*.67,0],.24,0x54483a);for(const sign of [-1,1])beam(g,[0,h*.42,0],[sign*b.width*.3,h*.72,0],.12,0x554c3d);
    for(const [x,y,z,s] of [[0,.75,0,1],[-.23,.62,.1,.76],[.22,.64,-.15,.82],[.04,.94,.03,.6]]){const c=mesh(new THREE.IcosahedronGeometry(b.width*.32*s,1),material(color),g,[x*b.width,y*h,z*b.depth]);c.scale.y=1.2;}return true;
  }
  if(e.model==='car'){
    box(g,[b.width,h*.4,b.depth],[0,h*.35,0],color,{roughness:.35});box(g,[b.width*.55,h*.44,b.depth*.85],[0,h*.65,0],color,{roughness:.35});
    box(g,[b.width*.36,h*.28,b.depth*.9],[0,h*.67,0],0x23333f,{roughness:.3});
    for(const x of [-1,1])for(const z of [-1,1]){const wheel=mesh(new THREE.CylinderGeometry(h*.24,h*.24,b.depth*.16,12),material(0x1d2229),g,[x*b.width*.32,h*.22,z*b.depth*.48]);wheel.rotation.x=Math.PI/2;}
    for(const z of [-1,1])box(g,[.12,.3,b.depth*.18],[b.width*.5,h*.43,z*b.depth*.3],0xe9e2c0,{emissive:0xa49356,emissiveIntensity:.6});return true;
  }
  if(e.model==='streetlight'){
    beam(g,[0,0,0],[0,h,0],.17,0x85898b);beam(g,[0,h,0],[b.width*.35,h,-b.depth*.3],.16,0x888d8e);
    box(g,[b.width*.65,.35,b.depth*.5],[b.width*.35,h-.2,-b.depth*.3],0xb0b2ae);box(g,[b.width*.6,.12,b.depth*.45],[b.width*.35,h-.43,-b.depth*.3],0xffe3a5,{emissive:0xffd180,emissiveIntensity:1});return true;
  }
  if(e.model==='building'){box(g,[b.width,h,b.depth],[0,h/2,0],color);for(let row=1;row<6;row++)for(let col=1;col<4;col++)if((row+col)%3!==0)box(g,[b.width*.08,h*.03,.12],[-b.width/2+col*b.width/4,row*h/6,b.depth/2+.07],0x998762,{emissive:0x8b7953,emissiveIntensity:.3});return true;}
  if(e.model==='bollard'){mesh(new THREE.CylinderGeometry(b.width*.34,b.width*.44,h,10),material(color),g,[0,h/2,0]);return true;}
  return false;
}

function addElement(parent,e,vol,cutWalls,onReady){
  const b=boxWorld(e.box,vol),y=e.elevation??0,h=e.height??(e.kind==='zone'?.12:1),color=asColor(e.color,e.kind==='stage'?COLORS.carpet:COLORS.wall);
  const g=new THREE.Group();g.position.set(b.center[0],y,b.center[2]);g.userData.kind=e.kind;g.userData.elementId=e.id;if(e.cutaway)g.visible=false;parent.add(g);
  if(e.kind==='furniture'&&outdoorElement(g,e,b,h,color))return g;
  if(e.kind==='zone'){const o=box(g,[b.width,.1,b.depth],[0,.02,0],color);o.receiveShadow=true;return g;}
  if(e.kind==='curtain'){
    const horizontal=b.width>=b.depth,length=horizontal?b.width:b.depth,count=Math.max(3,Math.ceil(length/1.5));
    for(let i=0;i<count;i++){const offset=-length/2+(i+.5)*length/count;mesh(new THREE.CylinderGeometry(.8,.8,h,9),material(color),g,horizontal?[offset,h/2,0]:[0,h/2,offset]);}
    box(g,horizontal?[b.width+1,.8,1.1]:[1.1,.8,b.depth+1],[0,h+.4,0],COLORS.trim);return g;
  }
  if(e.kind==='portrait'){
    const horizontal=b.width>=b.depth,wide=horizontal?b.width:b.depth;
    box(g,horizontal?[wide+.8,h+.8,1]:[1,h+.8,wide+.8],[0,h/2,0],COLORS.trim);
    box(g,horizontal?[wide,h,.22]:[.22,h,wide],[0,h/2,horizontal?.6:0],0xe0d2a9);
    // Symbolic figure, not a generated imitation of the portrait in the film.
    const relief=new THREE.Group();relief.position.set(horizontal?0:.7,h*.42,horizontal?.9:0);if(!horizontal)relief.rotation.y=Math.PI/2;
    mesh(new THREE.ConeGeometry(wide*.21,h*.62,16),material(0xb76852),relief,[0,0,0]);sphere(relief,wide*.1,[0,h*.36,0],0xcaa17a);g.add(relief);if(e.textureData){relief.visible=false;const texture=new THREE.TextureLoader().load(e.textureData,onReady);texture.colorSpace=THREE.SRGBColorSpace;const picture=mesh(new THREE.PlaneGeometry(wide,h),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}),g,horizontal?[0,h/2,.75]:[.75,h/2,0],false);if(!horizontal)picture.rotation.y=Math.PI/2;}return g;
  }
  if(e.kind==='window'){
    box(g,[b.width+.5,h+.5,b.depth+.5],[0,h/2,0],0x917e64);box(g,[b.width,h,b.depth],[0,h/2,0],0xe8dfc7,{emissive:0xe4d8ad,emissiveIntensity:.42});
    const wide=b.width>=b.depth, span=wide?b.width:b.depth;
    for(let i=0;i<4;i++)box(g,wide?[.25,h,.25]:[.25,h,.25],wide?[-span/2+i*span/3,h/2,b.depth/2+.12]:[b.width/2+.12,h/2,-span/2+i*span/3],COLORS.trim);
    return g;
  }
  if(e.kind==='door'){
    const wide=b.width>=b.depth,span=wide?b.width:b.depth;
    // Open doorway: jambs and lintel, not a solid rectangle blocking the actors.
    for(const sign of [-1,1])box(g,wide?[.8,h,b.depth]:[b.width,h,.8],wide?[sign*span/2,h/2,0]:[0,h/2,sign*span/2],COLORS.trim);
    box(g,[b.width+.8,1,b.depth+.8],[0,h,0],COLORS.trim);
    if(e.closed)box(g,[b.width*.92,h*.96,b.depth*.85],[0,h*.48,0],0x574f45);return g;
  }
  if(e.kind==='stairs'){
    const count=3;for(let i=0;i<count;i++)box(g,[b.width,h*(i+1)/count,b.depth/count],[0,h*(i+1)/(2*count),-b.depth/2+(i+.5)*b.depth/count],color);return g;
  }
  if(e.kind==='furniture'&&e.model==='light-frame'){for(const x of [-1,1])box(g,[.22,.22,b.depth],[x*b.width/2,0,0],0xf4f2e8);for(const z of [-1,1])box(g,[b.width,.22,.22],[0,0,z*b.depth/2],0xf4f2e8);return g;}
  if(e.kind==='furniture'&&e.model==='aircon'){box(g,[b.width,h,b.depth],[0,h/2,0],0xdfd9cd);for(let i=0;i<6;i++)box(g,[b.width*.85,.18,.12],[0,h*.48+i*h*.065,b.depth/2+.1],0x686b6c);return g;}
  if(e.kind==='furniture'&&e.model==='table'){
    box(g,[b.width,.65,b.depth],[0,h-.32,0],color);for(const x of [-1,1])for(const z of [-1,1])box(g,[.5,h-.5,.5],[x*b.width*.39,(h-.5)/2,z*b.depth*.35],color);return g;
  }
  if(e.kind==='furniture'&&e.model==='bench'){
    box(g,[b.width,.7,b.depth],[0,h*.47,0],color);box(g,[b.width,h*.55,.5],[0,h*.73,b.depth*.4],color);
    for(const x of [-1,1])box(g,[.55,h*.5,b.depth*.8],[x*b.width*.4,h*.25,0],color);return g;
  }
  const matExtra={};if(e.kind==='wall'&&e.cutaway)g.visible=false;
  box(g,[b.width,h,b.depth],[0,h/2,0],color,matExtra);
  if(e.kind==='wall'){box(g,[b.width,.6,b.depth+.15],[0,.5,0],COLORS.trim,matExtra);box(g,[b.width,.5,b.depth+.2],[0,h-.4,0],COLORS.trim,matExtra);wallDetail(g,e,b,h);cutWalls.push(g);}
  return g;
}
function makeRig(parent,cam,vol,color,opacity=1){
  if(!cam.position)return null;
  const height=cam.elevation??vol.humanHeight*.78,pos=worldPoint(cam.position,height,vol),target=worldPoint(cam.target,cam.targetElevation??vol.humanHeight*.66,vol);
  const g=new THREE.Group(),origin=V(pos),aim=V(target),base=worldPoint(cam.position,0,vol);
  const active=opacity===1,mark=material(color,{transparent:!active,opacity,depthWrite:active,toneMapped:false,emissive:color,emissiveIntensity:active?CAMERA_ANNOTATION.bodyEmissive:.08});
  // Actual 3D body and lens, supported by three separate tripod legs.
  const body=mesh(new THREE.BoxGeometry(2.2,1.45,2),mark,g,[0,0,0]);
  const lens=mesh(new THREE.CylinderGeometry(.7,.83,1.7,12),mark.clone(),g,[0,0,-1.7]);lens.rotation.x=Math.PI/2;
  mesh(new THREE.CylinderGeometry(.52,.52,.12,12),material(0x1c1c1e,{transparent:!active,opacity,depthWrite:active}),g,[0,0,-2.57]).rotation.x=Math.PI/2;
  g.position.copy(origin);g.lookAt(aim);g.rotateY(Math.PI);parent.add(g);
  if(opacity>.15){const stand=new THREE.Group();for(let i=0;i<3;i++){const a=i*Math.PI*2/3,leg=beam(stand,[base[0],Math.max(.3,height-.9),base[2]],[base[0]+Math.cos(a)*2,0,base[2]+Math.sin(a)*2],active?.14:.09,color);if(leg){Object.assign(leg.material,{transparent:!active,opacity,depthWrite:active,toneMapped:false});leg.material.emissive.copy(color);leg.material.emissiveIntensity=active?CAMERA_ANNOTATION.tripodEmissive:.08;}}parent.add(stand);}
  return {group:g,pos,target};
}
function drawFrustum(parent,cam,vol,aspect,color){
  const angle=cam.viewAngleDeg??cam.previewAngleDeg;if(!angle||!cam.position)return;
  const pos=worldPoint(cam.position,cam.elevation??vol.humanHeight*.78,vol),target=worldPoint(cam.target,cam.targetElevation??vol.humanHeight*.66,vol);
  const dist=V(pos).distanceTo(V(target)),far=Math.max(5,Math.min(dist*.96,vol.depth*.88)),corners=frustumCorners(pos,target,angle,aspect,1.8,far);
  const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0];
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>corners[i]),3));geo.computeVertexNormals();const solid=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:CAMERA_ANNOTATION.fillOpacity,depthWrite:false,toneMapped:false}));solid.renderOrder=2;parent.add(solid);
  const edge=(points,dashed=false)=>{const o=line(parent,points,color,CAMERA_ANNOTATION.edgeOpacity,dashed);o.material.toneMapped=false;return o;};
  for(const a of [0,4])edge([corners[a],corners[a+1],corners[a+2],corners[a+3],corners[a]]);
  for(let i=0;i<4;i++)edge([corners[i],corners[i+4]]);
  edge([pos,target],true);
  const planes=[new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Plane(new THREE.Vector3(0,-1,0),vol.height),new THREE.Plane(new THREE.Vector3(1,0,0),vol.width/2),new THREE.Plane(new THREE.Vector3(-1,0,0),vol.width/2),new THREE.Plane(new THREE.Vector3(0,0,1),vol.depth/2),new THREE.Plane(new THREE.Vector3(0,0,-1),vol.depth/2)];parent.traverse(o=>{if(o.material&&!o.isSprite)o.material.clippingPlanes=planes;});
}
function lightRig(parent,config,vol){
  if(!config.position)return;
  const p=worldPoint(config.position,config.elevation??vol.humanHeight*1.45,vol),ground=worldPoint(config.position,0,vol),target=worldPoint(config.target??config.position,config.targetElevation??vol.humanHeight*.6,vol);if(config.offset)for(let k=0;k<3;k++){p[k]+=config.offset[k];ground[k]+=config.offset[k];}
  const shape=config.shape||'softbox',head=new THREE.Group(),size=config.size||[5,3];head.position.set(...p);head.lookAt(V(target));
  if(shape==='ceiling-panel'){
    head.rotation.set(Math.PI/2,0,0);box(head,[size[0],size[1],.4],[0,0,0],0x666b70);box(head,[size[0]-.4,size[1]-.4,.12],[0,0,.3],0xfff5d9,{emissive:0xffefb1,emissiveIntensity:.65});
    const frame=new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0]+.3,size[1]+.3,.45));head.add(new THREE.LineSegments(frame,new THREE.LineBasicMaterial({color:0xe6e6da,transparent:true,opacity:.7})));
  }else if(shape==='bulb')sphere(head,.65,[0,0,0],0xfff6d5).material.emissive.set(0xd6bd81);
  else if(shape==='strip'||shape==='window'){
    box(head,[size[0],size[1],.35],[0,0,0],0xfff6d5,{emissive:0xffedb5,emissiveIntensity:.65});
  }else{
    beam(parent,ground,p,.14,0x3e444b);for(let i=0;i<3;i++){const a=i*2*Math.PI/3;beam(parent,[ground[0],.8,ground[2]],[ground[0]+Math.cos(a)*2,0,ground[2]+Math.sin(a)*2],.11,0x3e444b);}
    const negative=config.role==='negative-fill'||shape==='flag';box(head,[size[0],size[1],.55],[0,0,0],negative?0x22242a:0x4d5155);
    if(!negative)box(head,[size[0]-.3,size[1]-.3,.15],[0,0,.36],0xfff5cf,{emissive:0xffe2a2,emissiveIntensity:.4});
  }
  parent.add(head);
  if(config.showBeam&&config.target&&shape!=='flag'){
    const direction=V(target).sub(V(p)),length=Math.min(direction.length(),vol.depth*.28),cone=new THREE.Mesh(new THREE.ConeGeometry(length*.22,length,12,1,true),new THREE.MeshBasicMaterial({color:0xe8ce84,transparent:true,opacity:.075,side:THREE.DoubleSide,depthWrite:false}));
    cone.position.copy(V(p).add(direction.clone().normalize().multiplyScalar(length*.5)));cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),direction.normalize());parent.add(cone);
  }
  const label=makeLabel(config.id,'#3a2a08',{background:'rgba(240,226,190,.95)',height:19});label.position.set(p[0],p[1]+2.5,p[2]);label.userData.longLabel=config.label;parent.add(label);
}

export class SceneViewer3D{
 constructor(container,{onError,onSelectSetup}={}){
  this.container=container;this.mode='overview';this.onSelectSetup=onSelectSetup;this.aspect=2.38;this.showLights=true;this.showOthers=false;this.theme='dark';
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x0a0a0a);
  try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});}catch(e){onError?.(e);throw e;}
  this.renderer.localClippingEnabled=true;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.98;
  this.renderer.domElement.setAttribute('aria-label','真实三维片场，可拖动旋转、滚轮缩放、方向键旋转');this.renderer.domElement.tabIndex=0;container.append(this.renderer.domElement);
  this.orbitCamera=new THREE.OrthographicCamera(-100,100,70,-70,.2,2000);this.shotCamera=new THREE.PerspectiveCamera(39,1,.2,2000);this.camera=this.orbitCamera;this.controls=new OrbitControls(this.orbitCamera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.maxPolarAngle=Math.PI*.485;this.controls.minDistance=15;this.controls.maxDistance=500;this.controls.minZoom=.55;this.controls.maxZoom=4;this.controls.addEventListener('change',()=>this.render());
  this.hemi=new THREE.HemisphereLight(0xfff5df,0x7a8998,1.1);this.scene.add(this.hemi);const sun=new THREE.DirectionalLight(0xffedd0,2.0);sun.position.set(-60,110,60);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-110,right:110,top:120,bottom:-120,near:1,far:350});sun.shadow.bias=-.00035;sun.shadow.normalBias=.15;this.scene.add(sun);this.sun=sun;
  const fill=new THREE.DirectionalLight(0xc4d9ff,.45);fill.position.set(90,45,-80);this.scene.add(fill);this.fill=fill;
  this.staticGroup=new THREE.Group();this.dynamicGroup=new THREE.Group();this.scene.add(this.staticGroup,this.dynamicGroup);this.cutWalls=[];
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
  this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();container.dataset.renderState='lost';onError?.(new Error('三维显卡上下文丢失，请重新加载报告。'));});
  this.renderer.domElement.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const offset=this.camera.position.clone().sub(this.controls.target);if(e.key==='ArrowLeft'||e.key==='ArrowRight')offset.applyAxisAngle(new THREE.Vector3(0,1,0),e.key==='ArrowLeft'?.12:-.12);else offset.y=Math.max(10,offset.y+(e.key==='ArrowUp'?8:-8));this.camera.position.copy(this.controls.target).add(offset);this.camera.lookAt(this.controls.target);this.controls.update();this.render();});
  this.resize();container.dataset.renderState='ready';container.dataset.renderer='WebGL2';
 }
 setScene(scene){
  if(this.sceneId===scene.id&&this.sceneData===scene)return;
  this.sceneId=scene.id;this.sceneData=scene;this.vol=scene.volume;const night=scene.environment==='night';this.hemi.intensity=night?.7:1.1;this.sun.intensity=night?.8:2.0;this.fill.intensity=night?.6:.45;disposeGroup(this.staticGroup);this.cutWalls=[];
  const v=this.vol;box(this.staticGroup,[v.width+2,1.1,v.depth+2],[0,-.6,0],asColor(scene.floorColor,0x96999d));box(this.staticGroup,[v.width+3,.7,v.depth+3],[0,-1.45,0],0x444b4c);
  roomDetails(this.staticGroup,scene,v);for(const el of scene.elements)addElement(this.staticGroup,el,v,this.cutWalls,()=>this.render());
  crowd(this.staticGroup,scene.extras||[],v);
  for(const marker of scene.orientationMarkers||[]){const badge=makeLabel(marker.label,'#f5f5f7',{background:'rgba(28,28,30,.86)',height:19});badge.position.set(...worldPoint(marker.position,marker.elevation??v.height+3,v));this.staticGroup.add(badge);}this.container.dataset.geometry=JSON.stringify(geometrySummary(scene));this.reset();
 }
 setShot(note,setup,allSetups,aspect,progress=0){
  const prevShot=this.note?.shotId,snap=this.camSnap();this.note=note;this.setup=setup;this.allSetups=allSetups;this.aspect=aspect||this.aspect;this.progress=progress;
  this.drawDynamic();if(this.mode==='shot')this.applyShotView();this.render();
  if(prevShot&&prevShot!==note?.shotId){this.fadeLabels();if(this.mode==='shot')this.tweenFrom(snap);}
 }
 drawDynamic(){
  disposeGroup(this.dynamicGroup);this.activeRig=null;if(!this.note||!this.vol)return;
  // Setup identity, not the current selection or theme, owns annotation color.
  const v=this.vol,style=cameraAnnotationStyle(ReportModel.setupColor(this.setup,this.allSetups)),color=new THREE.Color(style.color);
  for(const rawWho of this.note.subjects||[]){const who=interpolateSubject(rawWho,this.progress);mannequin(this.dynamicGroup,who,v,true);if(who.marker&&who.position){const at=worldPoint(who.position,(who.elevation??0)+.14,v);mesh(new THREE.CylinderGeometry(2.1,2.1,.13,28),new THREE.MeshBasicMaterial({color:asColor(who.marker,0xe46f58),transparent:true,opacity:.75}),this.dynamicGroup,at,false);}if(who.position){const at=worldPoint(who.position,(who.elevation??0)+(who.modelHeight??v.humanHeight)+(who.pose==='seated'?-2:0)+2,v),label=makeLabel(who.label);label.userData.editorActorId=who.id;label.position.set(...at);this.dynamicGroup.add(label);}}
  if(this.showLights)for(const l of [...(this.sceneData.fixtures||[]),...(this.note.lighting||[])])lightRig(this.dynamicGroup,l,v);
  // A setup is a cross-shot hypothesis, not another camera simultaneously on set.
  // Comparison is opt-in and uses position markers only, never extra rigs or view cones.
  this.otherRigs=new THREE.Group();this.dynamicGroup.add(this.otherRigs);const comparisonIds=[];if(this.showOthers)for(const s of this.allSetups||[])if(s.sceneId===this.note.sceneId&&s.id!==this.note.setupId&&s.camera.position){
   const group=new THREE.Group(),otherStyle=cameraAnnotationStyle(ReportModel.setupColor(s,this.allSetups)),otherColor=new THREE.Color(otherStyle.color),pos=worldPoint(s.camera.position,s.camera.elevation??v.humanHeight*.78,v);this.otherRigs.add(group);comparisonIds.push(s.id);
   mesh(new THREE.SphereGeometry(.6,10,8),material(otherColor,{transparent:true,opacity:.55,depthWrite:false,toneMapped:false}),group,pos,false);
   const label=makeLabel(s.id,ReportModel.colorText(otherStyle.color),{background:otherStyle.color,height:17});label.material.toneMapped=false;label.position.set(pos[0],pos[1]+3,pos[2]);group.add(label);
  }
  this.pose=this.setup?interpolatePose(this.setup.camera,this.note.cameraMotion?.path,this.progress):null;
  if(this.pose?.position){this.activeRig=new THREE.Group();this.dynamicGroup.add(this.activeRig);const rig=makeRig(this.activeRig,this.pose,v,color);drawFrustum(this.activeRig,this.pose,v,this.aspect,color);const name=this.setup.label.startsWith(this.setup.id+' · ')?this.setup.label:this.setup.id+' · '+this.setup.label;const label=makeLabel(name,ReportModel.colorText(style.color),{background:style.color,height:26});label.material.toneMapped=false;label.position.set(rig.pos[0],rig.pos[1]+5,rig.pos[2]);this.activeRig.add(label);this.activeRig.visible=this.mode!=='shot';}
  this.container.dataset.cameraDisplay=this.showOthers?'comparison':'current-only';this.container.dataset.comparisonSetups=JSON.stringify(comparisonIds);
  const main=this.note.subjects?.[0];if(main){const sample=interpolateSubject(main,this.progress);this.container.dataset.subjectHeading=String(sample.headingDeg??0);this.container.dataset.subjectPosition=JSON.stringify(sample.position);}this.container.dataset.setup=this.note.setupId??'unknown';this.container.dataset.shot=this.note.shotId;this.container.dataset.frustum=this.pose?.viewAngleDeg!=null?'estimated':this.pose?.previewAngleDeg!=null?'schematic':'none';
 }
 setOptions({lights,others}){this.showLights=lights;this.showOthers=others;this.drawDynamic();this.render();}
 setTheme(theme){this.theme=theme;this.scene.background.set(theme==='light'?0xececee:0x0a0a0a);this.drawDynamic();this.render();}
 setMode(mode){
  if(mode==='shot'&&!this.pose?.position)return false;const snap=this.camSnap(),prevMode=this.mode;this.mode=mode;if(this.activeRig)this.activeRig.visible=mode!=='shot';
  if(mode==='shot'){this.camera=this.shotCamera;this.controls.enabled=false;this.applyShotView();}
  else{this.camera=this.orbitCamera;this.controls.enabled=true;if(mode==='top'){this.camera.up.set(0,0,-1);this.camera.position.set(0,this.vol.depth*1.5,.01);this.controls.target.set(0,0,0);this.camera.lookAt(0,0,0);this.controls.update();this.captureFrameBounds();}else this.reset();}
  this.container.dataset.view=mode;this.resize();if(prevMode!==mode)this.tweenFrom(snap);return true;
 }
 // 动效：镜头/视角切换时相机阻尼过渡（约 450ms，easeOutCubic），不改变终点数据；减少动态效果时即时完成。
 motionOK(){try{return typeof requestAnimationFrame==='function'&&typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: no-preference)').matches;}catch{return false;}}
 camSnap(){const c=this.camera;if(!c)return null;return{cam:c,pos:c.position.clone(),quat:c.quaternion.clone(),target:this.controls?.target?.clone(),zoom:c.zoom};}
 tweenFrom(snap){if(!snap||!this.motionOK())return;const c=this.camera;if(snap.cam!==c){this.container.dataset.swap=String(Date.now());return;}
  const to={pos:c.position.clone(),quat:c.quaternion.clone(),target:this.controls?.target?.clone(),zoom:c.zoom};if(to.pos.distanceTo(snap.pos)<1e-4&&to.quat.angleTo(snap.quat)<1e-4)return;
  const orbit=c===this.orbitCamera,start=performance.now(),D=450,id=(this.tweenId=(this.tweenId||0)+1),P=new THREE.Vector3(),T=new THREE.Vector3(),Q=new THREE.Quaternion();
  const step=now=>{if(id!==this.tweenId||this.camera!==c)return;const k=Math.min(1,(now-start)/D),e=1-Math.pow(1-k,3);P.lerpVectors(snap.pos,to.pos,e);c.position.copy(P);c.zoom=snap.zoom+(to.zoom-snap.zoom)*e;
   if(orbit&&to.target&&snap.target){T.lerpVectors(snap.target,to.target,e);this.controls.target.copy(T);c.lookAt(T);}else{Q.slerpQuaternions(snap.quat,to.quat,e);c.quaternion.copy(Q);}
   c.updateProjectionMatrix();this.render();if(k<1)requestAnimationFrame(step);else{c.position.copy(to.pos);c.quaternion.copy(to.quat);c.zoom=to.zoom;if(orbit&&to.target){this.controls.target.copy(to.target);this.controls.update();}c.updateProjectionMatrix();this.render();}};
  c.position.copy(snap.pos);c.quaternion.copy(snap.quat);requestAnimationFrame(step);}
 fadeLabels(){if(!this.motionOK())return;const mats=[];this.dynamicGroup.traverse(o=>{if(o.isSprite&&o.material){o.material.opacity=0;mats.push(o.material);}});if(!mats.length)return;const start=performance.now(),id=(this.fadeId=(this.fadeId||0)+1);
  const step=now=>{if(id!==this.fadeId)return;const k=Math.min(1,(now-start)/220);for(const m of mats)m.opacity=1-Math.pow(1-k,2);this.render();if(k<1)requestAnimationFrame(step);};requestAnimationFrame(step);}
 applyShotView(){if(!this.pose?.position)return;const v=this.vol,pos=worldPoint(this.pose.position,this.pose.elevation??v.humanHeight*.78,v),target=worldPoint(this.pose.target,this.pose.targetElevation??v.humanHeight*.66,v);this.camera.up.set(0,1,0);this.camera.position.set(...pos);this.camera.lookAt(...target);const a=this.pose.viewAngleDeg??this.pose.previewAngleDeg;if(a)this.camera.fov=horizontalToVerticalFov(a,this.aspect);this.camera.updateProjectionMatrix();}
 reset(){
  if(!this.vol)return;this.mode='overview';this.camera=this.orbitCamera;if(this.activeRig)this.activeRig.visible=true;this.controls.enabled=true;this.camera.up.set(0,1,0);
  const v=this.vol,o=this.sceneData.overview||{},pos=o.position||[v.width*1.35,v.depth*1.3,v.depth*.06];this.camera.position.set(...pos);this.controls.target.set(...(o.target||[0,v.height*.15,0]));this.camera.zoom=o.zoom||1;this.camera.lookAt(this.controls.target);this.controls.update();this.captureFrameBounds();this.container.dataset.view='overview';this.resize();
 }
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.fitProjection(w,h);this.render();}
 captureFrameBounds(){
  this.camera.updateMatrixWorld(true);const v=this.vol,points=[];
  const bound=(min,max)=>{for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])points.push(new THREE.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse));};
  bound([-v.width/2,-2,-v.depth/2],[v.width/2,0,v.depth/2]);
  for(const e of this.sceneData.elements){if(e.cutaway||e.kind==='zone')continue;const b=boxWorld(e.box,v),h=e.height||.1,y=e.elevation||0;bound([b.center[0]-b.width/2,y,b.center[2]-b.depth/2],[b.center[0]+b.width/2,y+h,b.center[2]+b.depth/2]);}
  for(const a of this.sceneData.annexes||[])bound([-a.width/2,-2,v.depth/2],[a.width/2,a.height,v.depth/2+a.depth]);
  const bounds=new THREE.Box3().setFromPoints(points),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());this.frameBounds={width:size.x,height:size.y,cx:center.x,cy:center.y};
 }
 fitProjection(w,h){
  if(this.camera.isOrthographicCamera){const b=this.frameBounds||{width:140,height:110,cx:0,cy:0},aspect=w/h,pad=this.sceneData?.overview?.padding||1.09,span=Math.max(b.height,b.width/aspect)*pad;this.camera.left=b.cx-span*aspect/2;this.camera.right=b.cx+span*aspect/2;this.camera.top=b.cy+span/2;this.camera.bottom=b.cy-span/2;}
  else this.camera.aspect=this.mode==='shot'?this.aspect:w/h;
  this.camera.updateProjectionMatrix();
 }
 layoutLabels(w,h){
  const labels=[];this.scene.traverse(o=>{if(o.isSprite&&o.userData.screenLabel)labels.push(o);});
  const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1),used=[];
  if(this.mode!=='shot')this.dynamicGroup.traverse(g=>{if(g.userData.kind!=='person')return;g.updateWorldMatrix(true,true);const bound=new THREE.Box3().setFromObject(g,true),pts=[];for(const x of [bound.min.x,bound.max.x])for(const y of [bound.min.y,bound.max.y])for(const z of [bound.min.z,bound.max.z])pts.push(new THREE.Vector3(x,y,z).project(this.camera));const minX=Math.min(...pts.map(p=>(p.x+1)*w/2)),maxX=Math.max(...pts.map(p=>(p.x+1)*w/2)),minY=Math.min(...pts.map(p=>(1-p.y)*h/2)),maxY=Math.max(...pts.map(p=>(1-p.y)*h/2));used.push({x:minX-3,y:minY-3,w:maxX-minX+6,h:maxY-minY+6});});
  labels.sort((a,b)=>(b.userData.screenLabel.height||0)-(a.userData.screenLabel.height||0));
  for(const o of labels){o.visible=this.mode!=='shot';if(!o.visible)continue;const info=o.userData.screenLabel;if(!o.userData.labelAnchor)o.userData.labelAnchor=o.position.clone();o.position.copy(o.userData.labelAnchor);const anchor=o.getWorldPosition(new THREE.Vector3()),depth=Math.abs(anchor.clone().applyMatrix4(this.camera.matrixWorldInverse).z),unit=this.camera.isOrthographicCamera?(this.camera.top-this.camera.bottom)/this.camera.zoom/h:2*depth*Math.tan(this.camera.fov*Math.PI/360)/h;o.scale.set(unit*info.height*info.aspect,unit*info.height,1);
    const screen=anchor.clone().project(this.camera),x=(screen.x+1)*w/2,y=(1-screen.y)*h/2,bw=info.height*info.aspect,bh=info.height;
    if(Math.abs(screen.x)>1.1||Math.abs(screen.y)>1.1){o.visible=false;continue;}
    const candidates=[[0,0],[0,-26],[0,26],[0,-50],[0,50],[40,-26],[-40,26],[60,0],[-60,0]];let selected=null;
    for(const [dx,dy] of candidates){const cx=Math.max(bw/2+4,Math.min(w-bw/2-4,x+dx)),cy=Math.max(bh/2+4,Math.min(h-bh/2-4,y+dy)),r={x:cx-bw/2,y:cy-bh/2,w:bw,h:bh};if(!used.some(q=>r.x<q.x+q.w+3&&r.x+r.w+3>q.x&&r.y<q.y+q.h+3&&r.y+r.h+3>q.y)){selected={cx,cy,r};break;}}
    if(!selected)selected={cx:x,cy:y,r:{x:x-bw/2,y:y-bh/2,w:bw,h:bh}};used.push(selected.r);o.position.addScaledVector(right,(selected.cx-x)*unit).addScaledVector(up,-(selected.cy-y)*unit);
  }
 }
 render(){
  if(!this.renderer||!this.camera)return;
  const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;
  this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,w,h);
  if(this.mode==='shot'){
    this.renderer.setClearColor(this.theme==='light'?0xe4e4e6:0x050505);this.renderer.clear();
    const cw=Math.min(w,h*this.aspect),ch=cw/this.aspect,x=(w-cw)/2,y=(h-ch)/2;
    this.renderer.setViewport(x,y,cw,ch);this.renderer.setScissor(x,y,cw,ch);this.renderer.setScissorTest(true);this.camera.aspect=this.aspect;
  }else this.fitProjection(w,h);
  if(this.otherRigs)this.otherRigs.visible=this.mode!=='shot';this.camera.updateMatrixWorld(true);
  this.layoutLabels(w,h);this.camera.updateProjectionMatrix();this.renderer.render(this.scene,this.camera);this.renderer.setScissorTest(false);this.container.dataset.meshCount=String(this.renderer.info.render.calls);this.container.dataset.projection=this.camera.type;
 }
 dispose(){this.resizeObserver.disconnect();this.controls.dispose();disposeGroup(this.staticGroup);disposeGroup(this.dynamicGroup);this.renderer.dispose();this.renderer.domElement.remove();}
}
installSceneEditing(SceneViewer3D,THREE);
window.FilmScene3D={SceneViewer3D,revision:THREE.REVISION};
