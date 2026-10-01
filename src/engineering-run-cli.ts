import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {createResumableEngineeringService,approvalHash} from './engineering-run.js';import {projectFiles} from './engineering.js';
const [action,arg,rootArg]=process.argv.slice(2).filter(s=>!s.startsWith('--')),root=resolve(rootArg??process.cwd()),service=createResumableEngineeringService(root);
try{
 if(action==='list')console.log(JSON.stringify(await service.list(),null,2));
 else if(action==='detail')console.log(JSON.stringify(await service.detail(arg!),null,2));
 else if(action==='prepare'){const c=JSON.parse(await readFile(resolve(arg!),'utf8'));console.log(JSON.stringify({goal:c.goal,plan:c.plan,approvedHash:approvalHash(c.goal,await projectFiles(c.project),c.plan),notice:'Review each requirement → test mapping before using this hash to approve. Model-generated tests are proposals.'},null,2));}
 else if(action==='create'){const c=JSON.parse(await readFile(resolve(arg!),'utf8'));console.log(JSON.stringify(await service.create(c)));}
 else if(action==='resume'||action==='smoke'){
  if(!process.argv.includes('--allow-model-calls'))throw Error('Real executor requires --allow-model-calls; no model called');
  let id=arg!;if(action==='smoke'){const c=JSON.parse(await readFile(resolve(arg!),'utf8'));id=(await service.create({...c,absoluteDeadline:Date.now()+600000,totalMs:600000,maxCalls:12,initialCalls:0,concurrency:2})).id;}
  const interrupt=()=>service.requestPause();process.on('SIGINT',interrupt);
  await service.resume(id);await service.wait();process.off('SIGINT',interrupt);const result=await service.detail(id);console.log(JSON.stringify(result,null,2));if(!['completed','paused'].includes(result.status))process.exitCode=1;
 }else if(action==='pause')await service.requestControl(arg!,'pause');
 else if(action==='cancel'){try{await service.cancel(arg!);}catch(e){if(!String(e).includes('still alive'))throw e;await service.requestControl(arg!,'cancel');}}
 else throw Error('Usage: engineering prepare|create <config.json> [root]; list; detail|resume|pause|cancel <id> [root]. Resume/smoke also require --allow-model-calls.');
}catch(e){console.error(String(e));process.exitCode=1;}
