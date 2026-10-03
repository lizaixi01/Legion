import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hweCall} from '../src/hwe-runtime.js';
import {createHweDeps} from '../src/hwe.js';
import {hash} from '../src/provenance.js';
test('host cancellation signals bridge, waits for export, and preserves cancelled result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hwe-cancel-')),cancel=new AbortController();
 const outcome=await hweCall('worker',dir,'fixture-owner',{},1500000,cancel.signal,async request=>{
  assert.equal(request.timeoutMs,1500000);assert.notEqual(request.signal,cancel.signal);
  cancel.abort();await new Promise(resolve=>setTimeout(resolve,30));
  const files=await readdir(dir);assert.equal(files.filter(f=>f.startsWith('cancel-')).length,1);
  assert.equal(JSON.parse(await readFile(join(dir,files.find(f=>f.startsWith('cancel-'))!),'utf8')).reason,'host_cancelled');
  assert.equal(request.signal?.aborted,false);
  await writeFile(join(dir,'rtl.tar.gz'),'saved');await writeFile(join(dir,'worker-session-result.json'),'{"status":"cancelled"}');
  return {status:'completed',exitCode:0,durationMs:30};
 });
 assert.equal(outcome.result.status,'cancelled');assert.equal(await readFile(join(dir,'rtl.tar.gz'),'utf8'),'saved');
});
for(const status of ['completed','timeout','cancelled','error'])test(`worker adapter preserves ${status} and exported snapshot`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'hwe-worker-')),dir=join(root,'worker');await mkdir(dir);
 const config={goal:'Fixture',maxRounds:1,maxWorkers:1,concurrency:1,totalMs:1000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'high'}};
 const deps=createHweDeps(root,config,'hypothesis',async(action,callDir,owner,payload)=>{
  assert.equal(action,'worker');assert.match(String(payload.prompt),/upper bound/);assert.match(String(payload.prompt),/necessary local checks/);
  await writeFile(join(callDir,'rtl.tar.gz'),'source');await writeFile(join(callDir,'REPORT.md'),'Unverified report');
  const logs=join(callDir,'logs');await mkdir(logs);
  await writeFile(join(logs,'stdout.jsonl'),JSON.stringify({type:'worker.snapshot',status,timedOut:status==='timeout',turnCompleted:status==='completed',processExitForced:status==='completed'})+'\n');
  return {logs,result:{status:'completed',exitCode:0,durationMs:100}};
 });
 const work=await deps.work({id:'fixture',parent:'baseline',claim:'Local',experiment:'Local',expected:'Export',workerSeconds:30},{id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'B',experiment:'B',expected:'B',workerSeconds:30},status:'verified',snapshot:{path:join(root,'baseline.tar.gz'),sha256:'fixture'}},dir,new AbortController().signal);
 assert.equal(work.worker?.status,status);assert.equal(work.snapshot?.sha256,hash('source'));assert.equal(work.worker?.report,'Unverified report');
});
