# HWE 本机对照

批次状态：pair incomplete。普通组（batch-2，2026-09-29）完成且有效；管理组两次尝试均因模型传输 502 基础设施中断而未完成（首次为日志解析误报、已修复；补跑为真实传输中断，Manager 请求被 300 秒时限截断）。首次尝试（2026-09-28）因用量上限中断。结果均按规则保留，不重跑择优。

| 组别 | 外部检查 | iter/s | MHz | LUT4 | 总 token | 墙钟分钟 |
|---|---|---:|---:|---:|---:|---:|
| 普通 Codex（batch-2） | 通过 | 45.46 | 20.42 | 10,227 | 988,781 | 46.2 |
| Management＋Subagent（batch-2） | 未完成（传输中断） | — | — | — | 122,186 | 5.1 |
| baseline（冻结，参考） | 通过 | 30.79 | 13.83 | 13,964 | — | — |

组间差异无法计算：管理组没有产生测量。单任务各一次不能推断普遍成功率或证明十倍效率提升。

## 第二次尝试记录（2026-09-29，batch-2）

配置：普通组 GPT-6 Sol/medium、单会话、禁用原生 SubAgent、实现上限 1,800 秒；管理组 Manager GPT-6 Sol/high、Worker GPT-6 Sol/medium、最多 2 轮 / 4 次 Worker、并发 2、每 Worker 上限 1,800 秒；外部验证器不计为 SubAgent。启动前额度预检通过（用量已记录），环境指纹与 `ready.json` 一致（复用 readiness，未重跑基线）。批次 `hwe-comparison-batch-2` 保存了配置、40 项实现哈希与环境指纹；宿主截止时间 `2026-09-29T13:11:55Z`。

普通组 `.runs/ordinary-6d8a4231-86de-4f97-bd18-90cfd1e24410`：

- 完成；候选外部检查通过（`verified`，`eligible`）。Worker 1 次，达到 1800 秒上限（`timedOut`），提交快照经外部验证通过。
- 指标：CoreMark iter/s 45.46，Fmax 20.42 MHz，LUT4 10,227，周期 4,491,485；三 seed 20.42 / 19.81 / 20.44 MHz。
- 相对冻结 baseline：iter/s +47.6%、Fmax +47.6%、LUT4 −26.8%，周期不变。
- token：输入 984,792（其中缓存 928,384）/ 输出 3,989；总 988,781。墙钟 46.2 分钟。

管理组 `.runs/run-29b42a68-aa37-4be4-8c31-462f5995ecd4`：

- **未完成**。首个 Manager 调用因模型传输 `502 Model transport failed` 失败，属**传输类基础设施中断**。
- 0 次 Worker 调用，无候选，无外部测量。
- token：Manager 输入 119,062（其中缓存 84,480）/ 输出 3,124；Worker 0。墙钟 5.1 分钟。
- 按协议保存日志、停止队列、**不自动重跑**；不计为解题失败，也不从总成本中抹去。

未覆盖的验证范围：两组都只覆盖公开 lint、编译、Verilator 构建、ISS/CRC cosim、bounded ALTOPS formal、综合与三 seed nextpnr 频率估计；管理组无任何测量。ALTOPS 不是乘除法完整证明，CoreMark 与两个 cosim 程序不是穷尽测试，频率是布局布线估计。

额外成本（无可比管理结果）：预检 9,532 + 管理组 Manager 调用 122,186 = **131,718 token**，保留在总成本记录中。

运行记录位置：普通组与管理组运行目录见上；批次 `.local/hwe-comparison-batch-2/`（`config.json`、`implementation-hashes.json`、`environment.json`、`launch.json`、`result.json`）；预检 `.local/hwe-precheck-2026-09-29T07-09-19-539Z/`；首次中断证据 `.local/hwe-interrupted-2026-09-28/`。人工解题介入：0 次。基础设施中断：普通组 Worker 经历瞬时 502（重连后恢复，不影响结果）；管理组首个 Manager 调用被 502 中断（本臂未完成）。

## 管理组 502 排查与补跑（2026-09-29）

排查结论：batch-2 管理组的首个 Manager 调用**其实成功产出决策**（`turn.completed`、`worker.snapshot {timedOut:false, exitCode:0}`、`response.json` 完整），并非 300 秒超时（实际 292.6 秒）。真实原因是日志解析把**可恢复的重连提示** `{"type":"error","message":"Reconnecting... 1/5 ... 502"}` 误判为终止失败，丢弃了成功决策。

基础设施修复（仅日志解析；未动解题提示、模型、推理强度、预算、并发上限或验证规则）：`src/codex.ts` 的 `parseCodexLog` 现在只有 `turn.failed` 计为终止失败，`error` 提示仅在回合未完成时作为失败原因。回归测试见 `tests/codex.test.ts`（瞬时重连提示不再使已完成回合失败；未完成时仍保留原因）；99 项测试、类型检查与构建通过。可比性不受影响，记录见 `.local/hwe-comparison-batch-2/fix-2026-09-29.json`。

补跑（新运行，从冻结 baseline 开始，不读取普通组结果/实现/旧候选/开发试跑）：`.runs/research-0fc0792d-5114-4a4d-be49-874ba5c5a036`，08:16:04 → 08:21:55，`status=error`。这次是**真实的传输中断**——上游持续 502（`proxy_error URLError`），Manager 请求被 **300 秒时限截断**（`worker.snapshot {timedOut:true}`，无 `turn.completed`，无 `response.json`），0 次 Worker 调用。按规则这是**本次唯一允许的补跑**，再度出现终止性基础设施故障即停止，不循环重跑。

- batch-2 Manager（首次，属误报）：token 输入 119,062（缓存 84,480）/ 输出 3,124；墙钟 5.1 分钟。
- 补跑 Manager：观测 token 输入 33,509（缓存 20,864）/ 输出 472（因无 `turn.completed`，汇总记 0 条记录）；墙钟 5.85 分钟。
- 预检：9,532 token。
- **累计成本（含此前中断）：9,532（预检）+ 988,781（普通组）+ 122,186（batch-2 Manager）+ 33,981（补跑 Manager）= 1,154,480 token**；墙钟：普通组 46.2 分钟，管理组两次尝试合计约 11.0 分钟。

管理组仍无测量结果；本次为基础设施中断后的补跑，不改变对照结论。

## 首次中断记录（2026-09-28）

- 顺序 `ordinary → run → native`，硬截止 `2026-09-29T00:05:00Z`；解题人工介入 0 次。
- 普通组 `.runs/ordinary-26f54b5c-9326-494a-b09d-2ef2fae2ce3a`：18:34:45 → 18:48:58，进程 `exitCode 0`，但候选 `status=error`、`eligible=false`（评测尚未完成即触发额度上限）。
- 管理组 `.runs/research-1cacd568-6b3b-43e1-a79f-50d3364fb320`：18:48:58 → 18:49:29，`exitCode 1`，首个 Manager 调用因额度耗尽失败。
- 官方参考组未运行。
- 中断由用量上限（429）引起，属于**基础设施中断，不构成解题失败**，也不用于推断成功率。
- 队列当时未在普通组后停止：`parseCodexLog` 丢弃了错误消息导致额度错误无法分类，且 `ordinary`/`native` 分支不设置非零退出码、报告无顶层 `status`。已修复，详见 [当前开发范围](implementation-status.md)。
- 原始证据冻结在 `.local/hwe-interrupted-2026-09-28/`（含哈希清单与中断说明 `RECORD.md`）。

## 恢复方案

要得到**可比的完整一对**，需在同一新批次内让两组各自完成一次有效运行；上次为传输中断，因此须先确认模型传输稳定再启动。执行后端由用户选定，且两组必须使用同一后端、同一基线镜像与同一套公开检查。

1. 先确认模型传输稳定（可用一次记录用量的预检；持续 502 时不要启动正式组）。
2. 运行前自检：进入正式组前确认环境指纹与 `ready.json` 一致，一致则复用 readiness，不重跑基线。
3. 用**新的绝对截止时间**启动已受测队列（不复用过期批处理）：
   `npx tsx src/research-cli.ts comparison .local/hwe-comparison-config.json`
   任一臂基础设施失败即停止、退出码非零、不自动重跑。
4. 若仅管理臂因传输中断未完成，可在传输恢复并得到人工确认后，单独重跑管理臂（`... run .local/hwe-comparison-config.json`）并与 batch-2 的普通臂结果组成一对；仍在同一批次、同一基线/配置下。
5. 只向两个解题组提供公开 baseline 与公开检查；不传入开发试跑、先前候选或另一组的输出。
6. 两组各完成一次有效运行后填本表，并记录人工介入与全部成本。

## 解释范围

主对照允许管理组多用 token。两组实现模型均为 GPT-6 Sol/medium，Manager 单独使用 Sol/high；工具链、baseline 和外部验证一致。详见 [预定协议](hwe-comparison-protocol.md)。

质量数值仅在公开验证器范围内成立，且单任务、单次结果不能估计一般成功率或证明十倍效率提升。

人工介入：批处理记录中的解题干预为 0 次；环境准备、开发调试与正式运行分开记录。发生异常时保留日志并停止，不自动重跑择优。

批次证据：`.local/hwe-comparison-batch-2/`（本次）；`.local/hwe-comparison-batch/`（首次尝试）；首次中断证据 `.local/hwe-interrupted-2026-09-28/`。
