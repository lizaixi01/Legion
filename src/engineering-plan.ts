import {z} from 'zod';
import {TeamTaskSchema} from './team.js';

export const EngineeringTask = z.object({
  id: TeamTaskSchema.shape.id,
  goal: z.string().min(1),
  backend: z.enum(['codex','commandcode']).optional(),
  dependsOn: z.array(TeamTaskSchema.shape.id),
  outputs: TeamTaskSchema.shape.outputs,
  acceptance: z.array(z.string().min(1)).min(1),
  testSource: z.string().min(1),
}).strict();

// Existing saved single-task plans remain executable without changing their hash.
export const EngineeringPlan = z.object({
  summary: z.string().min(1),
  outputs: TeamTaskSchema.shape.outputs,
  acceptance: z.array(z.string().min(1)).min(1),
  testSource: z.string().min(1),
  limitations: z.array(z.string()),
  tasks: z.array(EngineeringTask).min(1).max(64).optional(),
}).strict();
export const EngineeringGraphPlan = EngineeringPlan.extend({tasks: z.array(EngineeringTask).min(1).max(64)});
export type Plan = z.infer<typeof EngineeringPlan>;
export type PlannedTask = z.infer<typeof EngineeringTask>;

export function planTasks(plan: Plan): PlannedTask[] {
  return plan.tasks ?? [{id:'implementation',goal:plan.summary,dependsOn:[],outputs:plan.outputs,acceptance:plan.acceptance,testSource:plan.testSource}];
}

export function validatePlan(plan: Plan, files: Record<string,string>) {
  const tasks=planTasks(plan), byId=new Map(tasks.map(task=>[task.id,task]));
  if(byId.size!==tasks.length)throw Error('任务 ID 重复');
  const visited=new Set<string>(), visiting=new Set<string>();
  const visit=(id:string)=>{
    if(visiting.has(id))throw Error('任务依赖存在循环');
    if(visited.has(id))return;
    const task=byId.get(id);if(!task)throw Error('未知依赖任务：'+id);
    if(new Set(task.dependsOn).size!==task.dependsOn.length)throw Error('依赖任务重复');
    visiting.add(id);task.dependsOn.forEach(visit);visiting.delete(id);visited.add(id);
  };
  tasks.forEach(task=>visit(task.id));
  const outputs=tasks.flatMap(task=>task.outputs), paths=outputs.map(p=>p.toLowerCase());
  if(new Set(paths).size!==paths.length||paths.some(p=>paths.some(q=>p!==q&&q.startsWith(p+'/'))))throw Error('任务交付路径冲突，每个文件只能由一个任务交付');
  if(new Set(plan.outputs).size!==plan.outputs.length||outputs.length!==plan.outputs.length||outputs.some(p=>!plan.outputs.includes(p)))throw Error('总交付清单必须与各任务交付清单一致');
  const blocked=(p:string)=>/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(p)||/\.(test|spec)\./i.test(p)||p.toLowerCase().startsWith('managed-')||p.toLowerCase().startsWith('inputs/');
  if(outputs.some(blocked))throw Error('交付清单不能修改测试或依赖配置');
  for(const p of outputs)for(const existing of Object.keys(files)){
    const a=p.toLowerCase(),b=existing.toLowerCase();
    if((a===b&&p!==existing)||a.startsWith(b+'/')||b.startsWith(a+'/'))throw Error('交付路径与项目文件冲突：'+p);
  }
  if(Object.keys(files).some(p=>p.toLowerCase().startsWith('managed-')||p.toLowerCase().startsWith('inputs/')))throw Error('项目使用了管理器保留路径 managed-* 或 inputs/');
}

export function ancestors(task: PlannedTask, tasks: PlannedTask[]): string[] {
  const result=new Set<string>();
  function visit(id:string){const parent=tasks.find(t=>t.id===id)!;parent.dependsOn.forEach(visit);result.add(id);}
  task.dependsOn.forEach(visit);return [...result];
}
