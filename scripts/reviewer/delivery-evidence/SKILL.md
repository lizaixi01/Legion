---
name: delivery-evidence
description: Assemble a traceable delivery from saved experiment evidence, including incomplete or conflicting receipts. Use for offline evidence handoffs, not kernel optimization or platform submission.
---

Use the supplied inventory and deterministic checker for file existence, hashes, JSON references, source equality and numeric parsing. Do not recreate a file manifest or trust a typed hash when the checker can calculate it.

Build the evidence chain around the requested candidate: local source → uploaded source → submission identity → that submission's case results → that submission's score. Link parent evidence separately. An available result for another submission is context, not a replacement for a missing target result.

For each requested field, distinguish an observed fact, a derived value and a claim. Tie it to an actual file and location. Execution roles matter: generator, evaluator and reviewer records do not establish each other's model. Explain conflicts instead of choosing the convenient value.

Before delivery, revisit every unknown: did you inspect the available evidence that could answer it? Also revisit every verified assertion: does its citation establish this candidate, this submission and this time slice? Missing final results are unknown, not zero or failure. A recorded submission ID still counts when a client is waiting.

A complete explanation of a blocked handoff can be compliant. It cannot certify a complete operator result. Keep archive evidence, your offline consistency checks and host acceptance separate. Report the missing evidence and the scope of what was checked; do not repair gaps by retrieving outside material or rerunning the platform.
