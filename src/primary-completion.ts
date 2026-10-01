import type {WorkerResult} from './types.js';

/** Transport completion is not task completion when execution evidence says otherwise. */
export function guardPrimaryCompletion(result:WorkerResult,failures:string[]):WorkerResult {
 if(result.status!=='completed'||!failures.length||result.acceptance?.status==='accepted')return result;
 const detail='任务受阻，尚未完成：'+failures.join('; ');
 return {...result,status:'error',detail,acceptance:{status:'blocked',detail,uncovered:['未完成任务验收']}};
}
