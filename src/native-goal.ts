import {z} from 'zod';

export const NativeGoalSchema=z.object({threadId:z.string(),objective:z.string(),status:z.enum(['active','paused','blocked','usageLimited','budgetLimited','complete']),tokenBudget:z.number().nullable().optional(),tokensUsed:z.number(),timeUsedSeconds:z.number(),createdAt:z.number(),updatedAt:z.number()});
export type NativeGoal=z.infer<typeof NativeGoalSchema>;
type Terminal={params?:{turn?:{id?:string;status?:string;error?:{message?:string}}}};

/** Native Codex owns continuation; this adapter only observes and controls lifecycle. */
export function nativeGoalLifecycle(threadId:()=>string,rpc:(method:string,params:unknown)=>Promise<unknown>,persist:(goal:NativeGoal)=>Promise<void>,finish:(terminal:Terminal)=>void,fail:(error:Error)=>void){
 let goal:NativeGoal|undefined,ready=false,terminal:Terminal|undefined,closed=false,objective:string|undefined,revision=0;
 const running=new Set<string>(),finished=new Set<string>();let writes=Promise.resolve(),closing:Promise<void>|undefined,mutations:Promise<unknown>=Promise.resolve(),activationUnconfirmed=false;
 const serialize=<T>(action:()=>Promise<T>)=>{const next=mutations.then(action);mutations=next.catch(()=>{});return next;};
 const settle=()=>{if(!closed&&ready&&terminal&&!running.size&&goal&&goal.status!=='active'){closed=true;void writes.then(()=>finish(terminal!),fail);}};
 const observe=(raw:unknown)=>{
  const next=NativeGoalSchema.parse(raw);if(next.threadId!==threadId())return;
  if(objective!==undefined&&next.objective!==objective)throw Error('Native goal objective changed; original requirements must be preserved');
  goal=next;revision++;writes=writes.then(()=>persist(structuredClone(next)));void writes.catch(error=>fail(error instanceof Error?error:Error(String(error))));settle();
 };
 const refresh=async()=>{const before=revision;const response=await rpc('thread/goal/get',{threadId:threadId()}) as {goal?:unknown};if(before!==revision)return;if(!response.goal)throw Error('Native goal disappeared; continuation cannot be confirmed');observe(response.goal);};
 const set=async(params:unknown)=>{const before=revision;const response=await rpc('thread/goal/set',params) as {goal:unknown};if(before===revision)observe(response.goal);};
 return {
  prepare:(value:string)=>serialize(async()=>{if(closed)throw Error('Goal preparation cancelled');objective=value;await set({threadId:threadId(),objective:value,status:'paused'});await writes;}),
  activate:()=>serialize(async()=>{if(closed)throw Error('Goal activation cancelled');await refresh();if(closed)throw Error('Goal activation cancelled');if(goal?.status==='paused'){activationUnconfirmed=true;await set({threadId:threadId(),status:'active'});activationUnconfirmed=false;}if(closed)throw Error('Goal activation cancelled');ready=true;settle();}),
  started:(id:string)=>{if(finished.has(id))return;running.add(id);terminal=undefined;},
  completed:(message:Terminal)=>{const id=message.params?.turn?.id;if(id){running.delete(id);finished.add(id);}terminal=message;if(message.params?.turn?.status!=='completed'){closed=true;void writes.then(()=>finish(message),fail);return;}void refresh().catch(error=>fail(error instanceof Error?error:Error(String(error))));},
  observe,
  snapshot:()=>goal?structuredClone(goal):undefined,
  close:()=>{closed=true;return closing??=serialize(async()=>{if(goal?.status==='active'||activationUnconfirmed){await set({threadId:threadId(),status:'paused'});activationUnconfirmed=false;}await writes;});},
 };
}
