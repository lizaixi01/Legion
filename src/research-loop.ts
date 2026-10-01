/** Compatibility entry for the existing HWE research protocol. */
import {runCandidateLoop} from './management/candidate-loop.js';
import {hweQualityPolicy,type HweMetrics} from './hwe-quality.js';
import type {Candidate as CoreCandidate,Evidence as CoreEvidence,ResearchContext as CoreContext,ResearchDeps as CoreDeps,ResearchState as CoreState,ResearchConfig} from './management/candidate-types.js';
export {HypothesisSchema,ResearchDecisionSchema,ResearchConfigSchema} from './management/candidate-types.js';
export type {Hypothesis,ResearchDecision,ResearchConfig} from './management/candidate-types.js';
export {researchContext,validateDecision} from './management/candidate-loop.js';
export {eligibleHweCandidate as eligible,verificationHasInfrastructureError} from './hwe-quality.js';
export type Candidate=CoreCandidate<HweMetrics>;
export type Evidence=CoreEvidence<HweMetrics>;
export type ResearchContext=CoreContext<HweMetrics>;
export type ResearchDeps=CoreDeps<HweMetrics>;
export type ResearchState=CoreState<HweMetrics>;
export function runResearch(root:string,config:ResearchConfig,deps:ResearchDeps,external:AbortSignal,resume=false):Promise<ResearchState>{
 return runCandidateLoop(root,config,deps,hweQualityPolicy,external,resume,hweQualityPolicy.id);
}
