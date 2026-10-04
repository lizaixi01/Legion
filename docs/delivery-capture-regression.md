# CANN runtime delivery capture regression

## Diagnosis before changes (2026-10-04)

Failed runtime: `D:/Projects/Legion-reviewer-fix`, commit `c85c4fd` (the three reviewer fixes cherry-picked onto `c1fa615`). Original record, preserved unchanged:
`.chats/7dcc5342-60db-4680-8e60-b6310a7aecb0/turns/9b4bcc39-160c-475d-8405-88a38abd9cdd/delivery/delivery.json`.

The project recorded by that chat is `D:/Projects/CANN-AddRmsNormBias`.

| Original contract string | Resolved absolute path | Exists | Type | File size | Descendant files / bytes |
| --- | --- | --- | --- | --- | --- |
| `candidates/iter1-cache8192` | `D:/Projects/CANN-AddRmsNormBias/candidates/iter1-cache8192` | yes | directory, not symlink | N/A | 9 / 34,265 |
| `results/experiments/iter1-cache8192` | `D:/Projects/CANN-AddRmsNormBias/results/experiments/iter1-cache8192` | yes | directory, not symlink | N/A | 23 / 90,706 |
| `results/evaluator/runs/iter1-cache8192-20261004` | `D:/Projects/CANN-AddRmsNormBias/results/evaluator/runs/iter1-cache8192-20261004` | yes | directory, not symlink | N/A | 290 / 488,180,797 |

All three are directories, not missing files. Directory content totals are not `stat.size` file sizes. No descendant symlinks were found. The third tree also contains 48 files above 4 MiB, with largest file 9,943,283 bytes: `raw/response-000100.json` and `raw/response-000109.json`. These are historical ranking responses, not the currently referenced score response. The selected current candidate ranking response is 1,563,596 bytes.

The first output alone triggers `src/challenge.ts:26:81`:
`if (!info.isFile() || info.size > 4*1024*1024) throw Error('Output missing or too large')`.
It takes the **not a regular file** branch, before looking at the other outputs. Path resolution is correct. `src/managed-chat.ts` has another occurrence of this message, but that is not the delivery call site.

Source call chain: delivery `check` in `createPrimaryDelivery` (`src/primary-delivery.ts:79`) → `captureCandidate` (`src/acceptance.ts:28:58`) → `snapshotOutputs` (`src/challenge.ts:26:81`). The historic outer catch stored `String(error)`, not a stack; a fresh read-only-source reproduction captured the last two frames in `.local/capture-diagnosis/diagnostic.json` in the reviewer-infrastructure worktree. That diagnostic records every contract entry and every descendant file size. It must not be described as a recovered original runtime stack.

## Classification and bounded repair

This is a **caller contract bug for this runtime**, with a misleading catch-all error. `docs/primary-agent.md` explicitly documents regular files and a 4 MiB single-file cap. The contract schema permits 1–30 outputs; capture checks path segments and rejects symlinks. It has no directory traversal or explicit total-byte/depth limit because it does not recurse. The reviewer prompt's mention of directories is inconsistent with those implementation capabilities, not proof of supported directory capture. Main's uncommitted directory implementation is a separate change; importing it would also introduce unrelated limit changes and still encounter this large historical tree.

`scripts/reviewer/cann-capture.json` specifies 30 actual files. It includes all nine candidate source/metadata files, baseline identity and source manifest, baseline kernel, candidate source manifest and submission state/receipt, both reports and their directly referenced raw submission/ranking/time-unit evidence, and experiment hypothesis/history/identity/preservation/authorization/comparison documents. Maximum selected file size is 2,031,481 bytes (baseline ranking response), below the unchanged 4,194,304-byte limit.

Historical poll responses and duplicate snapshots remain intact at their original locations. They are recorded with hashes in the exclusion inventory; they are not silently deleted or represented as a file containing an entire directory. Stale experiment reports are retained as historical evidence, not rewritten to claim success. The reviewer must report missing evidence or contradictions as limitations. This capture repair does not promise that the original experiment requirements will pass review.

The opt-in runner creates a fresh delivery with the **exact original goal, acceptance text and original requirement**, changing only the outputs. It records the original and corrected contracts side by side and leaves the failed delivery untouched. A fresh ten-minute host review deadline does not change the benchmark submission deadline or authorize submission. Only one delivery check runs, with the existing 180-second real Codex reviewer limit. No new functional verifier or acceptance override is installed.

It inventories and hashes all files in the original output trees plus the baseline tree before and after the run, and records external evidence as **retained**, not host-verified/accepted. The inventory is streaming, bounded to 4,096 entries, depth 64, 64 MiB per source file and 1 GiB aggregate, with links rejected. These are diagnostic inventory limits, **not changes to snapshot limits**. The runner has no evaluator/submit/query command; reviewer execution uses the existing read-only worker.

Run from the reviewer worktree with an existing Codex reviewer invocation JSON and a fresh destination outside the CANN project:

```powershell
node --import tsx scripts/reviewer/cann-capture.mjs PROJECT PREVIOUS_DELIVERY REVIEWER_INVOCATION NEW_OUTPUT_DIRECTORY
```

## Verification

The offline regression reproduces the directory failure, confirms a file above 4 MiB is still rejected, checks all 30 selected files reach the reviewer callback, retains an excluded oversized file unchanged, preserves acceptance text and keeps an unsupported-verifier/timeout outcome unverified. Live logs and integrity inventories are kept separately under `.runs/cann-capture-20261004/`.

Live run result: capture completed, candidate `a6bbb997-a21e-41ea-8637-13eb4c7707d7`, artifact hash `69aebfa1bba6cd94a9b56acf879b59e92009d4819b3f684a8e75f2f6ee75444c`. The actual reviewer process started (PID 42840), read the manifest and frozen raw evidence, then timed out after 182,205 ms without a successful terminal event. Its five completed commands only read files; no evaluator or submission command ran. The reviewer also read a local review skill despite the prompt's restriction on unrelated workflows; that behavior and timeout remain outside this capture-only repair.

Final delivery: `unverified`, review: `infrastructure_failure`, failure class: `reviewer_infrastructure_failure`. External evidence remains `retained`: submission `6ac234bf694b590c3cce5152`, Pass, 15/15, 26.64, us. Host functional `evidenceStatus` remains `unverified` because this runtime has no trusted CANN verifier; retained platform results must not be relabeled host acceptance. No candidate failure/rejection was issued. All 421 source files (516,966,799 bytes), including excluded evidence and kernels, have identical before/after hashes. No new CANNJudge POST was performed. See `summary.json`, `external-evidence-retained.json`, both source inventories, and `delivery/version-1/challenger/execution/` under the run directory.

Required validation passed: `npm run build`, `npm run typecheck`, and `npm test` (440/440, no skips, 98.7 s). The first full test run had one `arm-cli` ENOENT for a missing summary; all four tests in that file passed on isolated recheck and the complete suite then passed unchanged. The original failure cause is unconfirmed; it was not hidden by modifying tests or acceptance. Logs: `.local/capture-npm-test.log`, `.local/capture-arm-recheck.log`, `.local/capture-npm-test-recheck.log`. The new targeted capture test also passed independently. No production `src/` files were changed.
