import {z} from 'zod';

const text=z.string().min(1).max(6000);
export const HypothesisSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),parent:z.string(),claim:text,experiment:text,expected:text,workerSeconds:z.number().int().min(30).max(1800)}).strict();
export const ResearchDecisionSchema=z.object({action:z.enum(['experiment','finish']),reason:text,hypotheses:z.array(HypothesisSchema).max(4),discard:z.array(z.string()).max(100)}).strict();
export type ResearchDecision=z.infer<typeof ResearchDecisionSchema>;
export type Hypothesis=z.infer<typeof HypothesisSchema>;
export type Metrics=Record<string,number>;
export interface Evidence<M extends Metrics=Metrics> {status:'pass'|'fail'|'error'|'timeout';checks:Record<string,unknown>;metrics?:M;detail?:string;limitations:string[];infrastructureError?:boolean}
export interface Candidate<M extends Metrics=Metrics> {id:string;round:number;hypothesis:Hypothesis;status:'working'|'verifying'|'verified'|'rejected'|'error'|'interrupted';snapshot?:{path:string;sha256:string};worker?:{status:string;usage:unknown;sessionId?:string;durationMs:number;report?:string;detail?:string};evidence?:Evidence<M>;discarded?:boolean}
export interface ResearchConfig {goal:string;maxRounds:number;maxWorkers:number;concurrency:number;totalMs:number;manager:{model:string;effort:string;timeoutSeconds?:number};worker:{model:string;effort:string}}
const selection=z.object({model:z.string().min(1),effort:z.string().min(1)}).strict();
export const ResearchConfigSchema=z.object({goal:text,maxRounds:z.number().int().min(1).max(20),maxWorkers:z.number().int().min(1).max(40),concurrency:z.number().int().min(1).max(4),totalMs:z.number().int().min(1000).max(28800000),manager:selection.extend({timeoutSeconds:z.number().int().min(30).max(1800).optional()}),worker:selection}).strict();
export interface ResearchState<M extends Metrics=Metrics> {version:1;status:'running'|'completed'|'cancelled'|'interrupted'|'error'|'budget';config:ResearchConfig;startedAt:string;checkpointAt?:string;endedAt?:string;round:number;spentMs:number;best:string;baseline:Candidate<M>;history:{round:number;decision:ResearchDecision}[];candidates:Candidate<M>[];error?:string}
export interface ResearchContext<M extends Metrics=Metrics> {goal:string;round:number;remainingWorkers:number;remainingMs:number;best:string;records:Candidate<M>[];decisions:ResearchState<M>['history']}
export interface ResearchDeps<M extends Metrics=Metrics> {
 baseline:(dir:string,signal:AbortSignal)=>Promise<Candidate<M>>;
 decide:(context:ResearchContext<M>,dir:string,signal:AbortSignal)=>Promise<ResearchDecision>;
 work:(hypothesis:Hypothesis,parent:Candidate<M>,dir:string,signal:AbortSignal)=>Promise<Pick<Candidate<M>,'snapshot'|'worker'>>;
 verify:(snapshot:NonNullable<Candidate<M>['snapshot']>,dir:string,signal:AbortSignal)=>Promise<Evidence<M>>;
 stop:()=>Promise<void>;
}
/** Installed host policy; a Manager response cannot replace these rules. */
export interface QualityPolicy<M extends Metrics> {
 id:string;
 validMetrics:(metrics:M|undefined)=>boolean;
 better:(candidate:M,current:M)=>boolean;
 hasInfrastructureError?:(evidence:Evidence<M>|undefined)=>boolean;
}
