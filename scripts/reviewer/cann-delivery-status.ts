import type {Result} from '../../src/worker-pool.js';

interface Limits {max_input_output_tokens:number;max_run_ms:number;max_feedback_rounds:number}
interface Usage extends Record<string,unknown> {input_tokens:number;output_tokens:number;total_tokens:number}

function sessionUsage(raw:unknown):Usage|null{
 if(!raw||typeof raw!=='object')return null;
 const value=raw as Record<string,unknown>,input=value.input_tokens,output=value.output_tokens;
 if(typeof input!=='number'||typeof output!=='number'||!Number.isFinite(input)||!Number.isFinite(output)||input<0||output<0)return null;
 // Cached input is already part of input; reasoning is already part of output.
 return {...value,input_tokens:input,output_tokens:output,total_tokens:input+output};
}

/** Keep content, resource compliance and host completion separate; never retry at a cap. */
export function deliveryAttemptOutcome(result:Result,cumulativeUsage:unknown,limits:Limits,elapsedMs:number,attempt:number,contentQualified:boolean,deliverySaved:boolean,priorBudgetStop:string|null=null){
 const terminal=sessionUsage(result.usage),observed=sessionUsage(cumulativeUsage);
 const usage=terminal&&(!observed||terminal.total_tokens>=observed.total_tokens)?terminal:observed;
 const tokens=usage?.total_tokens??null;
 const budgetStop=priorBudgetStop??(tokens!==null&&tokens>=limits.max_input_output_tokens?'token_budget':elapsedMs>=limits.max_run_ms||result.status==='timeout'?'wall_clock_budget':tokens===null?'usage_unknown':null);
 const budgetCompliant=elapsedMs>limits.max_run_ms||tokens!==null&&tokens>limits.max_input_output_tokens?false:tokens===null?null:true;
 const deliveryCompleted=deliverySaved&&result.status==='completed';
 return {
  usage_cumulative:usage,
  content_qualified:contentQualified,
  budget_compliant:budgetCompliant,
  budget_stop:budgetStop,
  stop_experiment:budgetStop!==null,
  evidence_saved:deliverySaved,
  delivery_completed:deliveryCompleted,
  qualified:contentQualified&&budgetCompliant===true&&deliveryCompleted,
  followup_allowed:!contentQualified&&budgetCompliant===true&&!budgetStop&&deliveryCompleted&&!!result.sessionId&&attempt<=limits.max_feedback_rounds,
 };
}
