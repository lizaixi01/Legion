import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {ResearchState} from '../research-loop.js';
import {eligible} from '../research-loop.js';
export function activity(state:ResearchState){
 const points:{at:number;worker:number;verification:number}[]=[];
 for(const c of state.candidates)for(const [kind,t] of [['worker',c.workerTiming],['verification',c.verification]] as const){
  if(!t?.startedAt||!t.endedAt)continue;
  points.push({at:Date.parse(t.startedAt),worker:kind==='worker'?1:0,verification:kind==='verification'?1:0},{at:Date.parse(t.endedAt),worker:kind==='worker'?-1:0,verification:kind==='verification'?-1:0});
 }
 points.sort((a,b)=>a.at-b.at);let worker=0,verification=0,last=points[0]?.at??0,overlapMs=0,workerBusyMs=0,verificationBusyMs=0,maxWorkers=0,maxVerification=0;
 const segments=[];
 for(let i=0;i<points.length;){const at=points[i]!.at,ms=at-last;
  if(ms){segments.push({startedAt:new Date(last).toISOString(),endedAt:new Date(at).toISOString(),worker,verification});if(worker)workerBusyMs+=ms;if(verification)verificationBusyMs+=ms;if(worker&&verification)overlapMs+=ms;}
  while(i<points.length&&points[i]!.at===at){worker+=points[i]!.worker;verification+=points[i]!.verification;i++;}
  maxWorkers=Math.max(maxWorkers,worker);maxVerification=Math.max(maxVerification,verification);last=at;
 }
 const start=state.candidates.flatMap(c=>c.workerTiming?.startedAt?[Date.parse(c.workerTiming.startedAt)]:[]),end=state.candidates.flatMap(c=>c.verification?.endedAt?[Date.parse(c.verification.endedAt)]:[]);
 return {dispatchToLastVerificationMs:start.length&&end.length?Math.max(...end)-Math.min(...start):null,overlapMs,workerBusyMs,verificationBusyMs,maxWorkers,maxVerification,segments};
}
export function resourceSummary(rows:Record<string,unknown>[]){
 const usable=rows.filter(r=>!r.error),number=(s:unknown)=>Number.parseFloat(String(s??0));
 const bytes=(s:unknown)=>{const match=String(s).match(/^([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)/);return match?Number(match[1])*({B:1,KiB:1024,MiB:1024**2,GiB:1024**3,kB:1000,MB:1000**2,GB:1000**3}[match[2]!]??0):0;};
 const aggregate=usable.map(r=>{const stats=(r.stats??[]) as {CPUPerc?:string;MemUsage?:string}[],memory=(r.hostMemoryKiB??{}) as Record<string,string>;return {cpu:stats.reduce((n,s)=>n+number(s.CPUPerc),0),memory:stats.reduce((n,s)=>n+bytes(s.MemUsage),0),swap:(number(memory.SwapTotal)-number(memory.SwapFree))*1024,available:number(memory.MemAvailable)*1024,workers:number(r.activeWorkers),verifiers:number(r.activeVerifiers),oom:((r.containers??[]) as {state?:{OOMKilled?:boolean}}[]).filter(c=>c.state?.OOMKilled).length};});
 const peak=(key:keyof typeof aggregate[number])=>aggregate.length?Math.max(...aggregate.map(r=>r[key])):null;
 return {samples:rows.length,usableSamples:usable.length,errors:rows.filter(r=>r.error).length,maxSampledWorkers:peak('workers'),maxSampledVerifiers:peak('verifiers'),workerVerificationOverlapSamples:aggregate.filter(r=>r.workers&&r.verifiers).length,peakAggregateContainerCpuPercent:peak('cpu'),peakAggregateContainerMemoryBytes:peak('memory'),peakHostSwapUsedBytes:peak('swap'),minHostMemoryAvailableBytes:aggregate.length?Math.min(...aggregate.map(r=>r.available)):null,oomSamples:aggregate.reduce((n,r)=>n+r.oom,0),caveat:'Observed samples only; missed peaks and sampling errors remain possible. Host cumulative CPU counters and per-container raw stats are retained.'};
}
export async function analyzeSpeedRun(root:string){
 const state=JSON.parse(await readFile(join(root,'state.json'),'utf8')) as ResearchState;
 const events=(await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const calls:unknown[]=[];
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='implementation')continue;const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.name.endsWith('.diagnostic.json'))calls.push(JSON.parse(await readFile(path,'utf8')));}}
 await walk(root);
 const resources=await readFile(join(root,'resources.jsonl'),'utf8').then(s=>s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))).catch(()=>[]);
 const curve=[{at:state.startedAt,id:'baseline',fitness:state.baseline.evidence?.metrics?.fitness??null}];let best=state.baseline.evidence?.metrics?.fitness??0;
 for(const e of events)if(e.type==='verified'&&eligible(e.data)&&e.data.evidence.metrics.fitness>best){best=e.data.evidence.metrics.fitness;curve.push({at:e.at,id:e.data.id,fitness:best});}
 return {root,status:state.status,resumed:state.resumed??false,complete:!state.resumed&&state.status==='budget'&&state.candidates.length===state.config.maxWorkers&&state.candidates.every(c=>['verified','rejected'].includes(c.status))&&state.cleanup?.status==='completed'&&!state.persistenceErrors?.length,
  counts:{passed:state.candidates.filter(eligible).length,rejected:state.candidates.filter(c=>c.evidence?.status==='fail').length,modelFailed:state.candidates.filter(c=>c.failureKind==='model').length,infrastructureFailed:state.candidates.filter(c=>c.failureKind==='infrastructure'||c.evidence?.infrastructureError).length,unfinished:state.candidates.filter(c=>!['verified','rejected'].includes(c.status)).length,workerTimeouts:state.candidates.filter(c=>c.worker?.status==='timeout').length},
  activity:activity(state),bestOverTime:curve,resourceSummary:resourceSummary(resources),config:state.config,cleanup:state.cleanup,persistenceErrors:state.persistenceErrors??[],error:state.error??null,
  tasks:state.candidates.map(c=>({id:c.id,status:c.status,failureKind:c.failureKind??null,snapshot:c.snapshot,workerTiming:c.workerTiming,verification:c.verification,workerStatus:c.worker?.status,metrics:c.evidence?.metrics??null,checks:c.evidence?.checks})),calls,resources,
  limitations:['Slot activity includes startup/export/hash/persistence; Docker samples record actual containers separately.','Overlapping durations are not group wall time.','A resumed or incomplete run is excluded from fair paired timing.','Generated snapshots need not be identical. Different validation workloads must be explained before attributing time to scheduling.']};
}
