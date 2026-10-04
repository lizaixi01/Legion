import {runCandidateLoop,eligible as coreEligible,researchContext} from '../../src/management/candidate-loop.js';
import type {QualityPolicy,ResearchConfig,ResearchDeps} from '../../src/management/candidate-types.js';
export {ResearchConfigSchema} from '../../src/management/candidate-types.js';
export type {ResearchConfig,ResearchDeps,Evidence,Candidate,ResearchState} from '../../src/management/candidate-types.js';
export {researchContext};

/** A test-installed measurement policy; no production task or metric defaults. */
export const scorePolicy:QualityPolicy<Record<string,number>>={
 id:'fixture-score-max-v1',validMetrics:m=>!!m&&Number.isFinite(m.score)&&m.score!>=0,
 better:(a,b)=>a.score!>b.score!,
};
export const eligible=(candidate:Parameters<typeof coreEligible>[0])=>coreEligible(candidate,scorePolicy);
export const runFixture=(root:string,config:ResearchConfig,deps:ResearchDeps,signal:AbortSignal,resume=false)=>runCandidateLoop(root,config,deps,scorePolicy,signal,resume);
