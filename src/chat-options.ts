import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
export const ChatOptionsSchema=z.object({
  model:z.string().regex(/^[a-z0-9.-]+$/).default('gpt-6-sol'),
  effort:z.enum(['low','medium','high','xhigh','max','ultra']).default('high'),
  permission:z.enum(['read-only','workspace-write','danger-full-access']).default('workspace-write'),
  agents:z.union([z.literal(0),z.literal(2),z.literal(4)]).default(0),
  delegation:z.object({mode:z.enum(['off','auto','fixed']),count:z.number().int().min(1).max(64).default(10)}).strict().optional(),
}).strict();
export type ChatOptions=z.infer<typeof ChatOptionsSchema>;
export const defaultChatOptions=ChatOptionsSchema.parse({});
const Model=z.object({slug:z.string(),display_name:z.string(),visibility:z.string(),supported_reasoning_levels:z.array(z.object({effort:z.string()}))});
export async function modelCatalog(){
  try{const data=JSON.parse(await readFile(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'models_cache.json'),'utf8'));
    return z.array(Model).parse(data.models).filter(m=>m.visibility==='list').map(m=>({id:m.slug,name:m.display_name.replace(/^GPT-(\d+(?:\.\d+)?)-/,'GPT-$1 '),efforts:m.supported_reasoning_levels.map(e=>e.effort).filter(e=>['low','medium','high','xhigh','max','ultra'].includes(e))}));
  }catch{return [{id:'gpt-6-sol',name:'GPT-6 Sol',efforts:['low','medium','high','xhigh','max','ultra']}];}
}
export async function validateChatOptions(input:unknown){const options=ChatOptionsSchema.parse(input);const model=(await modelCatalog()).find(m=>m.id===options.model);if(!model||!model.efforts.includes(options.effort))throw Error('该模型或推理强度不在本机模型目录中');return options;}
