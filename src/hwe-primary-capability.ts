import {join,dirname,basename} from 'node:path';
import {createHweCheck,hweCheckTool} from './primary-hwe-check.js';
import {createPrimaryStrategy,strategyTool} from './primary-strategy.js';
import {decisionMemory} from './primary-decision-history.js';
import type {PrimaryCapabilityFactory} from './primary-capability.js';

export const hwePrimaryTools=[hweCheckTool,strategyTool];
export const hwePrimaryInstructions=`For authorized HWE tasks with readiness, package RTL with the native host tar command (on Windows, tar.exe), then call legion_hwe_check. Do not invoke WSL or Docker from the model sandbox or weaken permissions to run the verifier; the host tool owns that execution. Use legion_hwe_check for authorized local HWE archives when readiness exists; preserve the returned scope and infrastructure errors. For HWE decisions use legion_strategy to record evidence IDs, selection or rejection reasons, and the next experiment. For the next HWE round, attach workers to a continue decision and execute its frozen plan. Inspect returned task IDs with legion_tasks; when slots free, execute the same plan again to launch remaining allocations. Cancel pending allocations if no longer needed. The host enforces concurrency, per-worker time and call limits. Never finish with pending plans. nextExperiment without workers remains a proposal. On follow-up turns, read legion_strategy to inspect prior decisions; historical records do not certify current artifacts or authorize dispatch.`;
export const createHwePrimaryCapability:PrimaryCapabilityFactory=({root,request,deadline,budget,tasks})=>{
 const check=createHweCheck(root,request.workspace,join(request.attemptDir,'hwe-checks'),deadline,request.signal,undefined,budget);
 const strategy=createPrimaryStrategy(join(request.attemptDir,'decisions'),check,{capacity:tasks.capacity,dispatch:(work,link)=>tasks.call('legion_dispatch',work,link)},()=>decisionMemory(dirname(request.attemptDir),basename(request.attemptDir)));
 return {
  tools:hwePrimaryTools,instructions:hwePrimaryInstructions,
  call:(name,args)=>name==='legion_strategy'?strategy.call(args):name==='legion_hwe_check'?check(args):Promise.reject(Error('Unknown HWE capability tool')),
  pending:()=>Boolean(check.pending()||strategy.pending()),failures:check.failures,finalize:strategy.finalize,stopDispatch:strategy.close,
  close:async()=>{try{await strategy.close();}finally{await check.close();}},
 };
};
