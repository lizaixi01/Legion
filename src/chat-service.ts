import {createGoalBudget,readGoalBudget} from './primary-goal-budget.js';
import {codexRuntime} from './codex-runtime.js';
import {readDecisionHistory} from './primary-decision-history.js';
import {realpath,stat} from 'node:fs/promises';
import {primaryAgentWorker} from './primary-agent.js';
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {createChatOutput} from './chat-output.js';


import type { WorkerRequest, WorkerResult } from './types.js';
import {defaultChatOptions,validateChatOptions,type ChatOptions} from './chat-options.js';

interface Message { role: 'user' | 'assistant'; text: string }
interface Chat {continuousGoal?:{objective:string;deadline:number;budgetId?:string};nativeGoal?:import('./native-goal.js').NativeGoal;lastDeliveryTurn?:string;reviewTurn?:string; transport?:string; id: string; title: string; updatedAt: string; status: string; messages: Message[]; sessionId?: string; error?: string; options?:ChatOptions;managementDir?:string;project?:string;pinned?:boolean;acceptance?:WorkerResult['acceptance'] }
type Worker = (request: WorkerRequest) => Promise<WorkerResult>;
export function createChatService(root: string, worker?: Worker) {
  const base=join(root,'.chats');
  const command=codexRuntime(root);
  let active: {chat:Chat; controller:AbortController; dir:string; done?:Promise<void>}|undefined;
  const deletingChats=new Set<string>();
  const changes=new Map<string,Promise<unknown>>();
  const mutate=<T>(id:string,fn:()=>Promise<T>)=>{const next=(changes.get(id)??Promise.resolve()).catch(()=>{}).then(fn);changes.set(id,next);void next.finally(()=>{if(changes.get(id)===next)changes.delete(id);}).catch(()=>{});return next;};
  const saves=new Map<string,Promise<void>>(),outputs=new Map<string,ReturnType<typeof createChatOutput>>();
  function dir(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效的对话');return join(base,id);}
  function save(chat:Chat){
    const target=join(dir(chat.id),'chat.json'),data=JSON.stringify(chat),temp=target+'.'+randomUUID()+'.tmp';
    const next=(saves.get(chat.id)??Promise.resolve()).catch(()=>{}).then(async()=>{try{await writeFile(temp,data,{flag:'wx'});await rename(temp,target);}finally{await rm(temp,{force:true});}});
    saves.set(chat.id,next);void next.finally(()=>{if(saves.get(chat.id)===next)saves.delete(chat.id);}).catch(()=>{});return next;
  }
  async function load(id:string):Promise<Chat>{return JSON.parse(await readFile(join(dir(id),'chat.json'),'utf8')) as Chat;}
  function output(path:string,includeText=true){let cursor=outputs.get(path);if(!cursor){cursor=createChatOutput(join(path,'stdout.jsonl'));outputs.set(path,cursor);}return cursor.read(includeText);}
  async function detail(id:string){const chat=active?.chat.id===id?structuredClone(active.chat):await load(id);if(chat.status==='running'&&active?.chat.id!==id){chat.status='interrupted';chat.error='上次运行已中断，请重新发送消息。';}const currentOutput=active?.chat.id===id?await output(active.dir,false):undefined;const live=currentOutput?{activity:currentOutput.activity,...(currentOutput.progress?{progress:currentOutput.progress}:{})}:undefined;let management;try{if(chat.managementDir)management=JSON.parse(await readFile(join(dir(id),'turns',chat.managementDir,'management.json'),'utf8'));}catch{}const tasks=[];try{for(const id of await readdir(join(dir(chat.id),'tasks'))){if(!/^[a-f0-9-]{36}$/.test(id))continue;try{const task=JSON.parse(await readFile(join(dir(chat.id),'tasks',id,'task.json'),'utf8'));if(task.status==='running'&&(chat.status!=='running'||task.ownerTurn!==chat.reviewTurn)){task.status='interrupted';if(Array.isArray(task.history))task.history=task.history.map((a:{status:string})=>a.status==='running'?{...a,status:'interrupted'}:a);}tasks.push(task);}catch{}}}catch{}let delivery;try{if(chat.reviewTurn&&/^[a-f0-9-]{36}$/.test(chat.reviewTurn))delivery=JSON.parse(await readFile(join(dir(chat.id),'turns',chat.reviewTurn,'delivery','delivery.json'),'utf8'));}catch{}const decisions=await readDecisionHistory(join(dir(chat.id),'turns'),chat.status==='running'?chat.reviewTurn:undefined);let goalBudget;const budgetId=chat.continuousGoal?.budgetId;if(budgetId&&/^[a-f0-9-]{36}$/.test(budgetId)){try{const b=await readGoalBudget(join(dir(chat.id),'goal-budgets',budgetId));goalBudget={workersUsed:b.workersUsed,workers:b.config.workers,checksUsed:b.checksUsed,checks:b.config.checks,inflight:Object.keys(b.inflight).length};}catch{goalBudget={error:'累计预算记录不可用，不能恢复派工'};}}return {...chat,live,management,tasks,delivery,decisions,goalBudget};}
  async function list(){await mkdir(base,{recursive:true});const entries=await readdir(base,{withFileTypes:true});const chats=await Promise.all(entries.filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)).map(async e=>{try{const c=active?.chat.id===e.name?active.chat:await load(e.name);return {id:c.id,title:c.title,project:c.project,pinned:Boolean(c.pinned),updatedAt:c.updatedAt,status:c.status==='running'&&active?.chat.id!==c.id?'interrupted':c.status};}catch{return null;}}));return chats.filter(c=>c!==null).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));}
  async function setPinnedImpl(id:string,pinned:boolean){if(typeof pinned!=='boolean')throw Error('置顶状态无效');if(deletingChats.has(id))throw Error('对话正在删除');const chat=active?.chat.id===id?active.chat:await load(id);chat.pinned=pinned;await save(chat);return {id,pinned};}
  async function deleteChat(id:string){const target=dir(id);if(active?.chat.id===id)throw Error('当前对话正在运行，请停止后再删除');if(deletingChats.has(id))throw Error('对话正在删除');deletingChats.add(id);try{if(active?.chat.id===id)throw Error('当前对话正在运行，请停止后再删除');await saves.get(id)?.catch(()=>{});await rm(target,{recursive:true});return {id};}finally{deletingChats.delete(id);}}
  async function archiveProject(projectPath:string){if(typeof projectPath!=='string'||!projectPath.trim())throw Error('项目路径无效');const project=await realpath(projectPath);if(!(await stat(project)).isDirectory())throw Error('项目目录不可用');await mkdir(base,{recursive:true});const projectKey=resolve(project).toLocaleLowerCase(),entries=await readdir(base,{withFileTypes:true}),chats=await Promise.all(entries.filter(entry=>entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name)).map(async entry=>{try{return await load(entry.name);}catch{return null;}})),matches=chats.filter((chat):chat is Chat=>Boolean(chat?.project&&resolve(chat.project).toLocaleLowerCase()===projectKey));if(active?.chat.project&&resolve(active.chat.project).toLocaleLowerCase()===projectKey)throw Error('该项目有正在运行的对话，请停止后再归档');const ids=matches.map(chat=>chat.id);if(ids.some(id=>deletingChats.has(id)))throw Error('项目对话正在删除');for(const id of ids)deletingChats.add(id);try{if(active?.chat.project&&resolve(active.chat.project).toLocaleLowerCase()===projectKey)throw Error('该项目有正在运行的对话，请停止后再归档');const outcomes=await Promise.allSettled(ids.map(id=>rm(dir(id),{recursive:true}))),failed=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');if(failed)throw failed.reason;return {project,deleted:ids};}finally{for(const id of ids)deletingChats.delete(id);}}
  async function sendImpl(input:{id?:string;text:string;options?:ChatOptions;project?:string;attachments?:string[];continuous?:boolean}) {
    if(active)throw Error('请等待当前回复完成，或先停止。');
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)throw Error('请输入有效消息');
    if(input.continuous!==undefined&&typeof input.continuous!=='boolean')throw Error('持续目标设置无效');
    const chat:Chat=input.id?await load(input.id):{id:randomUUID(),title:input.text.trim().slice(0,32),updatedAt:'',status:'idle',messages:[]};
    if(!worker&&chat.transport!=='app-server-primary-v10'&&chat.nativeGoal?.tokenBudget!=null)throw Error('该旧目标包含原生 Token 限额，当前无法保留其已用额度迁移。请保留此对话，另建对话开始新目标。');
    const options=await validateChatOptions(input.options??chat.options??defaultChatOptions);
    const attachments:string[]=[];
    if(input.attachments){if(!Array.isArray(input.attachments)||input.attachments.length>30)throw Error('附件数量无效');for(const value of input.attachments){if(typeof value!=='string')throw Error('附件路径无效');const file=await realpath(value),info=await stat(file);if(!info.isFile()&&!info.isDirectory())throw Error('附件不是文件或文件夹');attachments.push(file);}}
    const userText=input.text.trim()+(attachments.length?'\n\n附件（上下文资料，按需读取）：\n'+attachments.join('\n'):'');
    let newGoalBudget=false;
    if(input.continuous){if(!chat.continuousGoal||(chat.nativeGoal?.status==='complete'&&chat.status==='completed')){chat.continuousGoal={objective:userText,deadline:Date.now()+21600000,budgetId:randomUUID()};newGoalBudget=true;}if(!chat.continuousGoal.budgetId)throw Error('旧目标缺少累计预算记录，请新建对话开始目标');if(Date.now()>=chat.continuousGoal.deadline)throw Error('原持续目标已到截止时间，请新建目标');}
    const continuousGoal=input.continuous?chat.continuousGoal:undefined;
    const historyContext=!worker&&chat.transport!=='app-server-primary-v10'&&chat.messages.length?'Previous conversation, for context only:\n'+JSON.stringify(chat.messages)+'\n\n':'';
    if(input.project){const project=await realpath(input.project);if(!(await stat(project)).isDirectory())throw Error('请选择项目目录');if(chat.project&&chat.project!==project)throw Error('请新建对话来切换项目');if(!chat.project&&chat.messages.length)throw Error('请新建对话来选择项目');chat.project=project;}
    const workspace=chat.project??join(dir(chat.id),'workspace');
    if(chat.project&&!(await stat(chat.project)).isDirectory())throw Error('项目目录不可用');
    let previousDelivery:string|undefined;
    for(const turn of [chat.reviewTurn,chat.lastDeliveryTurn]){if(!turn||!/^[a-f0-9-]{36}$/.test(turn))continue;const file=join(dir(chat.id),'turns',turn,'delivery','delivery.json');try{const value=JSON.parse(await readFile(file,'utf8'));if(value.contract){previousDelivery=file;break;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){previousDelivery=file;break;}}}
    const runWorker=worker??primaryAgentWorker(root,command,options,join(dir(chat.id),'tasks'),async id=>{chat.sessionId=id;await save(chat);},previousDelivery,async goal=>{chat.nativeGoal=goal;await save(chat);});
    if(!worker&&chat.transport!=='app-server-primary-v10'){delete chat.sessionId;chat.transport='app-server-primary-v10';}
    // Claim the execution slot before filesystem awaits can admit another send.
    if(deletingChats.has(chat.id))throw Error('对话正在删除');
    if(active)throw Error('请等待当前回复完成，或先停止。');
    const attempt=join(dir(chat.id),'turns',randomUUID());const record={chat,controller:new AbortController(),dir:attempt,done:undefined as Promise<void>|undefined};active=record;
    try{await mkdir(attempt,{recursive:true});if(newGoalBudget&&continuousGoal?.budgetId)await createGoalBudget(join(dir(chat.id),'goal-budgets',continuousGoal.budgetId),{id:continuousGoal.budgetId,objective:continuousGoal.objective,deadline:continuousGoal.deadline,workers:64,checks:3});await mkdir(join(dir(chat.id),'workspace'),{recursive:true});chat.options=options;chat.reviewTurn=attempt.split(/[\\/]/).at(-1);delete chat.acceptance;delete chat.managementDir;await writeFile(join(attempt,'options.json'),JSON.stringify(options));chat.messages.push({role:'user',text:userText});chat.updatedAt=new Date().toISOString();chat.status='running';delete chat.error;await save(chat);}catch(error){active=undefined;throw error;}
    record.done=(async()=>{try{
      const result=await runWorker({workspace,attemptDir:attempt,prompt:historyContext+userText,sessionId:chat.sessionId,continuousGoal,timeoutMs:Math.min(21600000,continuousGoal?Math.max(1,continuousGoal.deadline-Date.now()):21600000),signal:record.controller.signal});
      chat.sessionId=result.sessionId??chat.sessionId;if(result.nativeGoal&&!chat.nativeGoal)chat.nativeGoal=result.nativeGoal;const reply=await output(attempt);
      if(reply.text)chat.messages.push({role:'assistant',text:reply.text});
      chat.status=result.status;chat.acceptance=result.acceptance;
      if(result.status!=='completed')chat.error=result.status==='cancelled'?'已停止':result.detail||'本次执行未完成';
      else if(!reply.text){chat.status='error';chat.error='执行结束，但没有收到回复。';}
    }catch(error){chat.status='error';chat.error=String(error);}finally{try{const delivery=JSON.parse(await readFile(join(attempt,'delivery','delivery.json'),'utf8'));if(delivery.contract)chat.lastDeliveryTurn=chat.reviewTurn;}catch{}chat.updatedAt=new Date().toISOString();try{await save(chat);}finally{outputs.delete(attempt);if(active===record)active=undefined;}}})();
    // Persist failures are observable to the renderer and must not become an unhandled rejection.
    void record.done.catch(error=>{chat.status='error';chat.error=String(error);});
    return {id:chat.id};
  }
  async function stop(){const current=active;current?.controller.abort();await current?.done;}
  const send=(input:Parameters<typeof sendImpl>[0])=>input?.id?mutate(input.id,()=>sendImpl(input)):sendImpl(input);
  const setPinned=(id:string,pinned:boolean)=>mutate(id,()=>setPinnedImpl(id,pinned));
  return {list,detail,send,stop,setPinned,deleteChat,archiveProject,isActive:()=>Boolean(active)};
}

