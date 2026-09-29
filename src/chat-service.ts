import {projectFiles} from './engineering.js';
import {dirname} from 'node:path';
import {managedChatWorker} from './managed-chat.js';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexWorker } from './codex.js';
import type { WorkerRequest, WorkerResult } from './types.js';
import {defaultChatOptions,validateChatOptions,type ChatOptions} from './chat-options.js';

interface Message { role: 'user' | 'assistant'; text: string }
interface Chat { id: string; title: string; updatedAt: string; status: string; messages: Message[]; sessionId?: string; error?: string; options?:ChatOptions;managementDir?:string }
type Worker = (request: WorkerRequest) => Promise<WorkerResult>;
export function createChatService(root: string, worker?: Worker) {
  const base=join(root,'.chats');
  const command=join(root,'.local/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  let active: {chat:Chat; controller:AbortController; dir:string; done?:Promise<void>}|undefined;
  function dir(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效的对话');return join(base,id);}
  async function save(chat:Chat){const target=join(dir(chat.id),'chat.json');await writeFile(target+'.tmp',JSON.stringify(chat));await rename(target+'.tmp',target);}
  async function load(id:string):Promise<Chat>{return JSON.parse(await readFile(join(dir(id),'chat.json'),'utf8')) as Chat;}
  async function output(path:string){
    try {const lines=(await readFile(join(path,'stdout.jsonl'),'utf8')).split('\n');const messages:string[]=[];let activity='正在思考';
      for(const line of lines){try{const e=JSON.parse(line);if(e.type==='item.completed' && e.item?.type==='agent_message')messages.push(e.item.text);if(e.item?.type==='command_execution')activity=e.type==='item.completed'?'正在整理结果':'正在执行命令';}catch{/* A live final line may be incomplete. */}}
      return {text:messages.join('\n\n'),activity};
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {text:'',activity:'正在连接'};throw error;}
  }
  async function detail(id:string){const chat=active?.chat.id===id?structuredClone(active.chat):await load(id);if(chat.status==='running'&&active?.chat.id!==id){chat.status='interrupted';chat.error='上次运行已中断，请重新发送消息。';}const live=active?.chat.id===id?await output(active.dir):undefined;let management;try{if(chat.managementDir)management=JSON.parse(await readFile(join(dir(id),'turns',chat.managementDir,'management.json'),'utf8'));}catch{}return {...chat,live,management};}
  async function list(){await mkdir(base,{recursive:true});const entries=await readdir(base,{withFileTypes:true});const chats=await Promise.all(entries.filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)).map(async e=>{try{const c=active?.chat.id===e.name?active.chat:await load(e.name);return {id:c.id,title:c.title,updatedAt:c.updatedAt,status:c.status==='running'&&active?.chat.id!==c.id?'interrupted':c.status};}catch{return null;}}));return chats.filter(c=>c!==null).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  async function send(input:{id?:string;text:string;options?:ChatOptions;project?:string}) {
    if(active)throw Error('请等待当前回复完成，或先停止。');
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)throw Error('请输入有效消息');
    const chat:Chat=input.id?await load(input.id):{id:randomUUID(),title:input.text.trim().slice(0,32),updatedAt:'',status:'idle',messages:[]};
    const options=await validateChatOptions(input.options??chat.options??defaultChatOptions);
    let priorManagement;try{if(chat.managementDir)priorManagement=JSON.parse(await readFile(join(dir(chat.id),'turns',chat.managementDir,'management.json'),'utf8'));}catch{}
    const managed=options.delegation&&options.delegation.mode!=='off';
    const runWorker=worker??(managed?managedChatWorker(root,options,[...chat.messages,...(priorManagement?[{role:'evidence',data:priorManagement}]:[])]):codexWorker(command,options.model,options.effort,{...options,agents:options.delegation?0:options.agents}));
    // Claim the execution slot before filesystem awaits can admit another send.
    if(active)throw Error('请等待当前回复完成，或先停止。');
    const attempt=join(dir(chat.id),'turns',randomUUID());const record={chat,controller:new AbortController(),dir:attempt,done:undefined as Promise<void>|undefined};active=record;
    try{await mkdir(attempt,{recursive:true});await mkdir(join(dir(chat.id),'workspace'),{recursive:true});if(input.project&&!chat.messages.length){const files=await projectFiles(input.project);for(const [file,text] of Object.entries(files)){const target=join(dir(chat.id),'workspace',file);await mkdir(dirname(target),{recursive:true});await writeFile(target,text);}}chat.options=options;if(managed){chat.managementDir=attempt.split(/[\\\\/]/).at(-1);delete chat.sessionId;}else delete chat.managementDir;await writeFile(join(attempt,'options.json'),JSON.stringify(options));chat.messages.push({role:'user',text:input.text.trim()});chat.updatedAt=new Date().toISOString();chat.status='running';delete chat.error;await save(chat);}catch(error){active=undefined;throw error;}
    record.done=(async()=>{try{
      const result=await runWorker({workspace:join(dir(chat.id),'workspace'),attemptDir:attempt,prompt:input.text.trim(),sessionId:chat.sessionId,timeoutMs:1800000,signal:record.controller.signal});
      chat.sessionId=result.sessionId??chat.sessionId;const reply=await output(attempt);
      if(reply.text)chat.messages.push({role:'assistant',text:reply.text});
      chat.status=result.status;
      if(result.status!=='completed')chat.error=result.status==='cancelled'?'已停止':result.detail||'本次执行未完成';
      else if(!reply.text){chat.status='error';chat.error='执行结束，但没有收到回复。';}
    }catch(error){chat.status='error';chat.error=String(error);}finally{chat.updatedAt=new Date().toISOString();try{await save(chat);}finally{active=undefined;}}})();
    // Persist failures are observable to the renderer and must not become an unhandled rejection.
    void record.done.catch(error=>{chat.status='error';chat.error=String(error);});
    return {id:chat.id};
  }
  async function stop(){const current=active;current?.controller.abort();await current?.done;}
  return {list,detail,send,stop,isActive:()=>Boolean(active)};
}

