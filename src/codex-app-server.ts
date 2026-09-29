import {spawn,type ChildProcess} from 'node:child_process';
import {appendFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import type {WorkerRequest,WorkerResult} from './types.js';

type RpcMessage={id?:number;method?:string;params?:any;result?:any;error?:{message?:string}};
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};

/** Runs a minimal chat turn through Codex app-server so final text can stream as it is generated. */
export async function codexAppServerWorker(command:string,model:string,request:WorkerRequest):Promise<WorkerResult>{
  const started=performance.now(),stdoutPath=join(request.attemptDir,'stdout.jsonl'),stderrPath=join(request.attemptDir,'stderr.log');
  const args=['app-server','--stdio','--disable','multi_agent','--disable','multi_agent_v2'];
  await Promise.all([writeFile(stdoutPath,''),writeFile(stderrPath,''),writeFile(join(request.attemptDir,'invocation.json'),JSON.stringify({command,args,cwd:request.workspace,model,transport:'codex-app-server'},null,2))]);
  const child:ChildProcess=spawn(command,args,{cwd:request.workspace,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,Pending>();let nextId=0,buffer='',closed=false,threadId='',turnId='',aborted=false,failed:Error|undefined;
  let logTail=Promise.resolve(),stderrTail=Promise.resolve();
  let finishTurn:(value:RpcMessage)=>void=()=>{};let failTurn:(error:Error)=>void=()=>{};
  const done=new Promise<RpcMessage>((resolve,reject)=>{finishTurn=resolve;failTurn=reject;});
  const finalItems=new Map<string,string>(),deltas=new Map<string,string>(),finalIds=new Set<string>();
  const appendEvent=(event:unknown)=>{logTail=logTail.then(()=>appendFile(stdoutPath,JSON.stringify(event)+'\n'));};
  const appendStderr=(chunk:Buffer|string)=>{stderrTail=stderrTail.then(()=>appendFile(stderrPath,chunk));};
  const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{
    if(closed){reject(failed??Error('Codex app-server 已退出'));return;}
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Codex app-server 请求超时：${method}`));},30000);
    pending.set(id,{resolve,reject,timer});
    child.stdin?.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
  const notify=(method:string,params?:unknown)=>child.stdin?.write(JSON.stringify(params===undefined?{method}:{method,params})+'\n');
  const lines=createInterface({input:child.stdout!,crlfDelay:Infinity});
  lines.on('line',line=>{
    let message:RpcMessage;try{message=JSON.parse(line);}catch{return;}
    if(message.id!==undefined){const wait=pending.get(message.id);if(wait){pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(Error(message.error.message??'Codex app-server 请求失败')):wait.resolve(message.result);}return;}
    if(!message.method)return;const params=message.params??{};
    if(message.method==='item/started'&&params.threadId===threadId&&params.item?.type==='agentMessage'&&(params.item.phase==='final_answer'||params.item.phase==null))finalIds.add(params.item.id);
    if(message.method==='item/agentMessage/delta'&&params.threadId===threadId&&finalIds.has(params.itemId)&&typeof params.delta==='string'){
      deltas.set(params.itemId,(deltas.get(params.itemId)??'')+params.delta);appendEvent({type:'agent_message_delta',delta:params.delta});
    }
    if(message.method==='item/completed'&&params.threadId===threadId&&params.item?.type==='agentMessage'&&(params.item.phase==='final_answer'||params.item.phase==null)){
      finalItems.set(params.item.id,params.item.text??'');appendEvent({type:'item.completed',item:{type:'agent_message',text:params.item.text??''}});
    }
    if(message.method==='turn/completed'&&params.threadId===threadId&&(!turnId||params.turn?.id===turnId))finishTurn(message);
    if(message.method==='error'&&params.threadId===threadId)failTurn(Error(params.message??'Codex app-server 返回错误'));
  });
  child.stderr?.on('data',appendStderr);
  child.on('error',error=>{failed=error;for(const [id,wait] of pending){clearTimeout(wait.timer);wait.reject(error);pending.delete(id);}failTurn(error);});
  child.on('close',(code,signal)=>{closed=true;const error=failed??Error(`Codex app-server 已退出 (${code??signal??'unknown'})`);for(const [id,wait] of pending){clearTimeout(wait.timer);wait.reject(error);pending.delete(id);}if(turnId)failTurn(error);});
  let timeout:NodeJS.Timeout|undefined;
  const killTree=async()=>{if(closed)return;if(process.platform==='win32'&&child.pid){await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>resolve());killer.once('error',()=>resolve());});}else child.kill('SIGKILL');};
  let rejectAbort:(error:Error)=>void=()=>{};
  const abortWait=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});void abortWait.catch(()=>{});
  const abort=()=>{aborted=true;rejectAbort(Error('已停止'));if(threadId&&turnId)void rpc('turn/interrupt',{threadId,turnId}).catch(()=>{});else void killTree();};
  try{
    await new Promise<void>((resolve,reject)=>{if(child.pid){resolve();return;}child.once('spawn',()=>resolve());child.once('error',reject);});
    await writeFile(join(request.attemptDir,'process.json'),JSON.stringify({pid:child.pid,managerPid:process.pid,startedAt:new Date().toISOString(),command,transport:'codex-app-server'},null,2));
    request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();
    timeout=setTimeout(()=>{failed=Error('Codex app-server 执行超时');void killTree();failTurn(failed);},request.timeoutMs);
    await rpc('initialize',{clientInfo:{name:'legion-minimal-agent',title:'Legion Minimal Agent',version:'0.1.0'},capabilities:{experimentalApi:false,requestAttestation:false}});
    notify('initialized');
    const instructions="You are Legion's lightweight outer conversation agent. Reply naturally and briefly to greetings, identity questions, thanks, and casual conversation. Match the user's language. You cannot inspect or change project files, run commands, or perform requested work. If the user asks for substantive work, explain briefly that the main agent handles it. Never claim that you performed an action.";
    const settings={model,cwd:request.workspace,approvalPolicy:'never',sandbox:'read-only',baseInstructions:instructions};
    const thread=request.sessionId
      ?await rpc('thread/resume',{threadId:request.sessionId,...settings})
      :await rpc('thread/start',{...settings,ephemeral:false});
    threadId=thread?.thread?.id??request.sessionId;if(!threadId)throw Error('Codex app-server 没有返回对话 ID');
    const start=await rpc('turn/start',{threadId,input:[{type:'text',text:request.prompt,text_elements:[]}],cwd:request.workspace,model,effort:'low',approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false}});
    turnId=start?.turn?.id;if(!turnId)throw Error('Codex app-server 没有返回轮次 ID');
    const terminal=await Promise.race([done,abortWait]);
    await logTail;const turn=terminal.params?.turn;const status=aborted||turn?.status==='interrupted'?'cancelled':turn?.status==='completed'?'completed':'error';
    const text=[...finalItems.values()].at(-1)??[...deltas.values()].at(-1)??'';
    const detail=turn?.error?.message??(status==='error'?'Codex app-server 本轮未能完成':undefined);
    if(!text&&status==='completed')return {status:'error',sessionId:threadId,durationMs:Math.round(performance.now()-started),usage:[],detail:'执行结束，但没有收到回复。'};
    return {status,sessionId:threadId,durationMs:Math.round(performance.now()-started),usage:[],detail};
  }catch(error){
    await logTail.catch(()=>{});await stderrTail.catch(()=>{});
    return {status:aborted?'cancelled':'error',sessionId:threadId||undefined,durationMs:Math.round(performance.now()-started),usage:[],detail:String(error)};
  }finally{
    if(timeout)clearTimeout(timeout);request.signal?.removeEventListener('abort',abort);lines.close();
    if(!closed){child.stdin?.end();await Promise.race([new Promise<void>(resolve=>child.once('close',()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,1500))]);if(!closed)await killTree();}
    await Promise.all([logTail.catch(()=>{}),stderrTail.catch(()=>{})]);
  }
}
