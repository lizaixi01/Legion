# CANN 交付证据 Skill：首轮离线 A/B

2026-10-07，实验 `cann-delivery-ab-20261007`。**本轮未观察到 Skill 对首次交付可靠性的增益，建议停止推广当前版本。** 两个材料包各执行 A/B，共 4 个独立会话；全部已冻结，没有安排下一轮。统一修正评分器的引用误报后，A、B 首次交付均为 2/2 合格，均无可避免缺证或错误、无依据结论；B 的首次 token 分别增加 14.6% 和 37.3%。这是两对样本的描述性结果，不能证明 Skill 在其他任务中无效。

本轮有两项实质限制：原评分器误拒绝合法的 `inventory.json` 引用，导致四次本来合格的首次交付都收到补交反馈；最后一个 B 的 token 监测在用量事件到达后才取消进程，实际超过 500,000 上限。修正后的合格率属于**事后复核**，不是原预注册评分。完整运行的补交和成本比较受到这些执行缺陷影响。

审计依据为既有 [cann-baseline-audit.md](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-baseline-audit.md) 与 [cann-runs.jsonl](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-runs.jsonl)。本轮固定条件见 [conditions](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-conditions.json)，8 次尝试的原始评分、事后评分、token、交付 SHA 和证据路径见 [results.jsonl](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-results.jsonl)。所有原始材料、会话、输出与反馈保存在 [实验归档](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/results.json)。`.runs` 为本机忽略目录，不随 Git 自动分发；上述 JSONL 提供绝对路径索引。

文件清单已完全交给脚本。两个包分别只有 19、18 个普通材料文件，单文件均小于 4 MiB，输入范围封闭，因此文件枚举、字节数、SHA256、路径和 JSON Pointer 有效性都能确定性处理；没有要求模型重建清单。[公开检查器](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-evidence-check.py) 还负责源码与上传内容对比、逐点结果解析及按 submission ID 匹配分数。[最小 Skill](D:/Projects/Legion-reviewer-fix/scripts/reviewer/delivery-evidence/SKILL.md) 仅要求执行器关联“源码→上传源码→提交→逐点结果→官方分数”、区分生成者与 reviewer、复查未知与引用、说明冲突和阻塞范围。没有安装全局 Skill，也没有增加 MCP、Plugin 或产品功能。

运行入口复用了 `src/worker-pool.ts` 的 `runWorker`、`src/process.ts` 的进程控制，以及 `src/challenge.ts` 的 `snapshotOutputs/hashOutputs`。离线解析复用 CANN `evaluate.py` 中原有的 `matched_rank`、`verify_unit_script`、`parse_result` 等纯函数，由 AST 提取到只读工具副本，未初始化平台适配器。新增内容限定为上述 Skill、[材料准备与判分脚本](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-delivery-ab.py)、[本轮运行脚本](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-delivery-ab.mjs)、公开检查器和实验记录。

两个包均来自真实历史记录，没有人工删除文件的故障注入。包内角色文件名和通用验收提示较明确，降低了检索与关联难度；本轮测量的是这种已整理材料上的增量价值。

| 材料包 | 时间切片及内容 | 可取得与缺失证据 |
| --- | --- | --- |
| `complete-r03` | `adaptive-r03-input-prefetch-20261004` 的终态记录；候选源码、上传内容、原始逐点结果、对应排行榜、父版本源码与结果、生成者 invocation、提交回执、题目和单位脚本 | 18 字段全部可取得。目标 `6ac2635c694b590c3cebe1d8`，Pass 15/15，官方 28.87；父目标 `6ac24360694b590c3cd7abee`，官方 26.89。 |
| `pending-iter1` | `iter1-cache8192-20261004/observations/submission-000001.json` 的首次不可变 Running 详情；对应提交回执、源码与上传内容、生成者 invocation、父 v2-baseline 终态及背景材料 | 12 字段可取得，6 字段在该切片真正缺失。目标 `6ac234bf694b590c3cce5152` 已接收，`result=[]`；父目标 `6ac20d72694b590c3cb6f68f`，官方 26.06。 |

`pending-iter1` 测试历史非终态交付。完整本机项目后来已有该提交的 Pass、26.64 记录，但这些未来观测不属于此次切片；这不是“当前项目永久缺证”，也不是把完整包中的结果人为删掉后宣称自然故障。切片来源由原 `reports/000001.json` 对第一份 observation 的引用确认。逐文件原路径、字节数与 SHA 分别保存在 [完整包来源表](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/complete-r03-origins.json) 和 [非终态包来源表](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/pending-iter1-origins.json)。

包内没有提供先前审计报告、完成的交付报告、`delivery.json`、派生的 evaluator `report.json`、最终 incumbent 决策或判分答案。保留原始平台回执与提交前身份记录。隐藏的逐字段答案及支持证据集合保存在执行目录之外：[完整包 oracle](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/complete-r03-oracle.json)、[非终态包 oracle](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/pending-iter1-oracle.json)。

各字段必须包含值、`verified/unknown/conflict` 状态、文件及定位引用、解释。下表为启动前固定的判分依据；SHA 表示源码字节哈希，不是包清单或交付文件哈希，完整 64 位值保存在 oracle。

| 字段 | `complete-r03` 预期 | `pending-iter1` 预期 | 证据依据 |
| --- | --- | --- | --- |
| `candidate_sha256` | `5a216459…1f8d53`，可取得 | `c32ba10c…b467`，可取得 | 实际候选 `kernel.asc` 字节 |
| `parent_sha256` | `6864d678…39dc`，可取得 | `b53ee765…f2b5c`，可取得 | 实际父 `kernel.asc` 字节 |
| `submission_id` | `6ac2635c694b590c3cebe1d8`，可取得 | `6ac234bf694b590c3cce5152`，可取得 | 目标详情 `_id`，与回执关联 |
| `parent_submission_id` | `6ac24360694b590c3cd7abee`，可取得 | `6ac20d72694b590c3cb6f68f`，可取得 | 父详情 `_id` |
| `source_matches_submission` | true，可取得 | true，可取得 | 本地源码与该提交上传内容哈希相等 |
| `generator_model` | `gpt-6-sol`，可取得 | `gpt-6.1-sol`，可取得 | 历史生成者 invocation，不是本轮执行器或 reviewer |
| `generator_effort` | high，可取得 | xhigh，可取得 | 同一生成者 invocation |
| `platform_status` | Pass，可取得 | Running，可取得 | 切片内目标详情状态 |
| `observed_case_count` | 15，可取得 | 0，可取得 | 原始 `result` 实际长度 |
| `final_passed_cases` | 15，可取得 | 未知，真正缺失 | 目标终态及精度；空数组不能当最终 0/15 |
| `cases_final` | 完整 15 点数组，可取得 | 未知，真正缺失 | 每点 ID、状态、precision_ratio、time_us、best_time_us，逐值比对 |
| `time_unit` | us，可取得 | us，可取得 | 已缓存前端单位转换脚本 |
| `official_total_score` | 28.87，可取得 | 未知，真正缺失 | 与目标 ID 匹配的官方排行榜行；禁止借用父分数、theory_score 或单点分数 |
| `score_higher_is_better` | true，可取得 | true，可取得 | 原题评分规则 |
| `unique_target_submissions` | 1，可取得 | 1，可取得 | 目标 ID 去重；Running 不等于未提交，父版本不计入 |
| `faster_cases_than_parent` | 5，可取得 | 未知，真正缺失 | 按 testcase ID 对齐后的严格耗时比较 |
| `slower_cases_than_parent` | 10，可取得 | 未知，真正缺失 | 同上，0 点相等 |
| `selection_recommendation` | replace，可取得 | 未知，真正缺失 | 源码关联、15/15、双方分数及父结果齐备后，按本次分数比较；不声称稳定提速 |

18 字段全正确、可取得证据被引用、真实缺口准确说明才合格。缺失可取得字段或把它无依据地标为未知，计“可避免缺证”；错值、错候选、错误引用或缺乏支持，计“错误或无依据结论”。真实缺证准确标为未知不扣分。完整包应为 `delivery_status=complete/result_verified=true`；非终态包应为 `blocked/false`，且准确列出六项缺口。两者均须 `host_accepted=false`，离线材料核验不能授予 Legion 宿主 accepted。结构化字段由确定性评分器核对，解释、边界及是否作出相矛盾的额外声明另经轨迹和交付全文审阅。

每次先冻结首次 `delivery.json` 及 SHA，再评分。不合格时只反馈失败字段名和错误码，不给答案或新材料；最多一轮完整补交，此后或触及预算即停止。评分与反馈逻辑在四次执行期间完全相同。预先保留标准为：B 修复 A 中实际观察到的可靠性错误，不引入新错误，token 增幅不超过 20%；否则修改或停止。

| 控制项 | 实际固定条件与核实方式 |
| --- | --- |
| 模型及 effort | 四个新会话均为 `gpt-6.1-sol / xhigh`，从各原始 rollout 的 `turn_context` 核实 |
| 执行器 | 本机 Codex CLI `0.159.2`；启动前 `--version` 及四个 `session_meta.cli_version` 一致；Node `v24.15.0` |
| 工具与权限 | 相同公开工具、schema、通用提示；CLI read-only、approval never、agents=0、plugins disabled、ignore-user-config、ignore-rules；相同 Windows sandbox 配置 |
| 服务层级 | 默认；实际 service tier 未确认，两组均不额外指定 |
| A/B 差异 | A 不读取目标 Skill；B 提示显式调用并实际读取包内 `skill/SKILL.md`，其 token 计入总量 |
| 独立性 | 每个材料包的 A/B 内容逐字节相同；B 多一份 Skill。四个独立工作目录与四个新 session；仅补交 resume 本组原 session |
| 预算 | 每会话首次加补交共 600 秒、500,000 input+output token；含 cached input，reasoning 是 output 子集，不重复累加；本轮 token 控制有一次超限，详见下文 |
| 顺序 | 固定种子 `1087896737` 得到：pending-A → complete-A → pending-B → complete-B；无运行中改序 |
| 人工参与 | 人工准备包、oracle、规则及离线复核；执行期间未向某一组补背景、答案或定制建议，反馈由同一脚本生成 |

完整配置、调用参数、运行脚本及复用入口 SHA 在 [runner-lock](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/runner-lock.json) 与各 attempt 的 `invocation.json` 中。两次 B 的首次轨迹均在 `item_1` 成功执行 `Get-Content -LiteralPath 'skill/SKILL.md' -Raw`，工具输出包含完整 Skill 正文；A 无目标 Skill 读取。B 的非终态补交还再次读取 Skill，这些消耗同样计入。

隔离由独立目录、只读输入、CLI read-only、明确的范围指令及事后逐命令审计组成。本轮未增加 OS 级文件读取白名单，不能把“未观察到越界”表述成内核强制读隔离。审计未发现读取另一组、oracle、先前报告、原项目未来记录或调用平台的命令；允许的外部路径仅用于既定 Python/PowerShell 运行时。材料中的原路径信息没有被用于回访源项目。

四次首次交付均已保存。计数和成绩有两套口径，不能混用：

| 首次交付判分口径 | A | B | 含义 |
| --- | --- | --- | --- |
| 执行时冻结的 v1 评分 | 0/2 合格；分别 16/18、17/18 字段 | 0/2 合格；均 17/18 字段 | 合法清单引用被误拒绝，四次均触发一次反馈 |
| 全部运行停止后的统一引用复核 | 2/2 合格；均 18/18 | 2/2 合格；均 18/18 | 仅修复合法 `inventory.json` 引用的允许集合；事后结果 |
| 复核后的可避免缺证 | 0 | 0 | 非终态包六项真实缺口均准确标为未知 |
| 复核后的错误或无依据结论 | 0 | 0 | 未混淆生成者、候选 ID、父分数、空结果或宿主状态 |

v1 允许引用清单内的材料文件，却漏掉了清单自身。pending-A 在 `platform_status`、`unique_target_submissions` 上额外引用它，其他三个首次交付在提交计数上引用它；相关原始回执引用和值同时正确。第一次误报和反馈已发生后发现此缺陷，为维持四次执行的同一评分与反馈条件，后续运行仍使用原 v1。全部冻结后才把合法引用集合加上 `inventory.json`，对所有留存交付统一重算，未修改预期值、支持材料要求或模型答案，未重发反馈。原 [v1 评分器快照](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/grader-used.py)、各 `grade.json` 与 `feedback.txt` 均保留；事后结果另存 `reference-recheck.json`。

首次成本均在预算内，以下 token 是实际会话 input+output 累计数，含缓存读取，并非账单金额。耗时为执行入口记录的首次 duration；命令数来自 `stdout.jsonl` 的完成事件。

| 包 / 组 | 首次 input | 首次 output | 其中 cached input | 首次总 token | 首次秒数 | 命令数 / 非零退出 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pending / A | 198,912 | 7,150 | 159,360 | 206,062 | 192.426 | 26 / 1 |
| pending / B | 229,603 | 6,496 | 184,960 | 236,099 | 185.470 | 25 / 2 |
| complete / A | 252,127 | 9,336 | 205,312 | 261,463 | 244.693 | 28 / 1 |
| complete / B | 348,784 | 10,202 | 277,376 | 358,986 | 312.844 | 56 / 1 |

pending 的 B 首次 token 比 A 增加 14.6%，耗时减少 3.6%；complete 的 B 增加 37.3%，耗时增加 27.9%，超过预先的 20% token 成本容忍线。四次首次合计 1,062,610 token。没有重复抽样，顺序固定且缓存有波动，不能把耗时差异或全部额外 token 精确归因于 Skill 文本本身。

| 运行 ID | 补交轮次 | 补交新增 token | 全会话 token | 全流程秒数 | 冻结时状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| `pending-iter1-A` | 1 | 90,883 | 296,945 | 272.939 | 首次和补交文件均落盘；补交 v1 与复核均合格 |
| `complete-r03-A` | 1 | 113,756 | 375,219 | 345.142 | 首次和补交文件均落盘；补交 v1 与复核均合格 |
| `pending-iter1-B` | 1 | 102,579 | 338,678 | 263.633 | 首次和补交文件均落盘；补交 v1 与复核均合格 |
| `complete-r03-B` | 1 | 184,190 | 543,176 | 427.181 | 模型补交 turn 完成；宿主被取消、补交文件未落盘；token 超限 |

四次反馈都由评分器误报造成，不代表模型首次交付真的需要修正。不能用这些补交次数证明 A 或 B 的可靠性较差。全会话 B 相对 A 的 token 增幅为 14.1%、44.8%，但该比较受错误反馈及最后一次取消影响。8 次尝试的终态 token 事件合计 **1,554,018**，4 个会话，8 个模型 turn 完成，7 份按原流程落盘的交付 JSON；补交不是额外独立样本。

token 控制器每 500 ms 检查 session 用量事件，属于收到累计事件后取消，未实现逐 token 硬封顶。complete-B 的补交更新到 543,176 时才停止，超出上限 **43,176（8.6%）**，因此本轮不满足“四次都严格遵守 token 上限”。四次墙钟时间均低于 600 秒。原 `summary.control_compliant` 只检查 Skill/范围，不能视为预算合规；分析表和逐次记录另列预算结果。

对最后一次补交进一步检查发现，原 stdout 已有完整的 `item_6` JSON 和 `turn.completed`，后者与 rollout 均报告 input 528,005、output 15,171。故 543,176 是已确认终态用量，不是根据中断猜测的下限；进程退出为 cancelled，指定 `delivery.json` 不存在。运行冻结后才从原流式文本逐字提取 [恢复件](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-2/forensic-recovered-delivery.json)，其内容复核为 18/18，来源哈希及“不计作合规补交”标记见 [恢复记录](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-2/forensic-recovery.json)。没有补造原输出文件、改原 checkpoint 或增加模型调用。原评分器给“文件缺失”机械记的 18 项可避免缺证，也不被当作 18 个语义错误。

Skill 可观察的行为变化主要发生在交付前自查。A 已能借助清单、源码比对及解析器正确完成关联；B 先读取 Skill，再执行类似流程。complete-B 在已批量解析目标与父结果后，`item_33` 至 `item_58` 又逐个读取身份、回执 ID、生成模型/effort、上传源码、结果与排行榜 Pointer，其中回执 ID、结果及分数等先前已读取。其首次共 56 条命令，A 为 28 条；轨迹中还明确说正在检查字段格式和证据引用。该行为与 Skill 的“交付前逐一复查已验证断言”一致，但这两对样本不足以确认它是全部成本差异的唯一原因。pending-B 命令数反而少一条，未出现普遍的翻倍现象。

没有找到 B 修复 A 实际错误的证据：A 首次已正确区分 0 个观测点与未知的最终结果，正确识别模型角色和真实缺口，并保留了已提交 ID。B 未新增事实错误，但增加了读取和自查成本。B 和 A 都受同一评分器缺陷影响，Skill 没有避免无效反馈。

公共工具还有一个共同缺陷：Windows 默认 GBK 输出导致读取题目 JSON 时 `UnicodeEncodeError`，四次首次都遇到并自行用 UTF-8 恢复；部分轨迹还处理了 PowerShell JSON 键大小写冲突。它们不构成 Skill 修复 A 的证据。全部执行停止后才在公开检查器固定 UTF-8 stdout，并完成强制 GBK 环境回归；包及执行目录内仍保留实际使用的 v1 工具，不改历史输入。

原始交付、补交和轨迹可直接复查如下。每个 attempt 目录还保存完整 prompt、invocation、process/execution/result、stderr、rollout、原 grade 和 checkpoint；每个 run 保存标准化反馈和逐命令范围审计。

| 运行 / 新会话 ID | 首次交付与轨迹 | 一次反馈后的记录 |
| --- | --- | --- |
| pending-A / `01a114d1-9fef-76f3-8033-f89a3f1a96ee` | [交付](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-A/attempt-1/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-A/attempt-1/stdout.jsonl) | [反馈](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-A/feedback.txt)、[补交](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-A/attempt-2/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-A/attempt-2/stdout.jsonl) |
| complete-A / `01a114d5-ca06-72c2-9b82-fc877052f241` | [交付](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-A/attempt-1/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-A/attempt-1/stdout.jsonl) | [反馈](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-A/feedback.txt)、[补交](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-A/attempt-2/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-A/attempt-2/stdout.jsonl) |
| pending-B / `01a114db-0e81-7810-973c-ec92d063623f` | [交付](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-B/attempt-1/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-B/attempt-1/stdout.jsonl) | [反馈](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-B/feedback.txt)、[补交](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-B/attempt-2/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/pending-iter1-B/attempt-2/stdout.jsonl) |
| complete-B / `01a114df-148e-7832-9c53-90b376a6aafd` | [交付](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-1/delivery.json)、[轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-1/stdout.jsonl) | [反馈](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/feedback.txt)、[取消状态](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-2/execution.json)、[含完整补交文本的原轨迹](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/runs/complete-r03-B/attempt-2/stdout.jsonl) |

验证包括启动前 9 项离线自检（正确交付、无引用哈希、借用父分数、源码上传一致性和原解析器），现有进程与 Codex 测试 11/11、Skill 格式验证、运行脚本语法检查。修正评分器后，两个包的合法清单引用均通过，无效 Pointer、缺引用哈希和借父分数均继续被拒绝；[事后检查记录](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/control/postfreeze-checks.json) 保存原/新工具哈希及回归结果。这些检查没有启动新模型或平台评测。

[完整性记录](D:/Projects/Legion-reviewer-fix/.runs/cann-delivery-ab-20261007/integrity.json) 确认读取的 36 个原始来源文件 SHA 均未变化；四个工作目录中的全部材料、清单、工具与 Skill 副本也保持不变。没有修改 kernel，没有 CANN 平台新提交，没有重新优化算子；原始平台 Pass/Running 是历史证据，不是本轮新测结果。本轮的首次交付合格也只表示材料交付规范合格。

本轮对四个问题的回答是：

- **Skill 改变了哪一步：** 可确认 B 实际读取 Skill；完整包 B 在交付前增加了逐字段、逐引用复查，部分与已完成的批量解析重复。
- **是否修复 A 的错误：** 没有。A 的两份首次交付经统一复核均正确；原来的失败来自评分器允许集合遗漏。
- **是否产生新错误或成本：** 未观察到新事实错误；首次 token 增加 14.6%/37.3%，完整包超出预设成本容忍线。补交阶段还暴露了事件式预算监测超限、模型 turn 完成但宿主未落盘的区别，这属于实验执行缺陷，不能全归因于 Skill。
- **保留、修改还是停止：** 停止推广当前 Skill，保留冻结版本用于复查，保留确定性清单和检查器。当前证据支持“在这两个整理好的包上没有增益且增加成本”，不支持推广为默认流程，不支持断言所有 Skill 无效，也不支持外推到无整理原仓库、reviewer 超时或完整算子优化。若以后继续研究，优先解决评分器与预算/落盘观测的可信性，再重新定义是否需要更窄的语义 Skill；本轮到此停止，不安排下一轮。

2026-10-07 收尾补充：Skill 已明确标记为**未采用**，默认继续使用原有 Codex 工作方式加确定性检查器。异常 `complete-r03-B / attempt-2` 属于正式第四次运行的一次补交，不是额外诊断；其内容合格、预算不合规、原宿主交付未完成。四份首次冻结输出已再次用同一修正版评分器重算，均为 18/18。输出保存缺口已在 Worker 层修复并通过离线模拟回归，未调用模型或重跑 A/B，也未补造历史缺失文件。详见[收尾说明、代码差异与回归结果](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-closeout.md)和[结构化收尾记录](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-delivery-ab-closeout.json)。原报告正文和原始实验记录保留。
