import {nativeGoalLifecycle,type NativeGoal} from './native-goal.js';
import {spawn,type ChildProcess} from 'node:child_process';
import {appendFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import type {WorkerRequest,WorkerResult} from './types.js';

type RpcMessage={id?:number;method?:string;params?:any;result?:any;error?:{message?:string}};
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
export interface AgentTransportOptions {
  effort:string; permission:'read-only'|'workspace-write'|'danger-full-access'; instructions:string;
  tools?:unknown[]; callTool?:(name:string,args:unknown)=>Promise<unknown>;
  onSession?:(id:string)=>Promise<void>;
  onGoal?:(goal:NativeGoal)=>Promise<void>;
}

/** Runs a minimal chat turn through Codex app-server so final text can stream as it is generated. */
export async function codexAppServerWorker(command:string,model:string,request:WorkerRequest,agent?:AgentTransportOptions):Promise<WorkerResult>{
  const started=performance.now(),stdoutPath=join(request.attemptDir,'stdout.jsonl'),stderrPath=join(request.attemptDir,'stderr.log');
  if(request.signal?.aborted)return {status:'cancelled',durationMs:0,usage:[],detail:'启动前已停止'};
  if(!Number.isFinite(request.timeoutMs)||request.timeoutMs<=0)return {status:'error',durationMs:0,usage:[],detail:'执行时限无效'};
  const args=['app-server','--stdio','--disable','multi_agent','--disable','multi_agent_v2',request.continuousGoal?'--enable':'--disable','goals'];
  await Promise.all([writeFile(stdoutPath,''),writeFile(stderrPath,''),writeFile(join(request.attemptDir,'invocation.json'),JSON.stringify({command,args,cwd:request.workspace,model,transport:'codex-app-server'},null,2))]);
  if(request.signal?.aborted||performance.now()-started>=request.timeoutMs)return {status:request.signal?.aborted?'cancelled':'error',durationMs:Math.round(performance.now()-started),usage:[],detail:'启动登记期间已停止或超时'};
  const child:ChildProcess=spawn(command,args,{cwd:request.workspace,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,Pending>();let nextId=0,buffer='',closed=false,threadId='',turnId='',aborted=false,failed:Error|undefined;
  let logTail=Promise.resolve(),stderrTail=Promise.resolve();
  let finishTurn:(value:RpcMessage)=>void=()=>{};let failTurn:(error:Error)=>void=()=>{};
  const done=new Promise<RpcMessage>((resolve,reject)=>{finishTurn=resolve;failTurn=reject;});
  void done.catch(()=>{});
  const fail=(error:unknown)=>{
    failed??=error instanceof Error?error:Error(String(error));
    for(const [id,wait] of pending){clearTimeout(wait.timer);wait.reject(failed);pending.delete(id);}
    failTurn(failed);void killTree().catch(()=>{});
  };
  // Every write, including notifications and tool replies, shares the same failure path.
  const send=(message:unknown)=>{
    if(closed||failed)return false;
    try{if(!child.stdin||child.stdin.destroyed)throw Error('Codex app-server input pipe closed');
      child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)fail(error);});return true;
    }catch(error){fail(error);return false;}
  };
  const usage:unknown[]=[];
  const finalItems=new Map<string,string>(),deltas=new Map<string,string>(),finalIds=new Set<string>();
  const appendEvent=(event:unknown)=>{logTail=logTail.then(async()=>{if(!failed)await appendFile(stdoutPath,JSON.stringify(event)+'\n');}).catch(error=>fail(Error('Codex event log write failed: '+String(error))));};
  const appendStderr=(chunk:Buffer|string)=>{stderrTail=stderrTail.then(async()=>{if(!failed)await appendFile(stderrPath,chunk);}).catch(error=>fail(Error('Codex stderr log write failed: '+String(error))));};
  const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{
    if(closed||failed){reject(failed??Error('Codex app-server 已退出'));return;}
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Codex app-server 请求超时：${method}`));},30000);
    pending.set(id,{resolve,reject,timer});
    send({id,method,params});
  });
  const nativeGoal=request.continuousGoal?nativeGoalLifecycle(()=>threadId,rpc,async goal=>{await writeFile(join(request.attemptDir,'native-goal.json'),JSON.stringify(goal,null,2));await agent?.onGoal?.(goal);},message=>finishTurn(message as RpcMessage),fail):undefined;
  const notify=(method:string,params?:unknown)=>send(params===undefined?{method}:{method,params});
  const lines=createInterface({input:child.stdout!,crlfDelay:Infinity});
  lines.on('line',line=>{
    let message:RpcMessage;try{message=JSON.parse(line);}catch{return;}
    if(message.id!==undefined&&message.method){
      const respond=(result:unknown)=>send({id:message.id,result});
      if(message.method==='item/tool/call'&&agent?.callTool&&message.params?.threadId===threadId){
        void Promise.resolve().then(()=>agent.callTool!(message.params.tool,message.params.arguments)).then(value=>respond({success:true,contentItems:[{type:'inputText',text:JSON.stringify(value)}]}),error=>respond({success:false,contentItems:[{type:'inputText',text:String(error)}]})).catch(fail);
      }else if(message.method.includes('requestApproval'))respond(message.method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:{decision:'decline'});
      else send({id:message.id,error:{code:-32601,message:'Unsupported client request; ask the user in chat'}});
      return;
    }
    if(message.id!==undefined){const wait=pending.get(message.id);if(wait){pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(Error(message.error.message??'Codex app-server 请求失败')):wait.resolve(message.result);}return;}
    if(!message.method)return;const params=message.params??{};
    if(message.method==='item/started'&&params.threadId===threadId&&params.item?.type==='agentMessage'&&(params.item.phase==='final_answer'||params.item.phase==null))finalIds.add(params.item.id);
    if(message.method==='item/agentMessage/delta'&&params.threadId===threadId&&finalIds.has(params.itemId)&&typeof params.delta==='string'){
      deltas.set(params.itemId,(deltas.get(params.itemId)??'')+params.delta);appendEvent({type:'agent_message_delta',delta:params.delta});
    }
    if(message.method==='item/completed'&&params.threadId===threadId&&params.item?.type==='agentMessage'&&(params.item.phase==='final_answer'||params.item.phase==null)){
      finalItems.set(params.item.id,params.item.text??'');appendEvent({type:'item.completed',item:{type:'agent_message',text:params.item.text??''}});
    }
    if(params.threadId===threadId&&nativeGoal){
      if(message.method==='turn/started'&&params.turn?.id){turnId=params.turn.id;nativeGoal.started(turnId);}
      if(message.method==='thread/goal/updated'&&params.goal){try{nativeGoal.observe(params.goal);}catch(error){fail(error);}}
      if(message.method==='turn/completed')nativeGoal.completed(message);
    }else if(message.method==='turn/completed'&&params.threadId===threadId&&(!turnId||params.turn?.id===turnId))finishTurn(message);
    if(message.method==='thread/tokenUsage/updated'&&params.threadId===threadId){usage.splice(0,usage.length,{scope:'thread-cumulative',...params.tokenUsage});}
    if(params.threadId===threadId)appendEvent({type:'app_server_event',method:message.method,params});
  });
  child.stderr?.on('data',appendStderr);
  child.on('error',fail);
  child.stdin?.on('error',fail);child.stdout?.on('error',fail);child.stderr?.on('error',fail);lines.on('error',fail);
  child.on('close',(code,signal)=>{closed=true;const error=failed??Error(`Codex app-server 已退出 (${code??signal??'unknown'})`);for(const [id,wait] of pending){clearTimeout(wait.timer);wait.reject(error);pending.delete(id);}if(turnId)failTurn(error);});
  let timeout:NodeJS.Timeout|undefined;
  const killTree=async()=>{if(closed)return;if(process.platform==='win32'&&child.pid){await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>resolve());killer.once('error',()=>resolve());});}else child.kill('SIGKILL');};
  let rejectAbort:(error:Error)=>void=()=>{};
  const abortWait=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});void abortWait.catch(()=>{});
  const abort=()=>{aborted=true;void nativeGoal?.close().catch(()=>{});rejectAbort(Error('已停止'));if(threadId&&turnId)void rpc('turn/interrupt',{threadId,turnId}).catch(()=>{});else void killTree();};
  const ensureLive=()=>{if(aborted||request.signal?.aborted){aborted=true;throw Error('已停止');}if(failed)throw failed;if(performance.now()-started>=request.timeoutMs)throw Error('Codex app-server 执行超时');};
  let result:WorkerResult|undefined;
  try{
    await new Promise<void>((resolve,reject)=>{if(child.pid){resolve();return;}child.once('spawn',()=>resolve());child.once('error',reject);});
    await writeFile(join(request.attemptDir,'process.json'),JSON.stringify({pid:child.pid,managerPid:process.pid,startedAt:new Date().toISOString(),command,transport:'codex-app-server'},null,2));
    request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();
    ensureLive();timeout=setTimeout(()=>{failed=Error('Codex app-server 执行超时');void killTree();failTurn(failed);},Math.max(1,request.timeoutMs-(performance.now()-started)));
    await rpc('initialize',{clientInfo:{name:'legion',title:'Legion',version:'0.1.0'},capabilities:{experimentalApi:!!agent,requestAttestation:false}});
    ensureLive();
    notify('initialized');
    const instructions="You are Legion's lightweight outer conversation agent. Reply naturally and briefly to greetings, identity questions, thanks, and casual conversation. Match the user's language. You cannot inspect or change project files, run commands, or perform requested work. If the user asks for substantive work, explain briefly that the main agent handles it. Never claim that you performed an action.";
    const settings={model,cwd:request.workspace,approvalPolicy:'never',sandbox:agent?.permission??'read-only',...(agent?{developerInstructions:agent.instructions,config:{'windows.sandbox':'elevated'}}:{baseInstructions:instructions})};
    // Quiesce a persisted active goal before loading its runtime; resume may restore idle continuation.
    if(nativeGoal&&request.sessionId){threadId=request.sessionId;await nativeGoal.prepare(request.continuousGoal!.objective);}
    ensureLive();
    const thread=request.sessionId
      ?await rpc('thread/resume',{threadId:request.sessionId,...settings})
      :await rpc('thread/start',{...settings,ephemeral:false,...(agent?{dynamicTools:agent.tools??[]}: {})});
    threadId=thread?.thread?.id??request.sessionId;if(!threadId)throw Error('Codex app-server 没有返回对话 ID');
    await agent?.onSession?.(threadId);
    ensureLive();
    if(nativeGoal&&!request.sessionId)await nativeGoal.prepare(request.continuousGoal!.objective);
    ensureLive();
    const permission=agent?.permission??'read-only';
    const sandboxPolicy=permission==='danger-full-access'?{type:'dangerFullAccess'}:permission==='workspace-write'?{type:'workspaceWrite',writableRoots:[request.workspace],networkAccess:true,excludeTmpdirEnvVar:false,excludeSlashTmp:false}:{type:'readOnly',networkAccess:false};
    const start=await rpc('turn/start',{threadId,input:[{type:'text',text:request.prompt,text_elements:[]}],cwd:request.workspace,model,effort:agent?.effort??'low',approvalPolicy:'never',sandboxPolicy});
    turnId=start?.turn?.id;if(!turnId)throw Error('Codex app-server 没有返回轮次 ID');
    if(nativeGoal){nativeGoal.started(turnId);ensureLive();await nativeGoal.activate();}
    const terminal=await Promise.race([done,abortWait]);
    await Promise.all([logTail,stderrTail]);ensureLive();const turn=terminal.params?.turn;const status=aborted||turn?.status==='interrupted'?'cancelled':turn?.status==='completed'&&(!nativeGoal||nativeGoal.snapshot()?.status==='complete')?'completed':'error';
    const text=[...finalItems.values()].at(-1)??[...deltas.values()].at(-1)??'';
    const detail=turn?.error?.message??(status==='error'?'Codex app-server 本轮未能完成':undefined);
    if(!text&&status==='completed')return result={status:'error',sessionId:threadId,durationMs:Math.round(performance.now()-started),usage,detail:'执行结束，但没有收到回复。'};
    return result={status,nativeGoal:nativeGoal?.snapshot(),sessionId:threadId,durationMs:Math.round(performance.now()-started),usage,detail};
  }catch(error){
    await logTail.catch(()=>{});await stderrTail.catch(()=>{});
    return result={status:aborted?'cancelled':'error',nativeGoal:nativeGoal?.snapshot(),sessionId:threadId||undefined,durationMs:Math.round(performance.now()-started),usage,detail:String(error)};
  }finally{
    if(nativeGoal&&!closed)await nativeGoal.close().catch(error=>appendStderr(String(error)));
    if(timeout)clearTimeout(timeout);request.signal?.removeEventListener('abort',abort);lines.close();
    if(!closed){child.stdin?.end();await Promise.race([new Promise<void>(resolve=>child.once('close',()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,1500))]);if(!closed)await killTree();}
    await Promise.all([logTail.catch(()=>{}),stderrTail.catch(()=>{})]);
    if(result&&failed&&result.status==='completed'){result.status='error';result.detail=String(failed);}
    if(result)result.durationMs=Math.round(performance.now()-started);
  }
}
