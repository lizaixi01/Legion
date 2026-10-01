import type {HweEvidence as Evidence} from './hwe-quality.js';

type Status=Evidence['status'];
interface Outcome {name:string;status:Status;tool_statuses:string[];preunsat:boolean;[key:string]:unknown}
interface Classification {status:Status;outcomes:Outcome[];diagnostics:string[];infrastructure_error:boolean}
const statuses=new Set(['pass','fail','error','timeout']);
const record=(v:unknown):Record<string,unknown>|undefined=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const aggregate=(s:Status[]):Status=>s.includes('fail')?'fail':s.includes('error')?'error':s.includes('timeout')?'timeout':'pass';
function taskStatus(o:Outcome):Status {
 const t=o.tool_statuses;
 return t.includes('FAIL')||o.property_failed===true?'fail':o.preunsat===true&&o.name.endsWith('_ch1')&&t.includes('ERROR')?'pass':t.includes('ERROR')||t.includes('UNKNOWN')?'error':t.includes('TIMEOUT')||o.status==='timeout'?'timeout':t.includes('PASS')?'pass':'error';
}
const taskError=(o:Outcome)=>o.status==='error'||o.tool_statuses.includes('UNKNOWN')||o.tool_statuses.includes('ERROR')&&!(o.preunsat===true&&o.name.endsWith('_ch1')&&o.status==='pass');

/** Exact SBY terminal records for one task, never a whole-log ERROR substring. */
function logOutcome(name:string,log:string):Outcome {
 const tool_statuses:string[]=[];let preunsat=false,assertion=false;
 for(const line of log.split('\n')){
  const m=/^SBY\s+\d+:\d+:\d+ \[([^\]]+)\] (.*)$/.exec(line.replace(/\r$/,''));
  if(!m||m[1]!==name)continue;
  const body=m[2]!;
  const terminal=/^DONE \((PASS|FAIL|ERROR|UNKNOWN|TIMEOUT), rc=-?\d+\)/.exec(body)
   ??/^engine_\d+: Status returned by engine: (pass|FAIL|ERROR|UNKNOWN|TIMEOUT)$/.exec(body)
   ??/^summary: engine_\d+ \([^)]*\) returned (pass|FAIL|ERROR|UNKNOWN|TIMEOUT)$/.exec(body);
  if(terminal&&!tool_statuses.includes(terminal[1]!.toUpperCase()))tool_statuses.push(terminal[1]!.toUpperCase());
  if(/^engine_\d+: ##\s+\d+:\d+:\d+\s+Status: PREUNSAT$/.test(body))preunsat=true;
  if(/^engine_\d+: ##\s+\d+:\d+:\d+\s+Assert failed in /.test(body))assertion=true;
 }
 const o:Outcome={name,status:'error',tool_statuses,preunsat,property_failed:assertion};
 o.status=taskStatus(o);return o;
}
function classifyFormal(raw:unknown):Classification {
 const f=record(raw),outcomes:Outcome[]=[],diagnostics:string[]=[];
 if(!f)return {status:'error',outcomes,diagnostics:['Missing or malformed formal result'],infrastructure_error:true};
 const structured=record(f.classification);
 if(f.classification!==undefined){
  if(!structured||!Array.isArray(structured.outcomes)||!Array.isArray(structured.diagnostics))diagnostics.push('Malformed structured formal classification');
  else {
   for(const value of structured.outcomes){
    const o=record(value);
    if(!o||typeof o.name!=='string'||!Array.isArray(o.tool_statuses))diagnostics.push('Malformed formal task result');
    else {
     const tool_statuses=o.tool_statuses.filter((t):t is string=>typeof t==='string'&&['PASS','FAIL','ERROR','UNKNOWN','TIMEOUT'].includes(t));
     if(!statuses.has(String(o.status))||tool_statuses.length!==o.tool_statuses.length||typeof o.preunsat!=='boolean')diagnostics.push('Malformed formal task result');
     const value={...o,tool_statuses} as unknown as Outcome;value.status=taskStatus(value);
     if(value.status!==o.status)diagnostics.push(`Conflicting formal task status: ${o.name}`);outcomes.push(value);
    }
   }
   for(const d of structured.diagnostics)if(typeof d==='string')diagnostics.push(d);else diagnostics.push('Malformed formal diagnostic');
   if(new Set(outcomes.map(o=>o.name)).size!==outcomes.length)diagnostics.push('Duplicate formal task results');
   if(f.passed===true&&(outcomes.length!==f.checks_passed||outcomes.length<50||outcomes.some(o=>o.status!=='pass')))diagnostics.push('Formal PASS conflicts with required task results');
  }
 }else if(f.passed===true){
  // The pinned upstream API exposes only an aggregate on success; its >=50 floor is unchanged.
  if(!Number.isInteger(f.checks_passed)||Number(f.checks_passed)<50)diagnostics.push('Missing or incomplete formal PASS tally');
 }else if(f.passed===false){
  if(f.failed_check==='timeout')outcomes.push({name:'formal',status:'timeout',tool_statuses:[],preunsat:false});
  else if(typeof f.failed_check!=='string'||['setup','no_checks_generated','too_few_checks_generated','make_failed_during_execution','unknown'].includes(f.failed_check))diagnostics.push('Formal setup, execution or result-format error');
  else {
   const log=typeof f.detail==='string'?f.detail:'';
   const failed=/^Failed:\s+(.+)$/m.exec(log)?.[1]?.trim().split(/\s+/)??[f.failed_check];
   for(const name of new Set([f.failed_check,...failed])){
    const o=logOutcome(name,log);outcomes.push(o);
    if(!o.tool_statuses.length&&!o.property_failed)diagnostics.push(`Missing terminal formal result: ${name}`);
   }
   if(outcomes.every(o=>o.status==='pass'))diagnostics.push('Formal non-pass tally has no failing or interrupted task result');
  }
 }else diagnostics.push('Missing formal passed field');
 // Corrupt metadata must not erase a separately reported assertion FAIL in the original tail.
 if(f.classification!==undefined&&typeof f.failed_check==='string'&&typeof f.detail==='string'){
  const failure=logOutcome(f.failed_check,f.detail);
  if(failure.status==='fail'){
   const prior=outcomes.find(o=>o.name===failure.name);
   if(prior){prior.status='fail';prior.tool_statuses=[...new Set([...prior.tool_statuses,...failure.tool_statuses])];prior.property_failed=prior.property_failed||failure.property_failed;}
   else outcomes.push(failure);
  }
 }
 if(f.passed!==true&&f.passed!==false)diagnostics.push('Missing formal passed field');
 if(f.failed_check==='timeout'&&!outcomes.some(o=>o.status==='timeout'||o.status==='fail'||o.status==='error'))outcomes.push({name:'formal',status:'timeout',tool_statuses:[],preunsat:false});
 const uniqueDiagnostics=[...new Set(diagnostics)];
 const interrupted=f.failed_check==='timeout'&&!outcomes.some(taskError);
 const status=aggregate([...outcomes.map(o=>o.status),...(uniqueDiagnostics.length&&!interrupted?['error' as const]:[])]);
 return {status,outcomes,diagnostics:uniqueDiagnostics,infrastructure_error:uniqueDiagnostics.length>0||outcomes.some(o=>taskError(o)||o.status==='timeout')};
}

export function classifyHweEvidence(e:Evidence):Evidence {
 if(!record(e)||!record(e.checks))return {status:'error',checks:{unparsed_result:e},detail:'Verification result is malformed; correctness is undetermined.',limitations:[]};
 const checks={...e.checks},results:Status[]=[],notes:string[]=[];
 if(!statuses.has(e.status)){results.push('error');notes.push('Unknown verifier status');}
 // Early gate failures need not have later stages. An asserted PASS requires every gate.
 if(e.status==='pass')for(const name of ['lint','bench','build','cosim','formal','synthesis','fpga'])if(!record(checks[name])){results.push('error');notes.push(`Missing required check: ${name}`);}
 for(const name of ['lint','bench','build','synthesis']){
  const c=record(checks[name]);if(!c)continue;
  results.push(c.passed===true?'pass':c.passed===false?(name==='bench'?'error':'fail'):'error');
 }
 const cosim=record(checks.cosim),detail=record(cosim?.detail),fpga=record(checks.fpga);
 if(cosim){
  results.push(cosim.failed_elf==='none'||['error','malformed_marker','no_output'].includes(String(detail?.field))?'error':detail?.field==='timeout'?'timeout':cosim.passed===true?'pass':cosim.passed===false&&['divergence','crc_mismatch','oob_access','no_ebreak'].includes(String(detail?.field))?'fail':'error');
 }
 if(checks.formal!==undefined){
  const formal=classifyFormal(checks.formal);results.push(formal.status);
  if(formal.status!=='pass'||record(checks.formal)?.classification!==undefined)checks.formal={...record(checks.formal),classification:formal};
  notes.push(...formal.outcomes.filter(o=>o.status!=='pass').map(o=>`formal ${o.name}: ${o.status}`),...formal.diagnostics);
 }
 if(fpga){
  const reason=typeof fpga.reason==='string'?fpga.reason:'';
  results.push(reason.startsWith('coremark_harness_error:')||reason.startsWith('fpga_report_unparsed:')?'error':fpga.placement_failed===true||fpga.bench_failed===true?'fail':e.status==='pass'&&['fitness','fmax_mhz','lut4','cycles'].some(k=>typeof fpga[k]!=='number'||!Number.isFinite(fpga[k]))?'error':'pass');
 }
 if(e.status==='pass'&&(!e.metrics||Object.values(e.metrics).length!==4||[e.metrics.fitness,e.metrics.fmax_mhz,e.metrics.lut4,e.metrics.cycles].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0))){results.push('error');notes.push('Missing or invalid quality metrics');}
 // A top-level timeout/error also carries execution failures outside individual gates.
 if(e.status==='error'||e.status==='timeout')results.push(e.status);
 if(!results.length)results.push('error');
 if(e.status==='fail'&&aggregate(results)==='pass'){results.push('error');notes.push('Non-pass result has no confirmed check failure');}
 const status=aggregate(results);
 if(status==='fail'&&(e.status==='error'||e.status==='timeout'))checks.verifier_result={status:e.status,detail:e.detail};
 const summary=status==='fail'?'Confirmed check/property failure; see raw checks.':status==='error'?'Verification incomplete or tool/result-format error; correctness is undetermined.':status==='timeout'?'Verification timed out; correctness is undetermined.':'';
 const explanation=e.detail?.startsWith(summary)&&notes.every(n=>e.detail!.includes(n))?e.detail:[summary,...notes,e.detail].filter(Boolean).join(' ');
 return {...e,status,checks,detail:explanation};
}
