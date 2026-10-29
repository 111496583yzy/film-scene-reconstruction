// Geometry shared by the real WebGL viewer and deterministic tests. Relative units, not metres.
export function worldPoint(point, elevation, volume) {
  if (!point) return null;
  return [(point[0]/100-.5)*volume.width, elevation, (point[1]/100-.5)*volume.depth];
}
export function boxWorld(box, volume) {
  return {center:worldPoint([box[0]+box[2]/2,box[1]+box[3]/2],0,volume),width:box[2]/100*volume.width,depth:box[3]/100*volume.depth};
}
export function horizontalToVerticalFov(deg, aspect) {
  if (!(deg>0 && deg<170 && aspect>0)) throw new Error('Invalid calibrated / explicitly schematic view angle');
  return 2*Math.atan(Math.tan(deg*Math.PI/360)/aspect)*180/Math.PI;
}
export function interpolatePose(camera, path, progress) {
  const result={...camera};
  if(!path?.length)return result;
  const t=Math.max(0,Math.min(1,progress));
  let i=path.findIndex((p,k)=>k<path.length-1&&t>=p.at&&t<=path[k+1].at);
  if(i<0)i=path.length-2;
  const a=path[i],b=path[i+1],u=(t-a.at)/(b.at-a.at);
  for(const key of ['position','target'])result[key]=a[key].map((v,k)=>v+(b[key][k]-v)*u);
  for(const key of ['elevation','targetElevation'])if(Number.isFinite(a[key])&&Number.isFinite(b[key]))result[key]=a[key]+(b[key]-a[key])*u;
  return result;
}
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a);if(n<1e-9)throw new Error('Camera and target overlap');return mul(a,1/n);};
export function frustumCorners(position,target,horizontalAngle,aspect,near,far) {
  if(!(near>0&&far>near))throw new Error('Invalid frustum depth');
  horizontalToVerticalFov(horizontalAngle,aspect);
  const dir=norm(sub(target,position));
  const up=Math.abs(dir[1])>.99?[0,0,1]:[0,1,0];
  const right=norm(cross(dir,up)),vertical=norm(cross(right,dir));
  return [near,far].flatMap(depth=>{
    const center=add(position,mul(dir,depth)),halfW=Math.tan(horizontalAngle*Math.PI/360)*depth,halfH=halfW/aspect;
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>add(add(center,mul(right,x*halfW)),mul(vertical,y*halfH)));
  });
}
export function geometrySummary(scene) {
  const elements=scene.elements||[];
  return {solidElements:elements.filter(e=>e.kind!=='zone'&&e.height>0).length,
    walls:elements.filter(e=>e.kind==='wall').length,backgroundPeople:(scene.extras||[]).length,
    volume:scene.volume?{...scene.volume,claim:undefined}:null};
}
export function interpolateSubject(subject,progress){
  const path=subject.motion?.path;if(!path?.length)return {...subject};
  const t=Math.max(0,Math.min(1,progress));let i=path.findIndex((p,k)=>k<path.length-1&&t>=p.at&&t<=path[k+1].at);if(i<0)i=path.length-2;
  const a=path[i],b=path[i+1],u=(t-a.at)/(b.at-a.at),result={...subject};
  if(a.position&&b.position)result.position=a.position.map((v,k)=>v+(b.position[k]-v)*u);
  if(Number.isFinite(a.headingDeg)&&Number.isFinite(b.headingDeg)){const delta=((b.headingDeg-a.headingDeg+540)%360)-180;result.headingDeg=a.headingDeg+delta*u;}
  if(Number.isFinite(a.elevation)&&Number.isFinite(b.elevation))result.elevation=a.elevation+(b.elevation-a.elevation)*u;
  return result;
}
