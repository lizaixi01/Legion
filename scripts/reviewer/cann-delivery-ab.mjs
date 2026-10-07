// One opt-in offline experiment. Reuses the existing worker and snapshot verifier.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,copyFile,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runWorker} from '../../src/worker-pool.ts';
import {snapshotOutputs,hashOutputs} from '../../src/challenge.ts';
import {deliveryAttemptOutcome} from './cann-delivery-status.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [destinationArg]=process.argv.slice(2);assert.ok(destinationArg,'Usage: node --import tsx scripts/reviewer/cann-delivery-ab.mjs NEW_PREPARED_DIRECTORY');
const destination=resolve(destinationArg);
const python='D:/Projects/CANN-AddRmsNormBias/.venv/Scripts/python.exe';
const command=join(root,'.local/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const conditions=await json(join(destination,'conditions.json'));
assert.equal(conditions.model,'gpt-6.1-sol');assert.equal(conditions.effort,'xhigh');
assert.equal(hash(await readFile(join(root,'scripts/reviewer/cann-delivery-ab.py'))),conditions.grading_source_sha256);
assert.equal(hash(await readFile(join(root,'scripts/reviewer/delivery-evidence/SKILL.md'))),conditions.skill_sha256);
assert.match(spawnSync(command,['--version'],{encoding:'utf8',windowsHide:true}).stdout,/0\.159\.2/);
await mkdir(join(destination,'runs')); // Fresh experiment only. No automatic restarts.
await save(join(destination,'control/runner-lock.json'),{sha256:hash(await readFile(fileURLToPath(import.meta.url))),worker_sha256:hash(await readFile(join(root,'src/worker-pool.ts'))),process_sha256:hash(await readFile(join(root,'src/process.ts'))),challenge_sha256:hash(await readFile(join(root,'src/challenge.ts'))),node:process.version,command,started_at:new Date().toISOString()});
const common=await readFile(join(destination,'control/common-prompt.txt'),'utf8');
const schema=join(destination,'control/output-schema.json');
const codexHome=process.env.CODEX_HOME??join(process.env.USERPROFILE,'.codex');

function grade(rid,path){
 const r=spawnSync(python,['-B',join(root,'scripts/reviewer/cann-delivery-ab.py'),'grade',destination,rid,path],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
async function findRollout(sid){
 const now=new Date();
 for(const delta of [0,-1,1]){
  const date=new Date(now.getTime()+delta*86400000),p=join(codexHome,'sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));
  for(const f of await readdir(p).catch(()=>[]))if(f.endsWith(sid+'.jsonl'))return join(p,f);
 }
}
function sessionUsage(text){
 let usage=null;const contexts=[];
 for(const line of text.split(/\r?\n/)){
  try{const e=JSON.parse(line),p=e.payload??{};if(e.type==='turn_context')contexts.push({model:p.model,effort:p.effort});if(p.type==='token_count'&&p.info?.total_token_usage)usage=p.info.total_token_usage;}catch{}
 }
 return {usage,contexts};
}
function transcriptAudit(events,arm){
 const commands=events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>({command:e.item.command,exit_code:e.item.exit_code,output:e.item.aggregated_output??''}));
 const skillReads=commands.filter(x=>/skill[/\\]SKILL\.md/i.test(x.command??'')&&x.exit_code===0&&/evidence chain around the requested candidate/i.test(x.output));
 const forbidden=commands.filter(x=>/cann-baseline-audit|cann-runs\.jsonl|[\\/]control[\\/]|[\\/]runs[\\/]|Invoke-WebRequest|curl\s|wget\s|eval_bridge\.py|cannjudge-submit/i.test(x.command??''));
 return {command_count:commands.length,commands,skill_read_confirmed:skillReads.length>0,skill_policy_pass:arm==='B'?skillReads.length>0:skillReads.length===0,forbidden_command_matches:forbidden.map(x=>x.command),scope_note:'Read-only sandbox plus bounded prompt. This audit is not an OS read allowlist; inspect all commands and rollout for scope violations.'};
}

const summaries=[];
for(const rid of conditions.order){
 const group=rid.slice(-1),pack=rid.slice(0,-2),workspace=join(destination,'workspaces',rid),runDir=join(destination,'runs',rid);
 await mkdir(runDir);
 const inv=await json(join(workspace,'inventory.json')),materialPaths=inv.files.map(f=>f.path);
 const before=await hashOutputs(workspace,materialPaths);
 const started=Date.now(),deadline=started+conditions.max_run_ms;
 let sessionId,rollout,usage=null,first=true,lastGrade,feedbackRounds=0,budgetReason=null;
 const attempts=[];let allEvents=[];
 const prompt=common+`\n目标归档：${pack==='complete-r03'?'adaptive-r03-input-prefetch-20261004':'iter1-cache8192-20261004'}。以本包材料为证据边界；原文件的未来结果不可自行补入。\n`+(group==='B'?'本次明确调用 $delivery-evidence：请先实际读取当前目录 skill/SKILL.md 并按其流程工作；读取成本计入预算。\n':'本次不加载目标 Skill，也不要读取任何 SKILL.md。\n');
 let nextPrompt=prompt;
 while(attempts.length<2&&Date.now()<deadline&&!budgetReason){
  const number=attempts.length+1,dir=join(runDir,`attempt-${number}`);await mkdir(dir);
  const delivery=join(dir,'delivery.json');await writeFile(join(dir,'prompt.txt'),nextPrompt,{flag:'wx'});
  const controller=new AbortController();let polling=false;
  const poll=async()=>{if(polling)return;polling=true;try{
   const log=await readFile(join(dir,'stdout.jsonl'),'utf8').catch(()=>'');
   for(const l of log.split(/\r?\n/)){try{const e=JSON.parse(l);if(e.type==='thread.started')sessionId=e.thread_id;}catch{}}
   if(sessionId&&!rollout)rollout=await findRollout(sessionId);
   if(rollout){const u=sessionUsage(await readFile(rollout,'utf8'));usage=u.usage??usage;}
   if(usage?.total_tokens>=conditions.max_input_output_tokens){budgetReason='token_budget';controller.abort();}
  }finally{polling=false;}};
  const timer=setInterval(()=>void poll().catch(()=>{}),500);
  let result;
  try{result=await runWorker({backend:'codex',command,prefix:['--disable','plugins'],model:conditions.model,effort:conditions.effort,permission:'read-only',schemaPath:schema,outputPath:delivery},
    {id:rid,prompt:nextPrompt,workspace,logDir:dir,timeoutMs:Math.max(1,deadline-Date.now()),...(first?{}:{sessionId})},controller.signal);
  }finally{clearInterval(timer);await poll();}
  sessionId=result.sessionId??sessionId;
  const raw=await readFile(join(dir,'stdout.jsonl'),'utf8');const events=[];
  for(const line of raw.split(/\r?\n/)){try{events.push(JSON.parse(line));}catch{}}
  allEvents.push(...events);
  if(sessionId&&!rollout)rollout=await findRollout(sessionId);
  if(rollout){const full=await readFile(rollout,'utf8');usage=sessionUsage(full).usage??usage;await writeFile(join(dir,'rollout.jsonl'),full,{flag:'wx'});}
  if(usage?.total_tokens>=conditions.max_input_output_tokens)budgetReason='token_budget';
  if(Date.now()>=deadline||result.status==='timeout')budgetReason??='wall_clock_budget';
  let frozen=null;
  if(await stat(delivery).catch(()=>null)){frozen=await snapshotOutputs(dir,['delivery.json'],join(dir,'frozen'));}
  lastGrade=grade(rid,delivery);await save(join(dir,'grade.json'),lastGrade);
  const outcome=deliveryAttemptOutcome({...result,sessionId},usage,conditions,Date.now()-started,number,lastGrade.qualified,!!frozen,budgetReason);
  usage=outcome.usage_cumulative;budgetReason=outcome.budget_stop;
  attempts.push({attempt:number,status:result.status,duration_ms:result.durationMs,session_id:sessionId??null,frozen_delivery_hash:frozen,grade:lastGrade,...outcome});
  await save(join(dir,'checkpoint.json'),attempts.at(-1));
  process.stdout.write(JSON.stringify({run:rid,attempt:number,status:result.status,qualified:outcome.qualified,content_qualified:lastGrade.qualified,budget_compliant:outcome.budget_compliant,delivery_completed:outcome.delivery_completed,fields:lastGrade.correct_fields??0,tokens:usage?.total_tokens??null,elapsed_ms:Date.now()-started})+'\n');
  if(!outcome.followup_allowed)break;
  feedbackRounds=1;
  nextPrompt='这是本次唯一一次标准化补交反馈。首次交付已经冻结。请仅利用同一材料包重查以下字段与问题代码，不访问新资料。保持同一输出 schema，返回一份完整补交；真实缺证仍应说明未知。此后不再反馈或重试。\n'+JSON.stringify(lastGrade.issues);
  await writeFile(join(runDir,'feedback.txt'),nextPrompt,{flag:'wx'});first=false;
 }
 const after=await hashOutputs(workspace,materialPaths);assert.equal(after,before,'Executor changed read-only materials');
 const audit=transcriptAudit(allEvents,group);await save(join(runDir,'trace-audit.json'),audit);
 const sum={run_id:rid,package_id:pack,group,session_id:sessionId??null,started_at:new Date(started).toISOString(),frozen_at:new Date().toISOString(),wall_clock_ms:Date.now()-started,usage,feedback_rounds:feedbackRounds,budget_stop:budgetReason,material_hash_before:before,material_hash_after:after,first_qualified:attempts[0]?.qualified??false,final_qualified:attempts.at(-1)?.qualified??false,first_content_qualified:attempts[0]?.content_qualified??false,final_content_qualified:attempts.at(-1)?.content_qualified??false,budget_compliant:attempts.at(-1)?.budget_compliant??null,delivery_completed:attempts.at(-1)?.delivery_completed??false,control_compliant:audit.skill_policy_pass&&!audit.forbidden_command_matches.length,attempts:attempts.map(a=>({attempt:a.attempt,status:a.status,correct_fields:a.grade.correct_fields??0,qualified:a.qualified,content_qualified:a.content_qualified,budget_compliant:a.budget_compliant,delivery_completed:a.delivery_completed,evidence_saved:a.evidence_saved,budget_stop:a.budget_stop,avoidable_missing:a.grade.avoidable_missing,incorrect_or_unsupported:a.grade.incorrect_or_unsupported,tokens_cumulative:a.usage_cumulative?.total_tokens??null,duration_ms:a.duration_ms})),skill_read_confirmed:audit.skill_read_confirmed};
 await save(join(runDir,'summary.json'),sum);summaries.push(sum);
 process.stdout.write(JSON.stringify({run:rid,frozen:true,first:sum.first_qualified,final:sum.final_qualified,tokens:usage?.total_tokens,controls:sum.control_compliant})+'\n');
 if(attempts.at(-1)?.stop_experiment)break; // Save the evidence, then make no further model call.
}
const integrity=spawnSync(python,['-B',join(root,'scripts/reviewer/cann-delivery-ab.py'),'integrity',destination],{encoding:'utf8',windowsHide:true});
assert.equal(integrity.status,0,integrity.stdout+integrity.stderr);
await save(join(destination,'integrity.json'),JSON.parse(integrity.stdout));
await save(join(destination,'results.json'),{conditions_path:join(destination,'conditions.json'),runs:summaries,stopped_after_first_round:true,all_planned_runs_attempted:summaries.length===conditions.order.length,stop_reason:summaries.at(-1)?.budget_stop??null});
process.stdout.write('FIRST_ROUND_FROZEN\n');
