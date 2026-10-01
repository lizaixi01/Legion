import {z} from 'zod';
export const TaskContract=z.object({goal:z.string().min(1).max(10000),outputs:z.array(z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/).refine(p=>p.split('/').every(s=>s!=='.'&&s!=='..'&&!!s))).min(1).max(30),acceptance:z.array(z.string().min(1).max(2000)).min(1).max(20)}).strict();
export const Dispatch=z.object({backend:z.enum(['codex','commandcode']),prompt:z.string().min(1).max(50000),inputs:z.array(z.string().min(1)).max(100).optional(),contract:TaskContract.optional(),timeoutSeconds:z.number().int().min(30).max(1800).optional()}).strict();
