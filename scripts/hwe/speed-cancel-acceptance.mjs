// Zero-model cancellation acceptance of the new pipeline, after the small model batch.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runResearch} from '../../src/research-loop.ts';
import {createHweDeps} from '../../src/hwe.ts';
import {hash} from '../../src/provenance.ts';
import {lockWorkspace} from '../../src/lock.ts';
import {ownerAudit} from '../../src/benchmarks/hwe-speed-cli.ts';
const batch=resolve(process.argv[2]),result=JSON.parse(await readFile(join(batch,'result.json'),'utf8'));
const remaining=45*60000-(Date.now()-Date.parse(result.startedAt));if(remaining<180000)throw Error('Insufficient shared 45-minute acceptance budget; cancellation fixture not started');
const root=join(batch,'cancel-run'),owner='research-'+hash(root).slice(0,16),controller=new AbortController();
process.env.PROACTIVE_HWE_READINESS_SOURCE=join(batch,'readiness');
const config={goal:'Zero-model development cancellation fixture',maxRounds:1,maxWorkers:4,allocationsPerRound:4,concurrency:2,verificationConcurrency:2,verificationScheduling:'worker-ready',totalMs:Math.min(150000,remaining),manager:{model:'gpt-6.1-sol',effort:'xhigh'},worker:{model:'gpt-6.1-sol',effort:'xhigh'}};
const host=createHweDeps(root,config),h=id=>({id,parent:'baseline',claim:'Copy certified baseline',experiment:'No model; exercise real verification cancellation',expected:'Cancellation, not a score',workerSeconds:30});
const deps={...host,decide:async()=>({action:'experiment',reason:'Zero-model controlled cancel',hypotheses:['cancel-one','cancel-two','cancel-three','cancel-four'].map(h),discard:[]}),work:async(h,parent,dir)=>{const path=join(dir,'rtl.tar.gz');await writeFile(path,await readFile(parent.snapshot.path));return {snapshot:{path,sha256:parent.snapshot.sha256},worker:{status:'replay',usage:[],durationMs:0,report:'No Worker model; copied certified baseline'}};}};
const execution=resolve('.local/hwe-execution'),release=await lockWorkspace(execution,root);let requestedAt,observedIds;
const timer=setTimeout(()=>controller.abort(new Error('Cancel fixture budget')),Math.min(150000,remaining));
const command=promisify(execFile);const task=runResearch(root,config,deps,controller.signal);
try{
 for(let i=0;i<60&&!controller.signal.aborted;i++){
  const {stdout}=await command('wsl.exe',['-d','Ubuntu-24.04','--','docker','ps','-q','--filter','label=proactive.owner='+owner],{windowsHide:true,timeout:15000});const ids=stdout.trim().split(/\s+/).filter(Boolean);
  if(ids.length===2){observedIds=ids;requestedAt=new Date().toISOString();controller.abort(new Error('Controlled cancel after two real verifier containers'));break;}
  await new Promise(r=>setTimeout(r,1000));
 }
 const state=await task;const audit=await ownerAudit(batch,owner,join(batch,'cancel-owner-audit.jsonl'));
 const summary={owner,modelsCalled:0,observedIds,requestedAt,endedAt:state.endedAt,cancelToDrainMs:requestedAt?Date.parse(state.endedAt)-Date.parse(requestedAt):null,status:state.status,cleanup:state.cleanup,verificationStarted:state.candidates.filter(c=>c.verification?.startedAt).length,queuedNotStarted:state.candidates.filter(c=>!c.verification?.startedAt).length,best:state.best,persistenceErrors:state.persistenceErrors??[],audit};
 await writeFile(join(batch,'cancel-result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));if(!requestedAt||state.status!=='cancelled'||state.best!=='baseline'||summary.verificationStarted!==2||summary.queuedNotStarted!==2)process.exitCode=1;
}finally{clearTimeout(timer);controller.abort();await task;await release();}
