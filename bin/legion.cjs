#!/usr/bin/env node
'use strict';
const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);

const usage=()=>console.log([
  'Legion — 本地 Agent 管理系统',
  '',
  '用法:',
  '  legion                 打开桌面应用',
  '  legion run <config>    运行受管理的任务',
  '  legion status <run>    查看运行状态',
  '  legion pause <run>     暂停（goal 模式）',
  '  legion resume <run>    恢复（goal 模式）',
  '  legion demo            端到端演示（不调用模型）',
  '  legion demo-goal       持续目标演示（不调用模型）',
  '  legion ui              浏览器界面（开发用）',
  '',
  '其它: npm run desktop / npm run team / npm test',
].join('\n'));

function openDesktop(){
  const tsc=path.join(root,'node_modules','typescript','bin','tsc');
  const built=spawnSync(process.execPath,[tsc,'--project',root],{cwd:root,stdio:'inherit'});
  if(built.error){console.error(String(built.error));process.exitCode=1;return;}
  if(built.status!==0){console.error('构建失败，未启动桌面应用。');process.exitCode=built.status??1;return;}
  const child=spawn(process.execPath,[path.join(root,'desktop','launch.cjs')],{cwd:root,detached:true,stdio:'ignore',windowsHide:false});
  child.on('error',error=>{console.error(String(error));process.exitCode=1;});
  child.unref();
  console.log('Legion 已启动。');
}

function runScript(script,rest){
  const tsx=path.join(root,'node_modules','tsx','dist','cli.mjs');
  const child=spawn(process.execPath,[tsx,path.join(root,'src',script),...rest],{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',error=>{console.error(String(error));process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}

if(args.length===0)openDesktop();
else if(args[0]==='--help'||args[0]==='-h'||args[0]==='help')usage();
else if(args[0]==='ui')runScript('ui-server.ts',args.slice(1));
else runScript('cli.ts',args);
