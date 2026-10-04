# Independent delivery review failure isolation

Diagnosis recorded 2026-10-04. This is a Legion infrastructure repair, not a benchmark result or a change to CANN acceptance rules.

## Observed incident

Read-only source evidence is under `D:/Projects/Proactive Agent/.chats/7321162f-7e85-4e9f-81e9-018808ec1e14/turns/4a4154a0-4f7a-4537-be38-b80edbb1c03b/delivery/`, versions 1 and 2. Preserve this directory unchanged. Each `challenger/execution/` contains invocation, process, execution and result JSON, stdout JSONL and stderr. Durations were 180896 and 181706 ms. Both processes started, emitted thread/turn start events, read files and produced commentary; neither emitted a terminal turn event. The host timeout killed them, recording exit 1 and null signal. Exit 1 here is not evidence of candidate failure.

The first attempt read large outputs and logged a closed-stdin tool error. The second had failed shell commands, then PowerShell JSON parsing failed on case-distinct `id` / `ID` keys in raw ranking evidence. These support an inspection/tool compatibility problem within a fixed 180-second window. They do not prove that a longer timeout would finish, or that every delay has one cause. The patch does not claim a successful live model rerun.

## Call chain and root cause

`createPrimaryAgentWorker` installs `legion_delivery` with `run: tasks.review`. `createPrimaryDelivery` creates a fresh reviewer against the frozen candidate, with a schema and output path. `tasks.review` reserves shared capacity and calls the shared `WorkerPool`, then `runWorker`, then `execute`. This reviewer runs **codex exec**, not app-server. `codexAppServerWorker` serves the primary conversation and dispatches the delivery tool; no evidence implicates its terminal-event handling in this incident.

Codex worker success requires exit code 0 plus `turn.completed`. Commentary and partial output are not success. Process timeout/cancellation takes precedence. The new result retains the process outcome, PID/start status, exit signal/code and terminal event alongside existing logs.

The deterministic aggregation defect was that reviewer generation ran before `verifyCandidate`, and threw on timeout. The outer catch set delivery to blocked and never collected host functional evidence. The original prompt also conflated restrictions on generated scripts with how the reviewer could inspect files.

## Preserved contract

Host verification now runs and is persisted before review. Reviewer generation/replay has a separate failure boundary and durable attempt record. The prompt distinguishes read-only inspection from restricted generated scripts, recommends Node JSON parsing for case-sensitive raw keys, bounds inspection and directs missing evidence to limitations. The 180-second limit, frozen requirements, three-check budget, read-only permissions and successful-review requirement are unchanged.

| Host evidence | Independent review | Delivery |
| --- | --- | --- |
| accepted | accepted | accepted, subject to current evidence integrity |
| accepted | timeout, process failure, missing terminal, invalid result | unverified; reviewer infrastructure failure |
| unverified / no trusted verifier | accepted or infrastructure failure | unverified |
| rejected | any | rejected; host failure retained |
| blocked | any | blocked; host error retained |
| accepted | conflicting counterexample | blocked; both reports retained |
| any | cancelled overall, deadline exceeded, changed output | blocked; historical evidence retained |

`acceptance.evidenceStatus` describes host evidence, `acceptance.reviewStatus` describes Legion review and `acceptance.status` remains the delivery gate. `failureClass=reviewer_infrastructure_failure` identifies the review component, even when independent host evidence rejects the candidate. `limitations` preserves missing coverage and review errors. Versions retain the full functional report, candidate manifest, artifact references and reviewer result. `challenger/attempt.json`, `usage.json`, `prompt.txt`, raw execution logs and all earlier versions remain available. Later-turn history keeps both status dimensions but never grants fresh acceptance without rechecking.

For an external benchmark, “benchmark evidence accepted” means the trusted host adapter accepted the bound evidence; it is distinct from “Legion delivery review accepted.” The default primary delivery still has only the built-in aggregation verifier, not a CANNJudge verifier. Merely finding a submission ID, score or a self-reported Pass in a file cannot grant authority. Existing real platform results remain valid on their own terms; absent a host adapter, Legion must state unverified and preserve their paths rather than invent certification. No adapter, CANN source, submission, score or raw benchmark evidence is modified by this repair.

## Verification

Offline regression covers successful review, actual subprocess timeout, exit 1, startup failure, missing terminal event, invalid JSON, trusted complete synthetic external evidence plus timeout, candidate rejection, unsupported verification, retry/history preservation, cancellation, changed output and case-distinct JSON keys. Existing acceptance, challenge replay, shared capacity, persistent budget and primary transport tests also run. Synthetic fixtures are explicitly not CANNJudge results.

Validation on 2026-10-04: 84 relevant tests passed on the committed branch; 85 passed with the main checkout's existing directory-snapshot changes overlaid in the isolated worktree. The latter includes actual directory capture/review/resume. Type checking passed for both the isolated change and the current main checkout. Logs are `reviewer-regression.log` and `reviewer-compatibility.log` in the reviewer worktree. The compatibility overlay was removed after testing; it was not committed as part of this repair. No live model call, CANNJudge submission, application restart or historical delivery rewrite was performed.
