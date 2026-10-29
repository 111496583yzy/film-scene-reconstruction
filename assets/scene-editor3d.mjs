// Optional editing adapter. Read-only report instances never enable these hooks.
import {worldPoint} from './scene-math.mjs';
export function installSceneEditing(Viewer,THREE){
 const V=p=>new THREE.Vector3(...p),clamp=n=>Math.max(0,Math.min(100,n));
 const clean=g=>{g.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});g.clear();};
 Viewer.prototype.enableEditing=function(callbacks={}){
  if(this.editing){this.editing.callbacks=callbacks;return;}
  const canvas=this.renderer.domElement,editing={callbacks,drag:null,listeners:[],originalMotion:this.motionOK,originalRender:this.render};this.editing=editing;
  this.motionOK=()=>false;
  this.editorOverlay=new THREE.Group();this.scene.add(this.editorOverlay);
  this.render=function(){if(this.editorOverlay)this.editorOverlay.visible=this.mode!=='shot';return editing.originalRender.call(this);};
  const on=(name,fn)=>{canvas.addEventListener(name,fn,true);editing.listeners.push([name,fn]);};
  const ndc=e=>new THREE.Vector2((e.clientX-canvas.getBoundingClientRect().left)/canvas.clientWidth*2-1,-(e.clientY-canvas.getBoundingClientRect().top)/canvas.clientHeight*2+1);
  const ray=e=>{const r=new THREE.Raycaster();r.setFromCamera(ndc(e),this.camera);return r;};
  const intersect=(e,height)=>ray(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),new THREE.Vector3());
  const relative=p=>[(p.x/this.vol.width+.5)*100,(p.z/this.vol.depth+.5)*100];
  const candidates=()=>{
   const list=[];
   for(const g of this.dynamicGroup.children){if(g.userData.kind==='person')list.push({root:g,kind:'actor',id:g.userData.id});else if(g.userData.editorActorId)list.push({root:g,kind:'actor',id:g.userData.editorActorId});}
   for(const g of this.staticGroup.children)if(g.userData.elementId&&g.visible)list.push({root:g,kind:'element',id:g.userData.elementId});
   if(this.activeRig?.visible)for(const g of this.activeRig.children)if(g.isGroup||g.isSprite)list.push({root:g,kind:'camera',id:'camera'});
   return list;
  };
  const pick=e=>{let best=null;for(const item of candidates()){const hit=ray(e).intersectObject(item.root,true).find(h=>h.object.isMesh||h.object.isSprite);if(hit&&(!best||hit.distance<best.distance))best={...item,distance:hit.distance};}return best;};
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  const finish=(e,cancel)=>{const d=editing.drag;if(!d)return;stop(e);editing.drag=null;if(canvas.dataset)delete canvas.dataset.dragging;if(editing.drop){editing.drop.visible=false;this.render();}this.controls.enabled=this.mode!=='shot';try{canvas.releasePointerCapture(d.pointerId);}catch{}if(cancel)editing.callbacks.onCancel?.();else editing.callbacks.onCommit?.();};
  on('pointerdown',e=>{
   if(callbacks.interactive===false||e.button!==0||this.mode==='shot'||editing.callbacks.enabled?.()===false)return;
   if(editing.callbacks.placing?.()){
    const at=intersect(e,0);if(at){stop(e);editing.callbacks.onPlace?.(relative(at).map(clamp));}return;
   }
   const hit=pick(e);if(!hit)return;
   let position,height=0;
   if(hit.kind==='actor'){const a=this.note.subjects.find(a=>a.id===hit.id);position=a?.position;height=a?.elevation||0;}
   else if(hit.kind==='camera'){position=this.pose?.position;height=this.pose?.elevation??this.vol.humanHeight*.78;}
   else{const el=this.sceneData.elements.find(x=>x.id===hit.id);position=el?[el.box[0]+el.box[2]/2,el.box[1]+el.box[3]/2]:null;height=el?.elevation||0;}
   const at=intersect(e,height);if(!position||!at)return;
   stop(e);if(canvas.dataset)canvas.dataset.dragging='true';editing.drag={kind:hit.kind,id:hit.id,position:[...position],height,at:relative(at),pointerId:e.pointerId};this.controls.enabled=false;try{canvas.setPointerCapture(e.pointerId);}catch{}
   editing.callbacks.onStart?.({kind:hit.kind,id:hit.id});
  });
  // 拖拽反馈：默认吸附到 1 格相对网格（按住 Alt 自由移动），地面显示落点环；悬停可拖对象时显示抓手光标。
  const drop=new THREE.Group();drop.visible=false;drop.renderOrder=13;this.scene.add(drop);editing.drop=drop;
  const showDrop=(pos,height)=>{if(!drop.children.length){const r=Math.max(.6,(this.vol.humanHeight||8)*.09);const ring=new THREE.Mesh(new THREE.RingGeometry(r*.78,r,40),new THREE.MeshBasicMaterial({color:0x4c8dff,transparent:true,opacity:.95,depthTest:false,toneMapped:false,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;const dot=new THREE.Mesh(new THREE.CircleGeometry(r*.2,20),ring.material.clone());dot.rotation.x=-Math.PI/2;drop.add(ring,dot);}const w=worldPoint(pos,height+.04,this.vol);drop.position.set(...w);drop.visible=true;};
  let hoverRaf=0,lastHover=null;
  on('pointermove',e=>{const d=editing.drag;if(!d){if(callbacks.interactive===false||this.mode==='shot'||editing.callbacks.enabled?.()===false||editing.callbacks.placing?.()){if(canvas.dataset.hover)delete canvas.dataset.hover;return;}lastHover=e;if(!hoverRaf)hoverRaf=requestAnimationFrame(()=>{hoverRaf=0;const h=lastHover&&pick(lastHover);if(h)canvas.dataset.hover=h.kind;else delete canvas.dataset.hover;});return;}
   const at=intersect(e,d.height);if(!at)return;stop(e);const p=relative(at),snap=!e.altKey,pos=d.position.map((n,i)=>{const v=clamp(n+p[i]-d.at[i]);return snap?clamp(Math.round(v)):v;});showDrop(pos,d.height);this.render();editing.callbacks.onDrag?.({kind:d.kind,id:d.id,position:pos,snapped:snap});});
  on('pointerup',e=>finish(e,false));on('pointercancel',e=>finish(e,true));on('lostpointercapture',e=>{if(editing.drag)finish(e,true);});
  on('keydown',e=>{if(editing.callbacks.interactive===false&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){stop(e);return;}if(e.key==='Escape'&&editing.drag)finish(e,true);});
 };
 Viewer.prototype.cancelEditingDrag=function(){const ed=this.editing;if(!ed?.drag)return;const d=ed.drag;ed.drag=null;this.controls.enabled=this.mode!=='shot';try{this.renderer.domElement.releasePointerCapture(d.pointerId);}catch{}ed.callbacks.onCancel?.();};
 Viewer.prototype.disableEditing=function(){if(!this.editing)return;this.cancelEditingDrag();const e=this.editing;for(const [name,fn]of e.listeners)this.renderer.domElement.removeEventListener(name,fn,true);if(this.editorOverlay){clean(this.editorOverlay);this.scene.remove(this.editorOverlay);this.editorOverlay=null;}this.motionOK=e.originalMotion;this.render=e.originalRender;this.editing=null;};
 Viewer.prototype.setEditorOverlay=function({selection=null,paths=[],orientations=false}={}){
  if(!this.editorOverlay||!this.vol)return;clean(this.editorOverlay);
  let selected;
  if(selection?.kind==='actor')selected=this.dynamicGroup.children.find(g=>g.userData.kind==='person'&&g.userData.id===selection.id);
  if(selection?.kind==='element')selected=this.staticGroup.children.find(g=>g.userData.elementId===selection.id);
  if(selection?.kind==='camera')selected=this.activeRig?.children.find(g=>g.isGroup);
  if(selected){selected.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(selected);if(!box.isEmpty()){const helper=new THREE.Box3Helper(box,0x4c8dff);helper.material.depthTest=false;helper.renderOrder=12;this.editorOverlay.add(helper);}}
  for(const who of this.note?.subjects||[]){if(!orientations&&!(selection?.kind==='actor'&&selection.id===who.id))continue;const angle=(who.headingDeg||0)*Math.PI/180,direction=new THREE.Vector3(-Math.sin(angle),0,-Math.cos(angle)),at=V(worldPoint(who.position,(who.elevation||0)+.24,this.vol)),length=(who.modelHeight||this.vol.humanHeight)*.46,arrow=new THREE.ArrowHelper(direction,at,length,0x8b6b35,Math.min(1.2,length*.35),Math.min(.65,length*.2));arrow.traverse(o=>{if(o.material){o.material.depthTest=false;o.material.toneMapped=false;}o.renderOrder=9;});this.editorOverlay.add(arrow);}
  for(const path of paths){
   if(!path.start||!path.end)continue;const nodes=path.points?.length?path.points:[path.start,path.end],points=nodes.map(n=>worldPoint(n.position,(n.elevation??path.start.elevation??0)+.3,this.vol)),a=points[0],b=points.at(-1),color=path.kind==='camera'?0x2457df:0xa45a0d;
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(V)),new THREE.LineDashedMaterial({color,dashSize:1,gapSize:.6,depthTest:false,toneMapped:false}));line.computeLineDistances();line.renderOrder=10;this.editorOverlay.add(line);
   for(const [p,r]of [[a,.42],[b,.65]]){const ball=new THREE.Mesh(new THREE.SphereGeometry(r,12,8),new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));ball.position.set(...p);ball.renderOrder=11;this.editorOverlay.add(ball);}
   const tail=points.at(-2),d=V(b).sub(V(tail));if(d.length()>.5)this.editorOverlay.add(new THREE.ArrowHelper(d.clone().normalize(),V(tail),d.length(),color,1.4,.7));
  }
  this.render();
 };
 Viewer.prototype.setEditorScene=function(scene,{preserveView=false}={}){
  if(this.sceneData===scene)return;
  const old=preserveView&&this.vol?{mode:this.mode,pos:this.orbitCamera.position.clone(),quat:this.orbitCamera.quaternion.clone(),up:this.orbitCamera.up.clone(),zoom:this.orbitCamera.zoom,target:this.controls.target.clone(),bounds:this.frameBounds?{...this.frameBounds}:null}:null;
  this.setScene(scene);
  if(old){this.orbitCamera.position.copy(old.pos);this.orbitCamera.quaternion.copy(old.quat);this.orbitCamera.up.copy(old.up);this.orbitCamera.zoom=old.zoom;this.controls.target.copy(old.target);this.frameBounds=old.bounds;this.mode=old.mode;this.camera=old.mode==='shot'?this.shotCamera:this.orbitCamera;this.controls.enabled=old.mode!=='shot';this.container.dataset.view=old.mode;this.controls.update();this.resize();}
 };
 Viewer.prototype.captureEditorImage=function({mode='current'}={}){
  if(!this.vol)throw new Error('三维场景尚未就绪。');
  const old={mode:this.mode,camera:this.camera,pos:this.camera.position.clone(),quat:this.camera.quaternion.clone(),up:this.camera.up.clone(),zoom:this.camera.zoom,target:this.controls.target.clone(),bounds:this.frameBounds?{...this.frameBounds}:null};
  try{
   if(mode==='top')this.setMode('top');this.render();const source=this.renderer.domElement;
   if(this.mode!=='shot'){
    if(mode!=='top')return source.toDataURL('image/png');
    const width=source.width,height=source.height,scale=width/this.container.clientWidth,points=[];
    const screen=v=>{const p=v.clone().project(this.camera);return[(p.x+1)*width/2,(1-p.y)*height/2];};
    for(const x of [-this.vol.width/2,this.vol.width/2])for(const z of [-this.vol.depth/2,this.vol.depth/2])points.push(screen(new THREE.Vector3(x,0,z)));
    this.scene.traverse(o=>{if(!o.isSprite||!o.userData.screenLabel)return;let shown=true;for(let p=o;p;p=p.parent)if(!p.visible)shown=false;if(!shown)return;const [x,y]=screen(o.getWorldPosition(new THREE.Vector3())),info=o.userData.screenLabel,halfW=info.height*info.aspect*scale/2,halfH=info.height*scale/2;points.push([x-halfW,y-halfH],[x+halfW,y+halfH]);});
    const pad=12*scale,left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0]))-pad)),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))-pad)),right=Math.min(width,Math.ceil(Math.max(...points.map(p=>p[0]))+pad)),bottom=Math.min(height,Math.ceil(Math.max(...points.map(p=>p[1]))+pad)),c=document.createElement('canvas');c.width=Math.max(1,right-left);const contentHeight=Math.max(1,bottom-top),font=12*scale,padding=10*scale,context=c.getContext('2d'),captions=['机位与站位示意（相对位置）','蓝色：摄影机  棕色：人物路线  小点：起点  大点：终点','短箭头：人物朝向'],lines=[];context.font=font+'px -apple-system, BlinkMacSystemFont, sans-serif';for(const caption of captions){let line='';for(const char of caption){if(context.measureText(line+char).width>c.width-padding*2&&line){lines.push(line);line=char;}else line+=char;}if(line)lines.push(line);}const lineHeight=17*scale,captionHeight=padding*2+lines.length*lineHeight;c.height=contentHeight+captionHeight;context.drawImage(source,left,top,c.width,contentHeight,0,0,c.width,contentHeight);const style=getComputedStyle(this.container);context.fillStyle=style.getPropertyValue('--panel').trim()||'#eeeeee';context.fillRect(0,contentHeight,c.width,captionHeight);context.font=font+'px -apple-system, BlinkMacSystemFont, sans-serif';context.fillStyle=style.getPropertyValue('--text').trim()||'#222222';lines.forEach((line,i)=>context.fillText(line,padding,contentHeight+padding+(i+.9)*lineHeight));return c.toDataURL('image/png');
   }
   const w=source.width,h=source.height,cw=Math.min(w,h*this.aspect),ch=cw/this.aspect,c=document.createElement('canvas');c.width=Math.round(cw);c.height=Math.round(ch);c.getContext('2d').drawImage(source,(w-cw)/2,(h-ch)/2,cw,ch,0,0,c.width,c.height);return c.toDataURL('image/png');
  }finally{
   if(mode==='top'){this.mode=old.mode;this.camera=old.camera;this.camera.position.copy(old.pos);this.camera.quaternion.copy(old.quat);this.camera.up.copy(old.up);this.camera.zoom=old.zoom;this.controls.target.copy(old.target);this.frameBounds=old.bounds;this.controls.enabled=this.mode!=='shot';if(this.activeRig)this.activeRig.visible=this.mode!=='shot';this.container.dataset.view=this.mode;this.controls.update();this.resize();this.render();}
  }
 };
 const dispose=Viewer.prototype.dispose;Viewer.prototype.dispose=function(){this.disableEditing();return dispose.call(this);};
}
