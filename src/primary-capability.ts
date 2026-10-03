import type {ChatOptions} from './chat-options.js';
import type {WorkerRequest} from './types.js';
import type {GoalBudget} from './primary-goal-budget.js';
import type {DispatchLink} from './primary-task-contract.js';

export interface PrimaryCapabilityContext {
 root:string;request:WorkerRequest;taskDirectory:string;deadline:number;options:ChatOptions;budget?:GoalBudget;
 tasks:{capacity:()=>{limit:number;active:number;remainingCalls:number;available:number;deadline:number};call:(name:string,args:unknown,link?:DispatchLink)=>Promise<unknown>};
}
/** A host-installed task capability; never supplied by model output. */
export interface PrimaryCapability {
 tools:{name:string;[key:string]:unknown}[];
 instructions:string;
 call:(name:string,args:unknown)=>Promise<unknown>;
 pending:()=>boolean;
 failures:()=>string[];
 finalize:()=>Promise<{status:'none'|'valid'|'stale';detail?:string}>;
 stopDispatch?:()=>Promise<void>;
 close:()=>Promise<void>;
}
export type PrimaryCapabilityFactory=(context:PrimaryCapabilityContext)=>PrimaryCapability|Promise<PrimaryCapability>;
export const emptyPrimaryCapability:PrimaryCapability={tools:[],instructions:'',call:async()=>{throw Error('Unknown capability tool');},pending:()=>false,failures:()=>[],finalize:async()=>({status:'none'}),close:async()=>{}};
