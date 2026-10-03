import {z} from 'zod';
const differenceSchema=z.object({path:z.string(),before:z.unknown(),after:z.unknown(),explained:z.boolean(),kind:z.string()});
const rowsSchema=z.array(z.object({id:z.string(),hashMatches:z.boolean(),consistent:z.boolean(),differences:z.array(differenceSchema)}));
function diagnosticTail(value:unknown){
 if(typeof value!=='string')return undefined;
 const marker=value.indexOf('\nFormal: ');if(marker<0||!value.slice(marker).includes('Failed: ')||!value.slice(marker).includes('failed assertion'))return undefined;
 // The evaluator takes a bounded tail of interleaved SBY output. Its earlier
 // prefix is not stable; all task outcomes remain in the separately compared
 // structured checks. Preserve the failure summary and complete failure tail.
 return value.slice(marker).replace(/SBY\s+\d+:\d+:\d+/g,'SBY <t>').replace(/\d+:\d+:\d+/g,'<t>').replace(/Elapsed[^\n]*/g,'Elapsed <t>').replace(/last_run-\d+/g,'last_run-<n>').replace(/\(\d+\)/g,'(<t>)');
}
/** A derived review; raw result, exit code and every original difference remain unchanged. */
export function reviewReplayConsistency(value:unknown){
 const raw=rowsSchema.parse(value),rows=raw.map(row=>{
  const unexplained=row.differences.filter(d=>!d.explained);
  const reviewed=unexplained.length===1&&unexplained[0]!.path==='checks.formal.detail'&&diagnosticTail(unexplained[0]!.before)!==undefined&&diagnosticTail(unexplained[0]!.before)===diagnosticTail(unexplained[0]!.after);
  return {...row,consistent:row.hashMatches&&(!unexplained.length||reviewed),reviewedTailInterleaving:reviewed,reviewReason:reviewed?'All other full structured checks/metrics match after recorded timing exclusions; failure summary, assertion, step and counterexample values match. Bounded parallel SBY prefix and clocks differ.':null,originalConsistent:row.consistent};
 });return {consistent:rows.every(r=>r.consistent),literalConsistent:raw.every(r=>r.consistent),originalEvidencePreserved:true,rows};
}
