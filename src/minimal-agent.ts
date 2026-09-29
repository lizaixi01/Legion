import {codexAppServerWorker} from './codex-app-server.js';
import {modelCatalog} from './chat-options.js';
import type {WorkerRequest,WorkerResult} from './types.js';

const smallTalk=/^(?:hi|hello|hey|你好|您好|嗨|早上好|早安|在吗|你是谁|你是什么|你能做什么|你可以做什么|你是做什么的|谢谢|多谢|辛苦了|how are you|who are you|what can you do|thanks|thank you)[!！?？。,.，\s]*$/i;

export function isMinimalAgentMessage(text:string){return smallTalk.test(text.trim());}

export function minimalAgentWorker(command:string,fallbackModel:string){
  return async(request:WorkerRequest):Promise<WorkerResult>=>{
    const catalog=await modelCatalog();
    const model=catalog.find(item=>item.id==='gpt-6-luna'&&item.efforts.includes('low'))
      ??catalog.find(item=>item.id===fallbackModel&&item.efforts.includes('low'))
      ??catalog.find(item=>item.efforts.includes('low'));
    if(!model)throw Error('当前没有可用于 Minimal Agent 的低推理模型');
    return codexAppServerWorker(command,model.id,request);
  };
}
