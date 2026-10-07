---
name: cann-single-hypothesis
description: Develop one CANN kernel optimization candidate from a verified source and historical experiments, separating local checks from device evidence.
---

Read the supplied baseline and experiment history before editing. Choose one main
hypothesis: identify the source-level cost, the expected mechanism, and the shapes
or branches affected. A historically rejected approach needs a specific new reason.

Modify only the assigned candidate's `kernel.asc`. Preserve the input contract,
arithmetic ordering and exceptional-value behavior unless the assigned hypothesis
explicitly requires a change. Do not combine a second optimization into the patch.

Use available deterministic checks for file identity, unchanged scaffold, allocation
bounds and queue lifetimes. Describe which checks actually ran and their limits;
a source model is not an Ascend compiler, device correctness test or performance test.

Return the hypothesis, exact change, checks, unresolved risks and a rollback rule.
Include the candidate path and SHA. Leave a candidate pending when no source-bound
device result exists. Never infer a speedup from local checks or the baseline score.
