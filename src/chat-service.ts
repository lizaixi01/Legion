import {realpath,stat} from 'node:fs/promises';
import {managedChatWorker} from './managed-chat.js';
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexWorker } from './codex.js';
import {isMinimalAgentMessage,minimalAgentWorker} from './minimal-agent.js';
import type { WorkerRequest, WorkerResult } from './types.js';
import {defaultChatOptions,validateChatOptions,type ChatOptions} from './chat-options.js';

interface Message { role: 'user' | 'assistant'; text: string }
interface Chat { id: string; title: string; updatedAt: string; status: string; messages: Message[]; sessionId?: string; error?: string; options?:ChatOptions;managementDir?:string;project?:string;pinned?:boolean;acceptance?:WorkerResult['acceptance'] }
type Worker = (request: WorkerRequest) => Promise<WorkerResult>;
export function createChatService(root: string, worker?: Worker) {
  const base=join(root,'.chats');
  const command=join(root,'.local/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  let active: {chat:Chat; controller:AbortController; dir:string; done?:Promise<void>}|undefined;
  const deletingChats=new Set<string>();
  function dir(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效的对话');return join(base,id);}
  async function save(chat:Chat){const target=join(dir(chat.id),'chat.json');await writeFile(target+'.tmp',JSON.stringify(chat));await rename(target+'.tmp',target);}
  async function load(id:string):Promise<Chat>{return JSON.parse(await readFile(join(dir(id),'chat.json'),'utf8')) as Chat;}
  async function output(path:string){
    try {const lines=(await readFile(join(path,'stdout.jsonl'),'utf8')).split('\n');const messages:string[]=[];let draft='',activity='正在思考';
      for(const line of lines){try{const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='agent_message'){messages.push(e.item.text);draft='';}else if(e.type==='agent_message_delta')draft+=e.delta;if(e.item?.type==='command_execution')activity=e.type==='item.completed'?'正在整理结果':'正在执行命令';}catch{/* A live final line may be incomplete. */}}
      return {text:messages.length?messages.join('\n\n'):draft,activity};
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {text:'',activity:'正在连接'};throw error;}
  }
  async function detail(id:string){const chat=active?.chat.id===id?structuredClone(active.chat):await load(id);if(chat.status==='running'&&active?.chat.id!==id){chat.status='interrupted';chat.error='上次运行已中断，请重新发送消息。';}const live=active?.chat.id===id?await output(active.dir):undefined;let management;try{if(chat.managementDir)management=JSON.parse(await readFile(join(dir(id),'turns',chat.managementDir,'management.json'),'utf8'));}catch{}return {...chat,live,management};}
  async function list(){await mkdir(base,{recursive:true});const entries=await readdir(base,{withFileTypes:true});const chats=await Promise.all(entries.filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)).map(async e=>{try{const c=active?.chat.id===e.name?active.chat:await load(e.name);return {id:c.id,title:c.title,project:c.project,pinned:Boolean(c.pinned),updatedAt:c.updatedAt,status:c.status==='running'&&active?.chat.id!==c.id?'interrupted':c.status};}catch{return null;}}));return chats.filter(c=>c!==null).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));}
  async function setPinned(id:string,pinned:boolean){if(typeof pinned!=='boolean')throw Error('置顶状态无效');if(deletingChats.has(id))throw Error('对话正在删除');const chat=active?.chat.id===id?active.chat:await load(id);chat.pinned=pinned;await save(chat);return {id,pinned};}
  async function deleteChat(id:string){const target=dir(id);if(active?.chat.id===id)throw Error('当前对话正在运行，请停止后再删除');if(deletingChats.has(id))throw Error('对话正在删除');deletingChats.add(id);try{if(active?.chat.id===id)throw Error('当前对话正在运行，请停止后再删除');await rm(target,{recursive:true});return {id};}finally{deletingChats.delete(id);}}
  async function archiveProject(projectPath:string){if(typeof projectPath!=='string'||!projectPath.trim())throw Error('项目路径无效');const project=await realpath(projectPath);if(!(await stat(project)).isDirectory())throw Error('项目目录不可用');await mkdir(base,{recursive:true});const projectKey=resolve(project).toLocaleLowerCase(),entries=await readdir(base,{withFileTypes:true}),chats=await Promise.all(entries.filter(entry=>entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name)).map(async entry=>{try{return await load(entry.name);}catch{return null;}})),matches=chats.filter((chat):chat is Chat=>Boolean(chat?.project&&resolve(chat.project).toLocaleLowerCase()===projectKey));if(active?.chat.project&&resolve(active.chat.project).toLocaleLowerCase()===projectKey)throw Error('该项目有正在运行的对话，请停止后再归档');const ids=matches.map(chat=>chat.id);if(ids.some(id=>deletingChats.has(id)))throw Error('项目对话正在删除');for(const id of ids)deletingChats.add(id);try{if(active?.chat.project&&resolve(active.chat.project).toLocaleLowerCase()===projectKey)throw Error('该项目有正在运行的对话，请停止后再归档');const outcomes=await Promise.allSettled(ids.map(id=>rm(dir(id),{recursive:true}))),failed=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');if(failed)throw failed.reason;return {project,deleted:ids};}finally{for(const id of ids)deletingChats.delete(id);}}
  async function send(input:{id?:string;text:string;options?:ChatOptions;project?:string}) {
    if(active)throw Error('请等待当前回复完成，或先停止。');
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)throw Error('请输入有效消息');
    const chat:Chat=input.id?await load(input.id):{id:randomUUID(),title:input.text.trim().slice(0,32),updatedAt:'',status:'idle',messages:[]};
    const options=await validateChatOptions(input.options??chat.options??defaultChatOptions);
    if(input.project){const project=await realpath(input.project);if(!(await stat(project)).isDirectory())throw Error('请选择项目目录');if(chat.project&&chat.project!==project)throw Error('请新建对话来切换项目');if(!chat.project&&chat.messages.length)throw Error('请新建对话来选择项目');chat.project=project;}
    const workspace=chat.project??join(dir(chat.id),'workspace');
    if(chat.project&&!(await stat(chat.project)).isDirectory())throw Error('项目目录不可用');
    let priorManagement;try{if(chat.managementDir)priorManagement=JSON.parse(await readFile(join(dir(chat.id),'turns',chat.managementDir,'management.json'),'utf8'));}catch{}
    const minimal=isMinimalAgentMessage(input.text);
    const managed=!minimal&&!worker;
    const runWorker=worker??(minimal?minimalAgentWorker(command,options.model):managed?managedChatWorker(root,options,[...chat.messages,...(priorManagement?[{role:'evidence',data:priorManagement}]:[])]):codexWorker(command,options.model,options.effort,{...options,agents:options.delegation?0:options.agents}));
    // Claim the execution slot before filesystem awaits can admit another send.
    if(deletingChats.has(chat.id))throw Error('对话正在删除');
    if(active)throw Error('请等待当前回复完成，或先停止。');
    const attempt=join(dir(chat.id),'turns',randomUUID());const record={chat,controller:new AbortController(),dir:attempt,done:undefined as Promise<void>|undefined};active=record;
    try{await mkdir(attempt,{recursive:true});await mkdir(join(dir(chat.id),'workspace'),{recursive:true});chat.options=options;if(managed){chat.managementDir=attempt.split(/[\\\\/]/).at(-1);delete chat.sessionId;}else delete chat.managementDir;await writeFile(join(attempt,'options.json'),JSON.stringify(options));chat.messages.push({role:'user',text:input.text.trim()});chat.updatedAt=new Date().toISOString();chat.status='running';delete chat.error;await save(chat);}catch(error){active=undefined;throw error;}
    record.done=(async()=>{try{
      const result=await runWorker({workspace,attemptDir:attempt,prompt:input.text.trim(),sessionId:chat.sessionId,timeoutMs:1800000,signal:record.controller.signal});
      chat.sessionId=result.sessionId??chat.sessionId;const reply=await output(attempt);
      if(reply.text)chat.messages.push({role:'assistant',text:reply.text});
      chat.status=result.status;chat.acceptance=result.acceptance??(minimal?{status:'not_applicable',uncovered:[],detail:'Conversation only'}:undefined);
      if(result.status!=='completed')chat.error=result.status==='cancelled'?'已停止':result.detail||'本次执行未完成';
      else if(!reply.text){chat.status='error';chat.error='执行结束，但没有收到回复。';}
    }catch(error){chat.status='error';chat.error=String(error);}finally{chat.updatedAt=new Date().toISOString();try{await save(chat);}finally{active=undefined;}}})();
    // Persist failures are observable to the renderer and must not become an unhandled rejection.
    void record.done.catch(error=>{chat.status='error';chat.error=String(error);});
    return {id:chat.id};
  }
  async function stop(){const current=active;current?.controller.abort();await current?.done;}
  return {list,detail,send,stop,setPinned,deleteChat,archiveProject,isActive:()=>Boolean(active)};
}

