import {join,resolve} from 'node:path';
import {managedChatWorker} from './managed-chat.js';
import {demoGoal} from './acceptance-demo.js';
if(!process.argv.includes('--allow-model-calls')){console.error('Not started. Real model smoke requires --allow-model-calls (3 minute deadline, at most 6 model calls).');process.exitCode=1;}
else {const dir=resolve('.local','acceptance-smoke-'+Date.now());const result=await managedChatWorker(process.cwd(),{model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:2}},[],{maxCalls:6,maxVerifications:6})({workspace:process.cwd(),attemptDir:join(dir,'turn'),prompt:demoGoal,timeoutMs:180000});console.log(JSON.stringify({path:dir,result},null,2));if(result.acceptance?.status!=='accepted')process.exitCode=1;}
