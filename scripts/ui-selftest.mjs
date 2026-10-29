#!/usr/bin/env node
// Deterministic UI-state and packaging checks. Actual layout/keyboard/media need browser QA.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadIcons,renderReport} from './scene-report.mjs';
const require=createRequire(import.meta.url),HERE=dirname(fileURLToPath(import.meta.url)),ROOT=join(HERE,'..'),M=require('../assets/ui-state.cjs');
let count=0;
function test(name,fn){try{fn();count++;}catch(e){process.stderr.write(`FAIL ${name}: ${e.stack}\n`);process.exitCode=1;}}
const shots=[{id:'S01',start:0,end:1.97},{id:'S02',start:1.97,end:3.97},{id:'S03',start:3.97,end:5.97},{id:'S04',start:5.97,end:8.03}];
test('binary lookup clamps before first and after end',()=>{assert.equal(M.shotAtTime(shots,-10),0);assert.equal(M.shotAtTime(shots,9),3);});
test('cut belongs to the incoming shot',()=>{assert.equal(M.shotAtTime(shots,1.9699),0);assert.equal(M.shotAtTime(shots,1.97),1);assert.equal(M.shotAtTime(shots,3.97),2);assert.equal(M.shotAtTime(shots,5.97),3);});
test('last frame remains on final shot',()=>assert.equal(M.shotAtTime(shots,8.03),3));
test('unknown playhead is safe',()=>assert.equal(M.shotAtTime(shots,NaN),0));
test('empty shot list is explicit',()=>assert.equal(M.shotAtTime([],0),-1));
test('seek range never escapes analysis duration',()=>{assert.equal(M.clampTime(-1,8),0);assert.equal(M.clampTime(9,8),8);assert.equal(M.clampTime(NaN,8),0);});
test('seek keeps sub-second precision',()=>assert.equal(M.clampTime(2.815,8),2.815));
test('clock carries fractional seconds into next minute',()=>assert.equal(M.timeLabel(59.999),'1:00.00'));
test('clock formats long and negative values',()=>{assert.equal(M.timeLabel(121.3),'2:01.30');assert.equal(M.timeLabel(-1),'0:00.00');});
test('replay returns to play after a completed movie is seeked',()=>{assert.equal(M.playbackPresentation({paused:true,ended:true}).label,'重播');assert.equal(M.playbackPresentation({paused:true,ended:false}).label,'播放');assert.equal(M.playbackPresentation({paused:false,ended:false}).label,'暂停');});
test('media error presents recovery rather than false playback',()=>assert.equal(M.playbackPresentation({error:true,paused:true}).label,'选择原片'));
test('known panels preserve user choice',()=>{M.TABS.forEach(t=>assert.equal(M.validTab(t),t));assert.equal(M.validTab('hidden'),'analysis');});
const fixtureEvidence=[{id:'GLOBAL',kind:'document',text:'资料'},{id:'E2',shotId:'S02',at:2.8},{id:'E1',shotId:'S01',at:.3},{id:'E2A',shotId:'S02',at:2.2}];
const note={shotId:'S02',cameraNote:{evidenceIds:['E2','E1','missing']},lens:{evidenceIds:['E2A']},subjects:[{motion:{claim:{evidenceIds:['E2']}}}],lighting:[]},scene={fixtures:[{claim:{evidenceIds:['GLOBAL','E2']}}],elements:[]};
test('evidence is deduplicated and unknown IDs omitted',()=>assert.equal(M.collectEvidence(note,null,scene,fixtureEvidence).length,4));
test('current shot evidence comes before cross-shot reference',()=>{const r=M.collectEvidence(note,null,scene,fixtureEvidence);assert.equal(r[0].id,'E2A');assert.equal(r[1].id,'E2');});
test('subject motion evidence remains discoverable',()=>{const n={shotId:'S02',subjects:[{motion:{claim:{evidenceIds:['E2']}}}]};assert.equal(M.collectEvidence(n,null,{},fixtureEvidence)[0].id,'E2');});
test('labels retain full data outside the short caption',()=>{const s={id:'S01',frame:'长的画面描述'};assert.equal(M.shortLabel(s,{label:'人物转身：机位只是示意'}),'人物转身');assert.equal(M.shortLabel(s,null),s.frame);});
const template=readFileSync(join(ROOT,'assets/scene-report.html'),'utf8'),client=readFileSync(join(ROOT,'assets/scene-report.js'),'utf8'),css=readFileSync(join(ROOT,'assets/scene-report.css'),'utf8'),icons=loadIcons();
test('every requested static icon is bundled offline',()=>{const names=[...template.matchAll(/data-icon="([a-z0-9-]+)"/g)].map(m=>m[1]);assert.ok(names.length>20);for(const name of names)assert.ok(icons[name],name);});
test('client literal icon requests are present',()=>{for(const m of client.matchAll(/icon\('([a-z0-9-]+)'\)/g))assert.ok(icons[m[1]],m[1]);});
test('client controls exist exactly once',()=>{const ids=[...template.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);for(const m of client.matchAll(/\$\('([a-z0-9-]+)'\)/g))assert.ok(ids.includes(m[1]),m[1]);});
test('inspector tabs expose their controlled panels',()=>{for(const t of M.TABS){assert.match(template,new RegExp(`id="tab-${t}"[^>]*aria-controls="pane-${t}"`));assert.match(template,new RegExp(`id="pane-${t}"[^>]*role="tabpanel"`));}});
test('seek and speed inputs have explicit names',()=>{assert.match(template,/<input[^>]*id="seek"[^>]*aria-label=/);assert.match(template,/<select[^>]*id="speed"[^>]*aria-label=/);});
test('icon-only buttons have names',()=>{for(const m of template.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)){if(m[1].includes('icon-button'))assert.match(m[1],/aria-label="[^"]+"/);}});
test('focus, selection and reduced motion are provided',()=>{assert.match(css,/:focus-visible/);assert.match(css,/::selection/);assert.match(css,/prefers-reduced-motion:no-preference/);assert.ok(!/transition\s*:\s*all/.test(css));});
test('standalone HTML contains icons, license and UI model',()=>{const s=JSON.parse(readFileSync(join(ROOT,'examples/scene-demo-shots.json'),'utf8')),d=JSON.parse(readFileSync(join(ROOT,'examples/scene-demo.json'),'utf8')),h=renderReport(s,d,{baseDir:ROOT});assert.match(h,/Lucide icon license/);assert.match(h,/FilmReportModel/);assert.ok(!/<script[^>]+src=/.test(h));const raw=h.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1];assert.ok(JSON.parse(raw).icons.play);});
const temp=mkdtempSync(join(tmpdir(),'film-icons-test-'));
try{
 cpSync(join(ROOT,'assets/vendor/lucide'),temp,{recursive:true});
 test('changed downloaded icon fails integrity check',()=>{const p=join(temp,'play.svg'),before=readFileSync(p,'utf8');writeFileSync(p,before+'x');assert.throws(()=>loadIcons(temp),/完整性/);writeFileSync(p,before);});
 test('scripted SVG refused even with a recomputed hash',()=>{const p=join(temp,'play.svg'),bad='<svg><script>alert(1)</script></svg>';writeFileSync(p,bad);const m=JSON.parse(readFileSync(join(temp,'manifest.json'),'utf8'));m.icons.play=createHash('sha256').update(bad).digest('hex');writeFileSync(join(temp,'manifest.json'),JSON.stringify(m));assert.throws(()=>loadIcons(temp),/内容不合法/);});
}finally{rmSync(temp,{recursive:true,force:true});}
if(!process.exitCode)console.log(`✅ ${count} 组工作台状态、可访问性契约与离线图标检查通过（不代替实际界面验收）`);
