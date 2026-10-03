import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import {ServiceTierSchema,advertisesFast} from './service-tier.js';
export const ChatOptionsSchema=z.object({
  model:z.string().regex(/^[a-z0-9.-]+$/).default('gpt-6-sol'),
  effort:z.enum(['low','medium','high','xhigh','max','ultra']).default('high'),
  serviceTier:ServiceTierSchema.optional(),
  worker:z.object({model:z.string().regex(/^[a-z0-9.-]+$/),effort:z.enum(['low','medium','high','xhigh','max','ultra']),serviceTier:ServiceTierSchema.optional()}).strict().optional(),
  permission:z.enum(['read-only','workspace-write','danger-full-access']).default('workspace-write'),
  agents:z.union([z.literal(0),z.literal(2),z.literal(4)]).default(0),
  delegation:z.object({mode:z.enum(['off','auto','fixed']),count:z.number().int().min(1).max(64).default(10),maxWorkers:z.number().int().min(1).max(64).optional()}).strict().optional(),
}).strict();
export type ChatOptions=z.infer<typeof ChatOptionsSchema>;
export const defaultChatOptions=ChatOptionsSchema.parse({});
const Model=z.object({slug:z.string(),display_name:z.string(),visibility:z.string(),supported_reasoning_levels:z.array(z.object({effort:z.string()})),service_tiers:z.array(z.object({id:z.string()})).optional(),additional_speed_tiers:z.array(z.string()).optional()});
export async function modelCatalog(){
  try{const data=JSON.parse(await readFile(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'models_cache.json'),'utf8'));
    return z.array(Model).parse(data.models).filter(m=>m.visibility==='list').map(m=>({id:m.slug,name:m.display_name.replace(/^GPT-(\d+(?:\.\d+)?)-/,'GPT-$1 '),efforts:m.supported_reasoning_levels.map(e=>e.effort).filter(e=>['low','medium','high','xhigh','max','ultra'].includes(e)),fastSupported:advertisesFast(m)}));
  }catch{return [{id:'gpt-6-sol',name:'GPT-6 Sol',efforts:['low','medium','high','xhigh','max','ultra'],fastSupported:false}];}
}
export async function validateChatOptions(input:unknown){const options=ChatOptionsSchema.parse(input);const catalog=await modelCatalog();const model=catalog.find(m=>m.id===options.model);if(!model||!model.efforts.includes(options.effort))throw Error('该模型或推理强度不在本机模型目录中');if(options.serviceTier&&options.serviceTier!=='default'&&!model.fastSupported)throw Error('Manager 模型目录未声明 Fast 支持');if(options.worker){const worker=catalog.find(m=>m.id===options.worker!.model&&m.efforts.includes(options.worker!.effort));if(!worker)throw Error('Worker 模型或推理强度不在本机模型目录中');if(options.worker.serviceTier&&options.worker.serviceTier!=='default'&&!worker.fastSupported)throw Error('Worker 模型目录未声明 Fast 支持');}return options;}
export function managerSelection(options:ChatOptions){return {model:options.model,effort:options.effort,...(options.serviceTier===undefined?{}:{serviceTier:options.serviceTier})};}
