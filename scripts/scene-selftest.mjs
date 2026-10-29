#!/usr/bin/env node
// Behavioral invariants; local-only, no network/model/database. No browser claim.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReportServer } from './serve-report.mjs';
import { fingerprint, initScene, validateScene, renderReport, videoUrl, bundleFrames, safeJson } from './scene-report.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), root=join(HERE,'..');
const shots=JSON.parse(readFileSync(join(root,'examples/scene-demo-shots.json'),'utf8'));
const doc=JSON.parse(readFileSync(join(root,'examples/scene-demo.json'),'utf8'));
let passed=0;
function test(name,fn){try{fn();passed++;}catch(e){process.stderr.write(`FAIL ${name}: ${e.stack}\n`);process.exitCode=1;}}
const copy=v=>structuredClone(v);
function bad(name,fn,pattern){test(name,()=>{const d=copy(doc),s=copy(shots);fn(d,s);const r=validateScene(s,d);assert.equal(r.ok,false);if(pattern)assert.match(r.errors.join('\n'),pattern);});}
function good(name,fn){test(name,()=>{const d=copy(doc),s=copy(shots);fn(d,s);assert.equal(validateScene(s,d).ok,true);});}
const tmp=mkdtempSync(join(tmpdir(),'film-scene-selftest-'));
try {
 test('fixture passes',()=>{const r=validateScene(shots,doc);assert.equal(r.ok,true);assert.deepEqual(r.errors,[]);});
 test('unknown skeleton valid but explicitly incomplete',()=>{const d=initScene(shots),r=validateScene(shots,d);assert.equal(r.ok,true);assert.ok(r.warnings.length>=shots.shots.length*5);assert.ok(d.shots.every(s=>s.setupId===null));});
 test('null inputs return failure',()=>assert.equal(validateScene(null,null).ok,false));
 bad('schema version',d=>d.schemaVersion=3,/版本/);
 bad('stale cuts',(_,s)=>s.seedCuts.push(.5),/底稿已改变/);
 bad('stale motion',(_,s)=>s.shots[0].motion+=1,/底稿已改变/);
 bad('stale source',(_,s)=>s.source='other.mp4',/底稿已改变/);
 good('annotation does not invalidate machine binding',(_,s)=>s.shots[0].frame='修改画面描述而不修改时间。');
 bad('incomplete shot coverage',d=>d.shots.pop(),/缺少逐镜/);
 bad('duplicate shot',d=>d.shots.push(copy(d.shots[0])),/重复镜头/);
 bad('nonexistent shot',d=>d.shots[0].shotId='S98',/未知或重复/);
 bad('missing scene',d=>d.shots[0].sceneId='R2',/有效场景/);
 bad('cross-scene setup',d=>{d.scenes.push({...copy(d.scenes[0]),id:'R2'});d.setups[0].sceneId='R2';},/不属于/);
 bad('missing setup',d=>d.shots[0].setupId='XX',/机位不存在/);
 bad('duplicate evidence',d=>d.evidence.push(copy(d.evidence[0])),/重复/);
 bad('evidence out of range',d=>d.evidence[0].at=-1,/证据时间/);
 bad('evidence exactly at out point',d=>d.evidence[0].at=shots.shots[0].end,/证据时间/);
 bad('evidence nonexistent shot',d=>d.evidence[0].shotId='S98',/证据时间/);
 bad('missing evidence reference',d=>d.shots[0].cameraNote.evidenceIds=['missing'],/找不到证据/);
 bad('empty evidence for inference',d=>d.shots[0].cameraNote.evidenceIds=[],/必须引用证据/);
 bad('author cannot prove observed fact',d=>{d.evidence[0].kind='author';d.evidence[0].locator='讲解叠层';d.shots[0].cameraNote.status='observed';},/作者标注不能证明/);
 good('author may support explicitly inferred scheme',d=>{d.evidence[0].kind='author';d.evidence[0].locator='讲解叠层';});
 good('external document evidence',d=>{d.evidence[0]={id:'E1',kind:'document',text:'合成测试用资料，不是剧组文件。',locator:'测试夹具第 1 页'};});
 bad('document needs source',d=>d.evidence[0]={id:'E1',kind:'document',text:'无来源资料'},/来源定位/);
 bad('invalid claim status',d=>d.shots[0].lens.status='verified',/合法/);
 bad('unknown cannot claim high confidence',d=>{d.shots[0].lens.status='unknown';d.shots[0].lens.confidence='high';},/未知结论/);
 bad('unknown camera cannot draw exact coordinates',d=>d.setups[0].camera.claim={status:'unknown',confidence:'unknown',text:'未知',evidenceIds:[],alternatives:[]},/未知机位/);
 bad('out of range camera',d=>d.setups[0].camera.position=[101,2],/坐标/);
 bad('nonfinite camera',d=>d.setups[0].camera.position=[NaN,2],/坐标/);
 bad('camera same as target',d=>d.setups[0].camera.target=copy(d.setups[0].camera.position),/不能重合/);
 bad('partly missing pose',d=>d.setups[0].camera.position=null,/同时未知/);
 bad('invalid fov',d=>d.setups[0].camera.viewAngleDeg=180,/视角/);
 good('unknown fov does not default to a fake cone',d=>d.setups[0].camera.viewAngleDeg=null);
 bad('anchor outside scene',d=>d.scenes[0].elements[0].box=[90,0,20,10],/box/);
 bad('unknown structure cannot be drawn',d=>d.scenes[0].elements[0].claim={status:'unknown',confidence:'unknown',text:'未知',evidenceIds:[],alternatives:[]},/未知结构/);
 bad('light role',d=>d.shots[0].lighting[0].role='laser',/role/);
 bad('unknown subject cannot be drawn',d=>d.shots[0].subjects[0].claim={status:'unknown',confidence:'unknown',text:'未知',evidenceIds:[],alternatives:[]},/未知位置/);
 bad('camera path unordered',d=>d.shots[1].cameraMotion.path[1].at=0,/运动轨迹/);
 bad('camera path must cover end',d=>d.shots[1].cameraMotion.path.at(-1).at=.9,/覆盖镜内/);
 bad('camera path without setup',d=>d.shots[1].setupId=null,/须关联机位/);
 bad('unknown movement cannot animate',d=>d.shots[1].cameraMotion.claim={status:'unknown',confidence:'unknown',text:'未知',evidenceIds:[],alternatives:[]},/未知运动/);
 bad('base times must be continuous',(_,s)=>s.shots[1].start+=.6,/时间轴/);
 test('render carries all data, no script breakout or replacement corruption',()=>{
  const d=copy(doc);d.title='</script><img onerror=alert(1)> $&';d.shots[0].cameraNote.text='quote </script> $& $`';
  const html=renderReport(shots,d,{baseDir:tmp});
  const raw=html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(raw).scene.title,d.title);assert.equal(JSON.parse(raw).scene.shots[0].cameraNote.text,d.shots[0].cameraNote.text);
  assert.ok(!raw.includes('</script>'));assert.ok(!html.includes('/*REPORT_'));assert.match(html,/&lt;\/script&gt;/);
 });
 test('missing frames explicitly reported',()=>{const {frames,missing}=bundleFrames(shots,tmp);assert.equal(missing.length,shots.shots.length*2);assert.deepEqual(frames,{});});
 test('available frame embedded',()=>{mkdirSync(join(tmp,'frames'));writeFileSync(join(tmp,'frames/S01a.jpg'),Buffer.from([255,216,255,217]));const f=bundleFrames(shots,tmp);assert.match(f.frames.S01a,/^data:image\/jpeg;base64,/);assert.equal(f.missing.length,shots.shots.length*2-1);});
 test('local unicode and spaces URL encoded',()=>assert.equal(videoUrl('片 段.mp4',tmp,tmp),'%E7%89%87%20%E6%AE%B5.mp4'));
 test('no remote URL or script protocol',()=>{for(const u of ['https://example.invalid/video.mp4','javascript:alert(1)','data:video/mp4,AAAA'])assert.throws(()=>videoUrl(u,tmp,tmp),/本地文件/);});
 test('relative output dir keeps movie link',()=>assert.equal(videoUrl('clip.mp4',tmp,join(tmp,'report')),'../clip.mp4'));
 test('safe JSON roundtrips line separators and script text',()=>{const x={text:'</script>\u2028\u2029 $&'};assert.deepEqual(JSON.parse(safeJson(x)),x);});
 // CLI failure recovery; existing data/report must survive unsuccessful operations.
 const shotPath=join(tmp,'shots.json'),scenePath=join(tmp,'scene.json'),out=join(tmp,'result.html');
 writeFileSync(shotPath,JSON.stringify(shots));writeFileSync(scenePath,JSON.stringify(doc));
 const run=args=>spawnSync(process.execPath,[join(HERE,'scene-report.mjs'),...args],{encoding:'utf8',cwd:tmp});
 test('CLI renders a file',()=>{const r=run(['render',shotPath,scenePath,'--out',out]);assert.equal(r.status,0,r.stderr);assert.match(readFileSync(out,'utf8'),/report-data/);});
 test('invalid scene preserves previous report',()=>{const d=copy(doc);d.binding.fingerprint='stale';writeFileSync(scenePath,JSON.stringify(d));const before=readFileSync(out,'utf8'),r=run(['render',shotPath,scenePath,'--out',out]);assert.equal(r.status,1);assert.equal(readFileSync(out,'utf8'),before);writeFileSync(scenePath,JSON.stringify(doc));});
 test('init refuses overwrite',()=>{const before=readFileSync(scenePath,'utf8'),r=run(['init',shotPath,'--out',scenePath]);assert.equal(r.status,1);assert.equal(readFileSync(scenePath,'utf8'),before);});
 test('invalid JSON leaves input intact',()=>{const invalid=join(tmp,'bad.json');writeFileSync(invalid,'{oops');const r=run(['validate',shotPath,invalid]);assert.equal(r.status,1);assert.equal(readFileSync(invalid,'utf8'),'{oops');});
 test('missing args fail',()=>{assert.equal(run(['render',shotPath,scenePath,'--out']).status,1);assert.equal(run(['validate',shotPath]).status,1);assert.equal(run(['bogus']).status,1);});
 test('renders work from any cwd',()=>{const r=run(['render',shotPath,scenePath,'--out',join(tmp,'arbitrary-cwd.html')]);assert.equal(r.status,0,r.stderr);});
 const server=createReportServer(tmp);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(tmp,'clip.mp4'),Buffer.from('0123456789'));
  for(const [name,headers,code,body] of [
   ['whole file',{},200,'0123456789'],['byte range',{Range:'bytes=2-5'},206,'2345'],
   ['suffix range',{Range:'bytes=-3'},206,'789'],['open range',{Range:'bytes=7-'},206,'789'],
   ['invalid range',{Range:'bytes=30-40'},416,''],['multipart refused',{Range:'bytes=0-1,4-5'},416,'']
  ]){
   const response=await fetch(base+'/clip.mp4',{headers});const result=await response.text();
   test('video preview '+name,()=>{assert.equal(response.status,code);assert.equal(result,body);assert.equal(response.headers.get('Accept-Ranges'),'bytes');});
  }
  const head=await fetch(base+'/clip.mp4',{method:'HEAD'});
  test('preview HEAD',()=>{assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'10');});
  const notfound=await fetch(base+'/missing.mp4');test('preview missing video',()=>assert.equal(notfound.status,404));
  const post=await fetch(base+'/clip.mp4',{method:'POST'});test('preview refuses mutation methods',()=>assert.equal(post.status,405));
 }finally{server.closeAllConnections?.();await new Promise(r=>server.close(r));}
} finally {rmSync(tmp,{recursive:true,force:true});}
if(!process.exitCode)process.stdout.write(`✅ ${passed} 组场景行为测试通过（无模型、无外部网络；不代替视觉或片场真实性验证）\n`);
