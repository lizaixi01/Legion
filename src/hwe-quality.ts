import type {Candidate as CoreCandidate,Evidence as CoreEvidence,QualityPolicy} from './management/candidate-types.js';

export type HweMetrics={fitness:number;fmax_mhz:number;lut4:number;cycles:number};
export type HweEvidence=CoreEvidence<HweMetrics>;
export type HweCandidate=CoreCandidate<HweMetrics>;
export function validHweMetrics(metrics:HweMetrics|undefined):boolean {
 return Boolean(metrics)&&[metrics?.fitness,metrics?.fmax_mhz,metrics?.lut4,metrics?.cycles].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0);
}
/** A property FAIL can coexist with a verifier fault; retain both meanings. */
export function verificationHasInfrastructureError(e:HweEvidence|undefined):boolean {
 return e?.status==='error'||e?.status==='timeout'||e?.infrastructureError===true||Object.values(e?.checks??{}).some(c=>{
  if(!c||typeof c!=='object')return false;
  if(['error','timeout'].includes(String((c as {status?:unknown}).status)))return true;
  return (c as {classification?:{infrastructure_error?:boolean}}).classification?.infrastructure_error===true;
 });
}
export const hweQualityPolicy:QualityPolicy<HweMetrics>={id:'hwe-fitness-v1',validMetrics:validHweMetrics,better:(candidate,current)=>candidate.fitness>current.fitness,hasInfrastructureError:verificationHasInfrastructureError};
export function eligibleHweCandidate(c:HweCandidate):boolean {
 return c.status==='verified'&&c.evidence?.status==='pass'&&!verificationHasInfrastructureError(c.evidence)&&Boolean(c.snapshot)&&validHweMetrics(c.evidence?.metrics);
}
