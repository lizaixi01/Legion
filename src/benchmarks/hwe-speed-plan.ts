/** Fixed-plan experiment adapter; the product Manager policy is unchanged. */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {createHweDeps,hweWorkerPrompt} from '../hwe.js';
import {HypothesisSchema,type ResearchConfig,type ResearchDeps,type Candidate} from '../research-loop.js';
import {hash} from '../provenance.js';
export const speedAcceptance='Frozen HWE full lint/bench/build/ISS-CRC cosim/formal/synthesis/three-seed FPGA gates; finite positive fitness,fmax_mhz,lut4,cycles; strict fitness ranking, allocation-order ties. Existing ALTOPS/PREUNSAT and finite-workload limitations apply.';
export const SpeedPlanSchema=z.object({version:z.literal(1),mode:z.literal('fixed-plan-execution'),batchSize:z.literal(4),acceptance:z.literal(speedAcceptance),tasks:z.array(z.object({order:z.number().int().min(1),batch:z.number().int().min(1),hypothesis:HypothesisSchema,parentSha256:z.string().regex(/^[a-f0-9]{64}$/),prompt:z.string(),promptSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).length(12)}).strict();
export type SpeedPlan=z.infer<typeof SpeedPlanSchema>;
const ideas=[
 ['source-qualified-load-stall','Qualify load-use stalls with actual opcode source usage; preserve true dependencies.'],
 ['direct-branch-comparator','Separate branch equality comparison from the general arithmetic result path.'],
 ['shared-direction-shifter','Share left/right barrel shifting through bit reversal; preserve arithmetic fill.'],
 ['decoded-register-read','Predecode register read selection locally while preserving x0 and forwarding.'],
 ['shared-add-sub-path','Share arithmetic addition/subtraction hardware with explicit operand polarity.'],
 ['forward-select-depth','Reduce forwarding mux logic depth without changing dependency priority.'],
 ['early-immediate-selection','Simplify immediate selection while preserving all RV32IM encodings.'],
 ['divider-step-local','Explore a small divider step logic change; preserve full division corner cases.'],
 ['signed-multiply-sharing','Share signed/unsigned multiply operand preparation; preserve high-half semantics.'],
 ['store-data-select','Simplify store data forwarding selection without changing memory ordering.'],
 ['branch-operand-select','Simplify branch operand selection without changing flush or hazard behavior.'],
 ['result-mux-local','Reduce one local execution result selection path; preserve RVFI retirement data.'],
] as const;
export function makeSpeedPlan(config:ResearchConfig,parent:Candidate):SpeedPlan{
 return SpeedPlanSchema.parse({version:1,mode:'fixed-plan-execution',batchSize:4,acceptance:speedAcceptance,tasks:ideas.map(([id,claim],i)=>{
  const hypothesis={id,parent:'baseline',claim,experiment:'Implement only the stated local hypothesis starting from the pinned original baseline. Run lint once and necessary focused checks. No history implementation or other candidate is available. Save source and observed outcomes in REPORT.md; finish as soon as required work is complete.',expected:'Potential improvement in externally verified fitness; correctness gates and LUT4 tradeoff unchanged.',workerSeconds:300};
  const prompt=hweWorkerPrompt(hypothesis,parent,config);return {order:i+1,batch:Math.floor(i/4)+1,hypothesis,parentSha256:parent.snapshot!.sha256,prompt,promptSha256:hash(prompt)};
 })});
}
export function createSpeedPlanDeps(root:string,config:ResearchConfig,plan:SpeedPlan,host:ResearchDeps=createHweDeps(root,config)):ResearchDeps{
 plan=SpeedPlanSchema.parse(plan);
 if(config.allocationsPerRound!==4||config.maxWorkers!==12||config.maxRounds!==3||config.verificationConcurrency!==2||config.verificationScheduling!=='worker-ready'||![2,4].includes(config.concurrency))throw Error('Fixed speed plan requires 3 x 4 allocations, Worker 2/4, verification 2, worker-ready');
 const ids=new Set<string>();for(let i=0;i<12;i++){const t=plan.tasks[i]!;if(t.order!==i+1||t.batch!==Math.floor(i/4)+1||t.hypothesis.parent!=='baseline'||ids.has(t.hypothesis.id)||hash(t.prompt)!==t.promptSha256)throw Error('Invalid fixed task identity/order/prompt');ids.add(t.hypothesis.id);}
 return {...host,
  baseline:async(...args)=>{const c=await host.baseline(...args);if(plan.tasks.some(t=>t.parentSha256!==c.snapshot?.sha256))throw Error('Fixed parent differs from certification');await writeFile(join(root,'fixed-plan.json'),JSON.stringify(plan,null,2));return c;},
  decide:async(ctx,dir)=>{const tasks=plan.tasks.filter(t=>t.batch===ctx.round);if(tasks.length!==4||tasks.some(t=>ctx.records.some(c=>c.id===t.hypothesis.id)))throw Error('Fixed allocation already consumed or round missing');const decision={action:'experiment' as const,reason:'Frozen fixed-plan replay; zero Manager model calls; no adaptive branch selection.',hypotheses:tasks.map(t=>t.hypothesis),discard:[]};await writeFile(join(dir,'response.json'),JSON.stringify(decision,null,2));return decision;},
  work:async(h,parent,dir,signal)=>{const task=plan.tasks.find(t=>t.hypothesis.id===h.id);if(!task||parent.id!=='baseline'||parent.snapshot?.sha256!==task.parentSha256||hweWorkerPrompt(h,parent,config)!==task.prompt)throw Error('Frozen Worker task changed');const value=await host.work(h,parent,dir,signal);if(await readFile(join(dir,'prompt.txt'),'utf8')!==task.prompt)throw Error('Actual Worker prompt differs from frozen plan');return value;},
 };
}
