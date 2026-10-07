# CANN 交付 A/B 收尾与输出保存修复

2026-10-07。**当前 `delivery-evidence` Skill 已标记为未采用**，后续默认使用原有 Codex 工作方式，加确定性检查器。[状态说明](D:/Projects/Legion-reviewer-fix/scripts/reviewer/delivery-evidence/README.md) 与实验 Skill 分开保存，`SKILL.md` 的实验字节及 SHA 不变；没有安装全局或项目默认 Skill。本轮没有调用模型、提交 CANN 或重跑 A/B。

已读取并保留[原实验报告](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-report.md)、[固定条件](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-conditions.json)和[逐次结果索引](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-results.jsonl)。新增[收尾记录](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-closeout.json)保存统一重算、异常归属和验证结果；原条件、索引、grade、checkpoint、轨迹及恢复件未被改写。原报告仅追加收尾说明，追加前副本另存于本机收尾归档。

异常的准确身份为 **`complete-r03-B / attempt-2`**，session 为 `01a114df-148e-7832-9c53-90b376a6aafd`。它是固定条件 `order` 中**正式第四次运行的一次允许补交**，不是额外诊断或第五次运行。事后从 stdout 提取恢复件没有启动会话，也不构成一次补交。以下三种口径分别记录，不能用其中一种替代另外两种：

| 正式第四次运行 | 内容合格 | 预算合规 | 原流程交付完成 |
| --- | --- | --- | --- |
| `attempt-1` 首次交付 | 是，修正引用误报后 18/18 | 是；累计 358,986 token | 是，首次文件与冻结副本仍在 |
| `attempt-2` 唯一补交 | 是，原流式最终 JSON 的事后恢复件为 18/18 | 否；累计 543,176，比 500,000 超出 43,176；墙钟 427.181 秒仍在 600 秒内 | 否；模型有 `turn.completed`，宿主为 cancelled，指定交付文件没有落盘 |

这项澄清不把异常补交算作按协议完成，也不抹去仍有效的首次交付。原 `summary.control_compliant=true` 只表示当时的 Skill/范围检查通过，不代表预算合规。原文件缺失评分中的“18 项可避免缺证”是文件级占位结果，不是恢复文本有 18 个事实错误。正式实验仍为 4 个新会话、8 次尝试、7 份按原流程落盘的交付文件。

本轮对四份 `attempt-1/frozen/delivery.json` 使用当前同一个确定性评分器逐一重算，先核对各自 SHA 与原索引一致。评分器 SHA256 为 `2e4b46d6c5222ddd4546a30e7b08bfaeee2004ff2a7fe810d393cdf48559d558`。四份均为 18/18、零可避免缺证、零错误或无依据结论，并逐项等于原索引中的 `posthoc_reference_grade` 及已有 `reference-recheck.json`。重算结果存于收尾 JSON 的 `uniform_first_output_regrade`，没有覆盖原 v1 评分或重新反馈。

| 首次冻结输出 | 统一重算 | 与原事后复核一致 |
| --- | --- | --- |
| `pending-iter1-A` | 18/18，合格 | 是 |
| `complete-r03-A` | 18/18，合格 | 是 |
| `pending-iter1-B` | 18/18，合格 | 是 |
| `complete-r03-B` | 18/18，合格 | 是 |

故障发生在宿主 Worker 的输出保存边界。原运行入口把目标文件交给 CLI 的 `--output-last-message`，预算轮询发现累计用量达到阈值后调用 `AbortController.abort()`，进程层在 Windows 使用 `taskkill /T /F` 终止进程树。原 stdout 已留存完整最终消息和 `turn.completed`，execution 为 cancelled，但目标文件不存在。原 `runWorker` 只解析 stdout 并写 `result.json`，没有为 CLI 尚未写出的目标文件补存；实验层又仅按目标文件是否存在决定能否冻结、判分，因而把已收到的内容当成没有交付文件。可以确认的宿主缺陷是这个保存缺口；不需要假定模型没生成结果或把进程异常忽略掉。

修复位于 [worker-pool.ts](D:/Projects/Legion-reviewer-fix/src/worker-pool.ts)：保留已有汇总文本，同时单独记录最后一条完整 `agent_message` 为 `finalText`；只有收到 `turn.completed` 才在 CLI 目标文件缺失时独占创建该文件。不会把 commentary 拼进 JSON，不覆盖已存在的 CLI 文件，不把 cancelled/timeout/error 升格为 completed。`result.json` 继续保存 usage、terminalEvent、进程退出状态和错误信息，并增加 `outputPersistence` 来源状态；补存本身失败时也记录错误及已收到的正文，正常进程的宿主结果变为 error，不能静默成功。

[CANN 状态判定](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-delivery-status.ts)被实际[运行入口](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-delivery-ab.mjs)调用，分别保存 `content_qualified`、`budget_compliant`、`delivery_completed`、`evidence_saved`。终态 usage 与轮询累计量取不倒退的可确认值，input+output 计数不额外累加 cached input 或 reasoning。达到上限后先保存、冻结已有证据，再停止补交和该实验入口的后续模型调度；即使进程返回 completed，也不能因内容通过就忽略超预算。未知用量不会被当作预算合规。

预算仍为每会话 500,000 input+output token、600 秒、最多一次反馈补交；原 500 ms 轮询和终止机制没有放宽。此修复保住已收到的输出，并如实判定超限；它不宣称事件式监测已成为逐 token 硬上限。恢复文件存在也不表示取消的宿主交付完成。没有在原异常目录补写 `delivery.json`，历史结果保持原状。

两条要求的回归通过实际 `runWorker` 路径执行 Node 模拟进程，没有运行 Codex 可执行程序或发出模型请求。模拟进程发出 commentary、最终 JSON、终态 usage 和 stderr；取消场景在完整终态事件已落盘后保持进程存活，再触发取消，复现保存窗口。这里的 token 数值是模拟返回字段，不是新增模型消耗。

| 离线回归路径 | 验证结果 |
| --- | --- |
| 正常完成 | CLI 原交付字节保持不变；宿主 completed，`turn.completed`、usage、诊断及 `result.json` 正确保存；206,062 token，预算合规，交付完成。 |
| 超预算返回 | 分别模拟“进程正常退出”和“终态后被取消”：缺失的目标文件均从最终消息保存，usage 为 543,176，预算不合规；即使内容需要修复，也不再调用一次。取消场景继续保持 cancelled、原退出信息与交付未完成；正常退出场景的交付保存与预算失败分别记录。 |

另覆盖补存写文件失败、恰好达到 500,000 时停止、600 秒超限、用量未知、至多一次补交和旧轮询值不能掩盖新的终态用量。见 [回归代码](D:/Projects/Legion-reviewer-fix/tests/cann-delivery-evidence.test.ts)。包含现有 Worker、进程、交付与 reviewer 回归共 **44/44 通过**，`npm run typecheck` 通过，运行脚本语法检查通过。[TAP 原记录](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-closeout-20261007/regression.tap)及[类型检查记录](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-closeout-20261007/typecheck.log)保存在独立收尾目录。这些开发回归不计入正式 A/B 样本。

本轮[代码差异](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-closeout-20261007/code-changes.patch)以收尾开始时的副本为基线，包含 Worker 补存、预算/交付分离、停止调度及离线测试；没有提交 Git commit。[原证据哈希清单](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-closeout-20261007/original-evidence-sha256.json)覆盖 278 个已有归档和条件、索引、Skill 文件，收尾前后均一致。

当前决定保持为“Skill 未采用，默认 Codex 加确定性检查器”。已修复的具体问题是终态已到达、CLI 文件未落盘时宿主缺少补存。内容合格不能抵消预算违规，保存恢复件也不能改写历史交付完成状态。本轮到此结束，不安排下一轮。
