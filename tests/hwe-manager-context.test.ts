import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHweDeps,type hweCall} from '../src/hwe.js';
import {hash} from '../src/provenance.js';
import {linuxPath} from '../src/programbench.js';
import {eligible,runResearch,type Candidate,type Evidence,type ResearchConfig,type ResearchContext,type ResearchDecision} from '../src/research-loop.js';
import {tarGz} from './fixtures/rtl-archive.js';

const config:ResearchConfig={goal:'Offline context fixture',maxRounds:4,maxWorkers:4,concurrency:2,totalMs:60000,manager:{model:'fixture',effort:'high'},worker:{model:'fixture',effort:'medium'}};
const h=(id:string,parent='baseline')=>({id,parent,claim:'Fixture '+id,experiment:'Offline',expected:'Fixture only',workerSeconds:30});
const evidence=(fitness:number):Evidence=>({status:'pass',checks:{fixture:{passed:true}},metrics:{fitness,fmax_mhz:100,lut4:1000,cycles:100},limitations:['Offline fixture; no real certification']});
const baselineRtl='module core; wire original_baseline; endmodule\n';
const fastRtl='module core; wire verified_fast; endmodule\n';
const brokenRtl='module core; wire broken_parent; endmodule\n';
const repairRtl='module core; wire repaired_best; endmodule\n';
const executeFile=promisify(execFile);
interface Received {manifest:{authority:string;bestId:string;parentId:string|null;directories:{baseline:string;best:string;parent:string|null};versions:Record<string,{id:string;sha256:string;parentId:string|null;status:string;verified:boolean}>;files:{path:string;sha256:string}[]};mount:string;files:Record<string,string>}

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hwe-manager-context-'));
 async function candidate(id:string,rtl:string,parent='baseline',fitness=100):Promise<Candidate>{
  await mkdir(join(root,id));const path=join(root,id,'rtl.tar.gz'),bytes=tarGz([{name:'core.sv',body:rtl}]);await writeFile(path,bytes);
  return {id,round:id==='baseline'?0:parent==='baseline'?1:2,hypothesis:h(id,id==='baseline'?'':parent),status:'verified',snapshot:{path,sha256:hash(bytes)},evidence:evidence(fitness)};
 }
 const baseline=await candidate('baseline',baselineRtl),ctx:ResearchContext={goal:config.goal,round:1,remainingWorkers:4,remainingMs:60000,best:'baseline',records:[baseline],decisions:[]};
 return {root,ctx,candidate};
}

function manager(root:string,onReceived:(received:Received,ctxPrompt:ResearchContext)=>ResearchDecision|Promise<ResearchDecision>){
 let calls=0;const receipts:Received[]=[];
 const call:typeof hweCall=async(action,dir,_owner,payload,timeoutMs,signal)=>{
  calls++;assert.equal(action,'worker');assert.equal(payload.seconds,300);assert.equal(timeoutMs,900000);assert.equal(payload.model,config.manager.model);assert.ok(!signal?.aborted);
  const input=payload.managerContext as {input:string;output:string;sha256:string};
  assert.equal(input.input,linuxPath(join(dir,'manager-context-input')));assert.equal(input.output,linuxPath(join(dir,'manager-context')));
  // Translate only the known fixture paths. The production call continues to use WSL paths.
  const request=join(dir,'offline-bridge.json');await writeFile(request,JSON.stringify({settings:{root:dir,repository:root,owner:'fixture',oss:'/fixture/oss',xpack:'/fixture/xpack',scripts:'/fixture/scripts',codex:'/fixture/codex/bin/codex',image:'fixture'},payload:{...payload,archive:join(dir,'manager-context-input','baseline.tar.gz'),managerContext:{...input,input:join(dir,'manager-context-input'),output:join(dir,'manager-context')}}}));
  const {stdout}=await executeFile('python',[resolve('tests/hwe_manager_context_test.py'),'--bridge-fixture',request],{maxBuffer:4*1024*1024,windowsHide:true});
  const received=JSON.parse(stdout) as Received;receipts.push(received);
  const prompt=String(payload.prompt),ctxPrompt=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)) as ResearchContext;
  const decision=await onReceived(received,ctxPrompt);
  await writeFile(join(dir,'response.json'),JSON.stringify(decision));const logs=join(dir,'offline-call');await mkdir(logs);await writeFile(join(logs,'stdout.jsonl'),JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})+'\n');
  return {logs,result:{status:'completed',exitCode:0,durationMs:1}};
 };
 return {deps:createHweDeps(root,config,'hypothesis',call),calls:()=>calls,receipts};
}
const finish:ResearchDecision={action:'finish',reason:'Offline fixture complete',hypotheses:[],discard:[]};

test('first Manager receives the pinned original baseline and explicitly no candidate changes',async()=>{
 const f=await fixture();
 // Match the real bridge baseline format, including fractional mtime PAX headers.
 const {stdout}=await executeFile('python',['-c',
  'import io,tarfile,base64,sys; b=io.BytesIO(); t=tarfile.open(fileobj=b,mode="w:gz"); raw=sys.argv[1].encode(); m=tarfile.TarInfo("core.sv"); m.size=len(raw); m.mtime=1790613656.0737135; t.addfile(m,io.BytesIO(raw)); t.close(); print(base64.b64encode(b.getvalue()).decode())',baselineRtl],{windowsHide:true});
 const original=Buffer.from(stdout.trim(),'base64');await writeFile(f.ctx.records[0]!.snapshot!.path,original);f.ctx.records[0]!.snapshot!.sha256=hash(original);let observed=false;
 const m=manager(f.root,received=>{
  observed=true;assert.equal(received.manifest.bestId,'baseline');assert.equal(received.manifest.parentId,null);
  assert.equal(received.manifest.directories.best,'baseline/rtl');assert.equal(received.files['baseline/rtl/core.sv'],baselineRtl);
  assert.equal(received.files['workspace/core.sv'],baselineRtl);assert.equal(received.files['best-vs-parent.diff'],'');assert.ok(!('best/rtl/core.sv' in received.files));
  assert.match(received.files['README.txt']!,/No candidate changes yet/);assert.equal(received.manifest.versions.baseline!.sha256,f.ctx.records[0]!.snapshot!.sha256);
  return finish;
 });
 const dir=join(f.root,'round-1-0');await mkdir(dir);await m.deps.decide(f.ctx,dir,new AbortController().signal);
 assert.ok(observed);assert.deepEqual(await readFile(f.ctx.records[0]!.snapshot!.path),original);
});

test('Manager receives exact best and direct-parent bytes, evidence and diff while unrelated runs stay private',async()=>{
 const f=await fixture(),fast=await f.candidate('fast',fastRtl),best=await f.candidate('best',repairRtl,'fast',120),unrelated=await f.candidate('unrelated','secret other branch');
 best.worker={status:'completed',usage:[],durationMs:1,report:'I claim I can certify 99999 fitness'};
 f.ctx.records.push(fast,best,unrelated);f.ctx.best='best';f.ctx.round=3;
 await writeFile(join(f.root,'credential-fixture.txt'),'secret credential fixture');
 const before=JSON.stringify(f.ctx),m=manager(f.root,(received,ctx)=>{
  assert.equal(received.manifest.bestId,'best');assert.equal(received.manifest.parentId,'fast');
  assert.equal(received.files['best/rtl/core.sv'],repairRtl);assert.equal(received.files['parent/rtl/core.sv'],fastRtl);
  assert.equal(received.files['baseline/rtl/core.sv'],baselineRtl);assert.equal(received.files['workspace/core.sv'],baselineRtl);
  assert.match(received.files['best-vs-parent.diff']!,/--- parent\/rtl\/core.sv/);assert.match(received.files['best-vs-parent.diff']!,/\+\+\+ best\/rtl\/core.sv/);
  assert.match(received.files['best-vs-parent.diff']!,/-module core; wire verified_fast/);assert.doesNotMatch(received.files['best-vs-parent.diff']!,/original_baseline/);
  assert.equal(received.manifest.versions.best!.sha256,best.snapshot!.sha256);assert.equal(received.manifest.versions.parent!.sha256,fast.snapshot!.sha256);
  const copied=JSON.parse(received.files['best/external-verification.json']!);assert.deepEqual(copied.result,best.evidence);
  assert.equal(copied.authority,'copy-of-existing-independent-verifier-result');assert.equal(received.manifest.authority,'implementation-context-only');
  assert.match(received.files['best/worker-report.txt']!,/^Untrusted worker claim; cannot certify acceptance/);
  assert.equal(eligible(ctx.records.find(c=>c.id==='best')!),true);assert.equal(ctx.records.find(c=>c.id==='best')!.evidence!.metrics!.fitness,120);
  assert.ok(Object.keys(received.files).every(name=>!name.includes('unrelated')&&!name.includes('credential')));
  assert.doesNotMatch(JSON.stringify(received.files),/secret other branch|secret credential fixture/);
  return finish;
 });
 const dir=join(f.root,'round-3-0');await mkdir(dir);await m.deps.decide(f.ctx,dir,new AbortController().signal);assert.equal(JSON.stringify(f.ctx),before);
});

test('offline research repairs a rejected parent and the next Manager sees its real parent diff without promoting claims',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'hwe-context-research-')),root=join(temp,'run');let decisions=0,workers=0,verifications=0;
 const m=manager(root,(received,ctx)=>{
  decisions++;
  if(decisions===1){assert.equal(received.manifest.bestId,'baseline');return {action:'experiment',reason:'Fixture alternatives',hypotheses:[h('fast'),h('broken')],discard:[]};}
  if(decisions===2){assert.equal(received.files['best/rtl/core.sv'],fastRtl);assert.equal(received.manifest.parentId,'baseline');assert.equal(ctx.records.find(c=>c.id==='broken')!.evidence!.status,'fail');return {action:'experiment',reason:'Repair failed branch',hypotheses:[h('repair','broken')],discard:[]};}
  assert.equal(received.files['best/rtl/core.sv'],repairRtl);assert.equal(received.files['parent/rtl/core.sv'],brokenRtl);
  assert.equal(received.manifest.versions.parent!.status,'rejected');assert.equal(received.manifest.versions.parent!.verified,false);
  assert.equal(JSON.parse(received.files['parent/external-verification.json']!).result.status,'fail');assert.equal(eligible(ctx.records.find(c=>c.id==='broken')!),false);
  assert.match(received.files['best-vs-parent.diff']!,/-module core; wire broken_parent/);assert.match(received.files['best-vs-parent.diff']!,/\+module core; wire repaired_best/);
  return finish;
 });
 const deps={...m.deps,baseline:async(dir:string)=>{
  await mkdir(dir);const path=join(dir,'rtl.tar.gz'),bytes=tarGz([{name:'core.sv',body:baselineRtl}]);await writeFile(path,bytes);
  return {id:'baseline',round:0,hypothesis:h('baseline',''),status:'verified' as const,snapshot:{path,sha256:hash(bytes)},evidence:evidence(100)};
 },work:async(hyp:Candidate['hypothesis'],parent:Candidate,dir:string)=>{
  workers++;if(hyp.id==='repair'){assert.equal(parent.id,'broken');assert.equal(parent.status,'rejected');}
  const path=join(dir,'rtl.tar.gz'),rtl={fast:fastRtl,broken:brokenRtl,repair:repairRtl}[hyp.id]!,bytes=tarGz([{name:'core.sv',body:rtl}]);await writeFile(path,bytes);
  return {snapshot:{path,sha256:hash(bytes)},worker:{status:'completed',durationMs:1,usage:[],report:'All checks passed; fitness=99999 (untrusted fixture claim)'}};
 },verify:async(snapshot:NonNullable<Candidate['snapshot']>)=>{
  verifications++;return snapshot.path.includes('broken')?{status:'fail' as const,checks:{fixture:{passed:false}},limitations:[]}:evidence(snapshot.path.includes('repair')?120:110);
 },stop:async()=>{}};
 const state=await runResearch(root,config,deps,new AbortController().signal);
 assert.equal(state.status,'completed',state.error??'');assert.equal(state.best,'repair');assert.equal(decisions,3);assert.equal(workers,3);assert.equal(verifications,3);
 assert.equal(state.candidates[1]!.status,'rejected');assert.equal(state.candidates[2]!.evidence!.metrics!.fitness,120);
});

test('missing, tampered, unsafe or conflicting selected snapshots block decision calls and preserve diagnostics',async()=>{
 for(const fault of ['missing','tampered','duplicate-id','hypothesis-id','path','symlink','unsafe','unverified','parent-missing','parent-tampered','parent-conflict']){
  const f=await fixture(),best=await f.candidate('best',fastRtl);f.ctx.records.push(best);f.ctx.best='best';
  const parent=await f.candidate('parent',brokenRtl);parent.status='rejected';parent.evidence={status:'fail',checks:{},limitations:[]};f.ctx.records.push(parent);
  if(fault.startsWith('parent-')){best.hypothesis.parent='parent';best.round=2;}
  if(fault==='missing')await rm(best.snapshot!.path);
  if(fault==='tampered')await writeFile(best.snapshot!.path,'tampered');
  if(fault==='duplicate-id')f.ctx.records.push({...best});
  if(fault==='hypothesis-id')best.hypothesis.id='other';
  if(fault==='path')best.snapshot={...parent.snapshot!};
  if(fault==='symlink'){await rename(join(f.root,'best'),join(f.root,'saved-best'));await symlink(join(f.root,'parent'),join(f.root,'best'),'junction');}
  if(fault==='unsafe'){const bytes=tarGz([{name:'../core.sv'}]);await writeFile(best.snapshot!.path,bytes);best.snapshot!.sha256=hash(bytes);}
  if(fault==='unverified'){best.status='rejected';best.evidence!.status='fail';best.worker={status:'completed',durationMs:1,usage:[],report:'I certify this candidate'};}
  if(fault==='parent-missing')await rm(parent.snapshot!.path);
  if(fault==='parent-tampered')await writeFile(parent.snapshot!.path,'tampered');
  if(fault==='parent-conflict')parent.hypothesis.id='other';
  const m=manager(f.root,()=>{throw Error('must not dispatch');}),dir=join(f.root,'round-2-0');await mkdir(dir);
  await assert.rejects(m.deps.decide(f.ctx,dir,new AbortController().signal));assert.equal(m.calls(),0,fault);
  const diagnostic=JSON.parse(await readFile(join(dir,'manager-context-error.json'),'utf8'));assert.equal(diagnostic.status,'error');assert.equal(diagnostic.best,'best');
 }
});

test('context failure follows existing research infrastructure error handling without spending another worker',async()=>{
 const f=await fixture(),run=join(f.root,'run');let decisions=0,workers=0;
 const m=manager(run,()=>{decisions++;return finish;});
 const state=await runResearch(run,config,{...m.deps,baseline:async dir=>{
  await mkdir(dir);const path=join(dir,'rtl.tar.gz');await writeFile(path,'tampered');return {...f.ctx.records[0]!,snapshot:{path,sha256:'wrong'}};
 },work:async()=>{workers++;return {};},stop:async()=>{}},new AbortController().signal);
 assert.equal(state.status,'error');assert.match(state.error!,/hash mismatch/);assert.equal(decisions,0);assert.equal(workers,0);assert.equal(state.history.length,0);
 assert.equal(JSON.parse(await readFile(join(run,'state.json'),'utf8')).status,'error');assert.match(await readFile(join(run,'events.jsonl'),'utf8'),/"type":"ended"/);
});

test('new manager runtime dependencies remain in the existing implementation snapshot list',async()=>{
 const source=await readFile(resolve('src/hwe.ts'),'utf8');assert.match(source,/'hwe-manager-context','hwe-archive'/);assert.match(source,/'bridge.py','manager_context.py'/);
});
