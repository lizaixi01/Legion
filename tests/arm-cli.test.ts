import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const project=process.cwd();
const tsx=join(project,'node_modules','tsx','dist','cli.mjs');
const cli=join(project,'src','research-cli.ts');
const config={goal:'fixture comparison',maxRounds:1,maxWorkers:1,concurrency:1,totalMs:10000,manager:{model:'test',effort:'high'},worker:{model:'test',effort:'medium'}};

/** Deterministic, model-free dependencies, selected by PROACTIVE_FIXTURE_MODE. */
const fixtureModule=`import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const evidence=fitness=>({status:'pass',checks:{formal:true},metrics:{fitness,fmax_mhz:100,lut4:1000,cycles:100},limitations:[]});
export function createDeps(root,config){
  const mode=process.env.PROACTIVE_FIXTURE_MODE;
  return {
    baseline:async dir=>{await mkdir(dir,{recursive:true});const path=join(dir,'rtl.tar.gz');await writeFile(path,'baseline');return {id:'baseline',round:0,hypothesis:{id:'baseline',parent:'',claim:'baseline',experiment:'verify',expected:'pass',workerSeconds:30},status:'verified',snapshot:{path,sha256:sha('baseline')},evidence:evidence(100)};},
    decide:async()=>({action:'finish',reason:'fixture',hypotheses:[],discard:[]}),
    work:async(_hypothesis,_parent,dir)=>{await mkdir(dir,{recursive:true});const path=join(dir,'rtl.tar.gz');await writeFile(path,'candidate');const status=mode==='infra'?'error':'completed';return {snapshot:{path,sha256:sha('candidate')},worker:{status,usage:[],durationMs:1,report:'fixture',detail:status==='error'?'usage-limit: fixture':undefined}};},
    verify:async()=>mode==='fail'?{status:'fail',checks:{cosim:{passed:false,detail:{field:'divergence'}}},limitations:[]}:evidence(110),
    stop:async()=>{},
  };
}`;

async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'arm-cli-'));
  const deps=join(dir,'fixture.mjs');await writeFile(deps,fixtureModule);
  const file=join(dir,'config.json');await writeFile(file,JSON.stringify(config));
  return {dir,deps,config:file};
}
function run(args:string[],mode:string,deps:string){
  return new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,[tsx,cli,...args],{cwd:project,env:{...process.env,PROACTIVE_ARM_DEPS:deps,PROACTIVE_FIXTURE_MODE:mode},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',b=>{out+=b.toString();});child.stderr.on('data',b=>{err+=b.toString();});
    child.once('error',reject);child.once('close',code=>resolve({code,out,err}));
  });
}
const cleanup=async(...dirs:string[])=>{for(const dir of dirs)await rm(dir,{recursive:true,force:true});};
const runRoot=(out:string)=>out.split(/\r?\n/).find(line=>line.trim().length>0)!;

test('ordinary CLI exits non-zero on an infrastructure failure and records it as error',async t=>{
  const f=await fixture();
  const r=await run(['ordinary',f.config],'infra',f.deps);
  const root=runRoot(r.out);
  t.after(()=>cleanup(root,f.dir));
  assert.equal(r.code,1,r.err||r.out);
  const summary=JSON.parse(await readFile(join(root,'summary.json'),'utf8'));
  assert.equal(summary.status,'error');
  assert.equal(summary.candidate.status,'error');
});

test('ordinary CLI exits zero when a correctness check fails, as a normal task result',async t=>{
  const f=await fixture();
  const r=await run(['ordinary',f.config],'fail',f.deps);
  const root=runRoot(r.out);
  t.after(()=>cleanup(root,f.dir));
  assert.equal(r.code,0,r.err||r.out);
  const summary=JSON.parse(await readFile(join(root,'summary.json'),'utf8'));
  assert.equal(summary.status,'completed');
  assert.equal(summary.candidate.status,'rejected');
  assert.equal(summary.eligible,false);
});

test('comparison queue never starts the management arm after an ordinary infrastructure failure',async t=>{
  const f=await fixture();
  const r=await run(['comparison',f.config],'infra',f.deps);
  const result=JSON.parse(r.out.trim()) as {phase:string;runs:{action:string;status:string;directory:string}[]};
  t.after(()=>cleanup(...result.runs.map(step=>step.directory),f.dir));
  assert.equal(r.code,1,r.err||r.out);
  assert.equal(result.phase,'needs-investigation');
  assert.deepEqual(result.runs.map(step=>step.action),['ordinary']);
  assert.equal(result.runs[0]!.status,'error');
});

test('comparison queue continues to the management arm when the ordinary arm only fails its checks',async t=>{
  const f=await fixture();
  const r=await run(['comparison',f.config],'fail',f.deps);
  const result=JSON.parse(r.out.trim()) as {phase:string;runs:{action:string;status:string;directory:string}[]};
  t.after(()=>cleanup(...result.runs.map(step=>step.directory),f.dir));
  assert.equal(r.code,0,r.err||r.out);
  assert.equal(result.phase,'completed');
  assert.deepEqual(result.runs.map(step=>step.action),['ordinary','run']);
  assert.equal(result.runs[1]!.status,'completed');
});
