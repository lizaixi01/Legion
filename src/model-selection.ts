import {z} from 'zod';
import {ChatOptionsSchema,validateChatOptions} from './chat-options.js';
export const ModelSelectionSchema=ChatOptionsSchema.pick({model:true,effort:true,serviceTier:true});
export type ModelSelection=z.infer<typeof ModelSelectionSchema>;
export async function validateModelSelection(input:unknown):Promise<ModelSelection>{
  const selected=ModelSelectionSchema.parse(input);
  await validateChatOptions({...selected,permission:'workspace-write',agents:0});
  return selected;
}
export const WorkerConfigurationSchema=z.object({
  candidates:z.union([z.literal(1),z.literal(2)]).optional(),
  worker:ModelSelectionSchema,
  tasks:z.record(z.string(),ModelSelectionSchema).default({}),
}).strict();
export type WorkerConfiguration=z.infer<typeof WorkerConfigurationSchema>;
