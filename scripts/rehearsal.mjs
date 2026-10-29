#!/usr/bin/env node
// Standalone, local-only rehearsal authoring. Never uploads assets or calls a model.
import {readFileSync,writeFileSync,realpathSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import Project from '../assets/rehearsal/project.cjs';
import {validateScene,inlineRehearsalIcons} from './scene-report.mjs';
const here=dirname(fileURLToPath(import.meta.url)),base=resolve(here,'..');
const read=f=>readFileSync(join(base,f),'utf8');
export function renderRehearsal(project){
 return Project.standaloneHtml(project,{styles:read('assets/scene-report.css')+'\n'+read('assets/rehearsal/editor.css'),template:inlineRehearsalIcons(read('assets/rehearsal/editor.html')),three:read('assets/vendor/scene3d.bundle.js'),model:read('assets/rehearsal/project.cjs'),controller:read('assets/rehearsal/controller.js'),license:read('assets/vendor/THREE-LICENSE.txt')});
}

function option(args,name){const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(name+' 缺少值');return args[i+1];}
const usage='排戏工具（本地，无上传）\n  new --out <排戏.html>\n  demo --out <排戏.html>\n  from-report <shots.json> <scene.json> --out <排戏.html> [--shot S01 | --all]\n  validate <工程.json>\n  render <工程.json> --out <排戏.html>\n';
export function main(args){
 const [command,input,scenePath]=args;if(!command||['--help','-h'].includes(command)){console.log(usage);return;}
 let project;if(command==='new')project=Project.createProject();else if(command==='demo')project=Project.demoProject();else if(command==='from-report'){
  if(!input||!scenePath)throw new Error('需要镜头底稿和场景文件。');const shots=JSON.parse(readFileSync(input,'utf8')),scene=JSON.parse(readFileSync(scenePath,'utf8'));const valid=validateScene(shots,scene);if(!valid.ok)throw new Error('原报告校验失败，不能将错配的镜头复制排戏：'+valid.errors.join('；'));project=Project.fromReport(shots,scene,{shotId:option(args,'--shot'),all:args.includes('--all')});
 }else if(['validate','render'].includes(command)){if(!input)throw new Error('缺少工程文件。');project=Project.parseProject(readFileSync(input,'utf8'));}else throw new Error(usage);
 if(command==='validate'){console.log(JSON.stringify(Project.validateProject(project),null,2));return;}
 if(command==='from-report'&&args.includes('--all')&&option(args,'--shot'))throw new Error('只选一镜和复制整段不能同时设置。');
 const out=option(args,'--out');if(!out||extname(out).toLowerCase()!=='.html')throw new Error('需要 --out <排戏.html>');
 for(const source of [input,command==='from-report'?scenePath:null].filter(x=>x&&!x.startsWith('--'))){let a=resolve(source),b=resolve(out);try{a=realpathSync(a);}catch{}try{b=realpathSync(b);}catch{}if(a===b)throw new Error('输出不能覆盖输入工程。');}
 const html=renderRehearsal(project);mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,html);console.log('已生成可编辑排戏页面：'+out+'；不含原片视频，不调用生成模型。');
}
let isMain=false;try{isMain=!!process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url);}catch{}
if(isMain)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
