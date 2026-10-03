# HWE 微架构管理闭环

本阶段选择 FeSens/auto-arch-tournament 的 RV32IM baseline 优化任务。不是同名的硬件缺陷修复或电路原理图数据集。先在本机重复验证基线，再允许模型执行。

## 工作过程

1. Manager 根据目标、已验证基线、前轮测量和失败记录，返回结构化假设、父快照、实验方法、预期变化和执行时间。
2. 每个 Worker 获得单独 Docker 容器、独立 Codex 会话和父快照。只导出 RTL；REPORT.md 中的实验结论保留为未经独立确认的陈述。
3. 缺省保留本轮所有 Worker 收尾后验证的屏障；显式 `verificationScheduling=worker-ready` 则在 Worker 导出并确认快照哈希后立即入验证队列。两种模式均使用有界 Worker 队列与独立验证队列，本轮全部 Worker 和验证收尾后才进入下一次 Manager 决策。外部验证器从冻结参考环境重新创建容器，加载导出的 RTL，运行 lint、CoreMark 编译、Verilator 构建、ISS/CRC cosim、riscv-formal、综合和三种 seed 的 nextpnr。Worker 对检查脚本的修改不会进入这里。
4. 只有通过全部门槛且指标完整、有限的结果才可成为当前最佳。Manager 根据失败证据修复分支、提出新路线、淘汰分支、调整每个 Worker 的时间，或结束。程序限制总轮数、调用次数、并行度和总时间。

正确性范围是公开验证器的覆盖范围，不承诺“完美正确”。快速 formal 使用 ALTOPS，上游计数还可能包含 PREUNSAT，不能把数量直接当作非空证明覆盖；CoreMark CRC 不是任意程序的穷尽验证；Fmax 是 FPGA 布局布线时序估计，没有实物板卡测试。指标包括 CoreMark iter/s、Fmax、LUT4 和周期数，未通过者不参与排名。

## 隔离与记忆

- Manager 和 Worker 的模型/推理强度独立配置。当前运行后端为 Codex CLI，沿用本机登录；没有新增 API Key。
- Manager 单次决策窗口缺省为 900 秒，可在配置的 `manager.timeoutSeconds` 中设为 30–1800 秒；宿主调用留出最多 600 秒启动、落盘及清理余量。准备上下文所花时间先从剩余总预算扣除，实际调用上限不超过剩余时间，取消信号仍优先。缺省窗口沿用深度扩展实验中两组相同的超时修复；每次实际限制写入 `decision-invocation.json`。达到严格宿主截止时间时仍可能中断导出，取消的 30 秒兜底不延长总预算。
- 主会话保留目标和决策，Worker 保留独立上下文；候选之间不直接聊天。修复从指定源码快照开启新会话，附带相关外部证据，不把旧完整对话塞入新会话。
- `state.json` 保存结构化状态；`events.jsonl` 保留追加事件；每轮 `memory.json` 保存实际提供给 Manager 的精简记录。原始模型日志、REPORT.md 和验证日志单独留档。
- Worker 回报不能成为共享“事实”。共享事实来自固定验证器，带快照哈希和来源。Manager 在隔离容器中按需读取 `/manager-context` 的只读资料：原始 baseline、当前最佳已验证候选、直接父版本 RTL、版本身份、既有外部结果与指标副本，以及直接父子 diff。`/work/cores/baseline/rtl` 始终代表原始 baseline；best 为 baseline 时明确说明尚无候选改动。未通过检查的父版本仅作为改动来源，不禁止失败路线修复，也不提升为已验证候选。
- 每轮只传入上述相关版本，不挂载宿主运行根或其他试跑。决策调用前核对候选身份、快照哈希、实际路径与安全归档；异常按基础设施错误停止并保存 `manager-context-error.json`。只读目录的 `manifest.json` 和轮次目录的 `manager-context-receipt.json` 记录资料及哈希。源码、diff、Worker 报告和资料清单均不能自行认证；验收仍只认既有独立验证器。父快照使用前及验证前后仍校验摘要。
- Manager 与 Worker 容器均断网，只允许通过 Unix socket 访问模型代理；真实登录凭据保留在宿主。工具链只读挂载。Worker 各 2 CPU/3 GiB，每个独立重验证容器仍为 8 CPU/10 GiB；新 HWE 默认验证并发 2。
- 取消后清理该运行的容器与模型代理。进程意外退出时保留锁和证据；核实旧进程停止并处理锁后，可用 CLI resume 继续后续轮次。已分配的调用仍计入预算，不悄悄重跑取最好结果。

## 参考机制

- [Codex 子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)：独立上下文处理噪声较多的工作，主 Agent 接收摘要并集中决策；对并行写入保持谨慎。
- [Claude Code 子 Agent](https://code.claude.com/docs/en/sub-agents)：独立上下文、模型/工具配置，以及按项目限定范围的持久记忆。本项目把可验证事实与 Worker 自述进一步分开。
- [HWE 源码](https://github.com/FeSens/auto-arch-tournament)：复用其验证与性能测量，不沿用固定顺序择一的旧 ProgramBench 策略。

这些是借鉴的公开机制，不声称复制其内部实现。Claude Code 尚未作为这轮执行后端接入。

提供当前候选源码与父子改动是一项上下文传递优化假设。离线回归只确认版本、隔离和证据边界，不证明其提高性能或优于其他管理策略。

## 运行

在项目目录运行：

```powershell
npx tsx src/research-cli.ts preflight  # 只核对 readiness，不调用模型或评分器
npx tsx src/research-cli.ts readiness  # 首次安装或真实环境变化时才运行
npx tsx src/research-cli.ts run
npx tsx src/research-cli.ts resume <运行目录>
npm run desktop
```

GUI 不再提供独立的「微架构实验」任务页。HWE 通过普通主会话进行：用宿主 `tar` 把 RTL 打成扁平 `.tar.gz`，再调用 `legion_hwe_check` 跑冻结验证器，用 `legion_strategy` 记录假设、选择与淘汰。两者都登记 evidence id，选择只认未失效的 host 证据。不会用演示数据冒充完成的实验。

本机路径配置目前集中在 `src/hwe-runtime.ts`；工具链安装属于这台 WSL 环境。readiness 要连续两次完整通过且周期数、fitness 相同，才写 ready.json。启动时检查源码/验证器指纹和 Docker 镜像 ID；环境变化需重新执行 readiness。

## 验证并发配置与恢复

2026-10-03 增加独立 `allocationsPerRound`（1..4，每轮分配上限）与 `verificationScheduling`（round-barrier / worker-ready）。`concurrency` 继续表示 Worker 活跃上限，`verificationConcurrency` 仍仅允许 1、2。缺少新字段时分别按 concurrency 与 round-barrier 规范化；旧配置、旧状态和 CLI 新建缺省都不会静默开启流水线。保存状态仍 version 1，保持原配置字段形态；恢复比较的是所有有效字段，缺省与其显式等价值等价，改变分配数、Worker 上限或调度模式在任何清理/写入前拒绝。

Worker 分配先全部记账，随后有空位才按分配序启动下一项。worker-ready 从已就绪候选中按分配序派验证，不等待尚未完成的早序 Worker。普通拒绝继续排队；Worker 模型/导出失败、验证基础设施故障、父/子哈希异常或持久化故障停止两条队列的新派发，已启动工作收尾，导出及已有有效独立证据保留。取消和总预算独立分类，不把 Worker 自身时间上限结束且成功导出直接当硬件拒绝。workerTiming 与 worker_started/worker_returned 记录位置时序；验证时序沿用原字段。父快照在 Worker 前后核对，候选在验证前后核对。

恢复保持已消费分配，并增加 resumed=true 供评测排除完整公平样本；不会重发本轮排队或中断项。原有后续决策探索可继续，不能把它当无中断补跑。固定计划速度入口见 [实验协议](hwe-speed-experiment.md)，明确冻结 3×4 分配、A=2/B=4 Worker、两组验证=2 与共同 worker-ready 调度，不推广历史延伸策略，也不会因为没有提升自动停派。

认证只读入口支持 `preflight <认证目录>`，普通运行可设置 `PROACTIVE_HWE_READINESS_SOURCE`；缺省仍使用旧根目录。冻结工具复制完整认证源原字节并核对逐文件哈希，实际启动重新做只读认证和冻结输入门禁。自然匹配即可复用，不能修改 ready.json、伪造指纹或放宽质量门槛。

在既有研究配置 JSON 中设置 `"concurrency": 2, "verificationConcurrency": 2`，分别表示 Worker 与验证并发。验证目前只支持 1、2；设 1 即串行。未提供自定义配置的新 HWE 运行显式采用 2；自定义旧配置缺字段、通用调用缺字段及旧状态均按 1。不会将 HWE 新建缺省值合并到保存的任务中。

`resume <运行目录>` 使用保存的配置。有效配置经过规范化比较，缺字段与显式 1 等价，键顺序变化不影响恢复；从 1 改为 2、或将保存的 2 删除，都在任何清理和写入前拒绝。状态仍为 version 1，已分配 Worker、轮次和累计时间不补充；working/verifying 转为 interrupted，下一次显式恢复仅处理后续决策，不重试已有分配。

普通拒绝不会停止验证队列。检测到基础设施异常、验证超时、无效指标、快照修改或状态写入失败后停止派发，并等待已启动验证收尾；有效兄弟候选仍可交付。用户取消或总时限达到时向正在执行的验证传播取消，排队候选不再启动。所有并发任务收尾后，才调用该运行 owner 的清理并保存最终状态。清理失败和写入失败都会在状态及摘要中显示，且不抹去原候选失败证据。若磁盘一直不可写，只能在返回结果中报告最终检查点未保存。

快照前后哈希、HWE 完整检查分类和质量策略沿用现有机制；原始证据保留，宿主检测到的问题记入 `verification.error`。选优按 baseline 和原分配顺序作严格比较，同分保留先前候选，Manager 的记录顺序固定。给已通过但暂时落后的旧版本预留延伸机会属于评测层的条件策略，不写入产品默认策略；首对故障与授权恢复记录见文末。

候选的 `verification` 记录入队、开始、结束、排队和执行时长；`verification_started` 事件含快照身份、活动位置数与上限。执行时长包含位置内的哈希和开始记录落盘。每轮 `verificationBatches.wallMs` 为队列墙钟，`executionMsSum` 为可能重叠的任务耗时之和；摘要分别显示 `batchWallMsSum` 与 `executionMsSum`，旧记录缺少时序时为 null。两项不得互换。

范围为 research/HWE 候选循环；桌面 primary-agent 验证调度仍是另一条路径，未接入候选队列。共用 HWE 宿主调用现保留 timeout 分类，其工具链、验证规则和清理范围未变化。

## 固定候选的真实集成验收

**开发行为测试通过不等于真实 HWE 吞吐验收通过。** 2026-10-02 历史实验的 1.59× 来自旧实验编排器，不能算作此实现的实测。20 次固定候选验证一致，支持本机并发 2；首段 117 条资源采样错误、baseline 约 75% 容器采样覆盖及约 13–18 秒间隙，限制了峰值判断。更高并发、Worker 与验证重叠及整个搜索提速均未证明。历史目录只读。

供 Command Code 后续执行，**本轮未运行这些长测命令**：

```powershell
Set-Location 'D:\Projects\Proactive Agent'
$sourceBatch = 'D:\Projects\Proactive Agent\.local\hwe-validation-throughput-20261002-115619'
npx tsx src/research-cli.ts verify-queue $sourceBatch 1
npx tsx src/research-cli.ts verify-queue $sourceBatch 2
# 如复现两轮配对，继续按 P2、S2 顺序各执行一次：
npx tsx src/research-cli.ts verify-queue $sourceBatch 2
npx tsx src/research-cli.ts verify-queue $sourceBatch 1
```

每条命令输出一个新的 `.runs/verification-queue-<uuid>`，按 S1、P1、P2、S2 记录路径；每次独占既有 HWE 执行锁。入口读取历史 `candidates.json` 中五个快照及其 SHA-256、该清单指定的 readiness，启动前核对环境指纹及所有快照；输出到新目录，原始快照只复制。baseline readiness 流程保留，并将同字节 baseline 作为 `replay-baseline` 排入实测。Manager 决策与 Worker 在该入口均为确定的资料复制，无模型调用或源码优化；普通 `run` 的模型、Worker 预算和搜索策略不变。

现有每轮最多 4 个 Worker 的规则保留，所以五个固定快照通过产品路径分为 **4＋1 两轮**。这验证新调度的实际屏障，不等同于历史实验五个同时入队的墙钟定义。仅对本入口同样条件下的串行和并发 2 作配对比较。五项全部得到正常通过/拒绝后，运行因固定配额结束，`status=budget` 且 CLI 输出 `complete=true`；基础设施错误、取消或未完成不可作为完整样本。默认每条最多 6 小时，可用既有 `PROACTIVE_RUN_DEADLINE` 给整批共享截止时间并预留清理窗口。

使用输出路径替换以下占位符，作只读比较：

```powershell
npx tsx src/research-cli.ts compare-queue '<S1运行目录>' '<P1运行目录>'
npx tsx src/research-cli.ts compare-queue '<S2运行目录>' '<P2运行目录>'
```

比较包含每个快照 SHA-256、状态、完整结构化 checks（含 formal 子项和三 seed）、指标、排队/执行时间、两轮验证墙钟与清理结果，并与原实验 S1 的 `tasks.json` 全检查记录比对。仅忽略 checks 中的 `seconds` 耗时字段；日志 detail 的差异仍列出路径，需查原始日志判断，不能为得到通过而删除差异。只有完整且一致时才计算验证墙钟比值，任务时间加总不作墙钟。

每个新目录保存 `replay-inputs.json`、`implementation/manifest.json`、`environment.json`、`state.json`、`events.jsonl`、`summary.json` 及各候选 `verification/result.json`、`classified-result.json`、执行日志。验收还须核对：事件的活动位置数不超过配置；取消后的容器确实停止；owner 清理无残留。owner 为 `research-` 加运行绝对路径 SHA-256 前 16 位，只检查该标签，可复用原实验的 owner 过滤审计/采样能力，输出另存新目录；不得运行会写入历史目录的旧脚本。`cleanup.status=completed` 是宿主 stop 成功记录，独立 Docker 审计仍需随后做。资源采样不在此维护入口重复实现。

对每个新运行做只读残留检查，`$runDir` 使用 CLI 打印的完整路径，预期 Docker 输出为空：

```powershell
$runDir = '<新运行的完整路径>'
$runOwner = node --input-type=module -e 'import {createHash} from "node:crypto"; console.log("research-"+createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16))' $runDir
wsl.exe -d Ubuntu-24.04 -e docker ps -aq --filter "label=proactive.owner=$runOwner"
```

## 第三步的对照问题

主问题：在同一基线、模型、工具链和公开验证能力下，普通 Codex 完整执行与 Management＋Subagent 的最终正确性、性能、耗时和人工介入有什么差别？允许管理组使用更多 token，完整记录 Manager 与所有 Worker 的用量，不以成本相等代替用户目标。

HWE 官方调度策略作为独立参考组；如果使用了不同调用预算或上下文，必须明确列出。开发过程中调试所花成本与正式对照分开报告，不能用开发试跑代替冻结策略后的对照。单个 CPU 任务只提供机制与个案证据，不能宣称总体成功率提升。

对照协议见 [HWE 本机对照](hwe-comparison-protocol.md)。CLI `ordinary` 提供单会话 Codex 对照；`summary <运行目录>` 汇总模型用量与最终证据。缓存输入已经包含在总输入中，不能重复计费式相加。

## 实验快照中的 readiness 复用

先运行 `npx tsx src/research-cli.ts preflight`，输出 `matches: true`、`baselineMatches: true` 后再进行付费模型预检。新指纹使用 `repo:Makefile` 和 `repo:cores/baseline/core.yaml` 表示两个仓库输入，兼容旧 readiness 的绝对路径。只允许这两项随完整 checkout 迁移；内容 SHA-256、源码集合、提交、验证器、镜像与工具二进制必须保持一致，工具路径也仍严格比较。JSON 对象键顺序不影响结果。缺少输入、重复身份或混合仓库根均拒绝复用。

无需改写旧 ready.json。旧实验快照仍保留失败结果；从修复后的开发版创建新批次，先只读预检再启动 A/B/C。指纹或基线包出现真实变化时，仍须重新建立 readiness。

## 首对条件延伸策略与基础设施恢复（2026-10-03）

首对 B→A 实验与授权恢复已保存[中文报告](../.local/hwe-strategy-ab-20261002-195054/report.md)。B 规则仅注入 Manager，公共 goal、Worker 提示、JSON schema、质量排序和验证器保持共同冻结；实际 prompt 与真实请求哈希可审计。B 5 个条件轮均安排延伸，非最佳 shared-shifter 血统最终从 66.39 回升到 68.55；A 自由策略也延伸旧候选，但第 2 轮基础设施故障使本批无法公平判胜。两组都安排 10 次旧候选延伸，基本配额行为相同；B 非最佳延伸 2 次、A 0 次。B 条件允许当前最佳满足，因此不能把非最佳路线选择直接归因于强制配额。A 恢复交付 152.69，高于 B 68.55，当前没有可归因于 B 的质量或时间优势信号，也不能宣称 B 规则无效。A 显式恢复仅使用原剩余额度，保留失败分配、中断与活动/日历两种时间，不构成无中断配对。两组最终最佳快照完整独立复验一致，全部实际 owner 最终无残留。单对机制个案支持未来稳定环境下另行重复并检查实际分配反差，不证明普遍优势；未追加实验或修改默认策略。

运行链以可选 PROACTIVE_HWE_SERVICE_TIER 显式传入 fast/priority，默认未设置时保持原行为，不向严格研究配置 schema 添加字段。隔离 CLI 使用原官方模型目录补齐 metadata；预检实际请求 gpt-6.1-sol/xhigh/priority，响应 default，按 Standard 降级记录。请求档位与实际档位必须分开观察，不能用耗时猜测。HWE Python 属性固定 LF，认证两文件与自然指纹不变；不为行尾重建 readiness。长测直接 Node 捕获 stdout/stderr/真实退出码，故障停止新派工并保留原证据；用户授权恢复后先通过相同实际容器链的无搜索 READY 预检。


## 模型速度档、诊断与自然交卷（2026-10-03）

显式请求 Fast 可在启动进程前设置 `PROACTIVE_HWE_SERVICE_TIER=priority`（也接受 fast）；不设时保持 CLI 后端缺省。`--ignore-user-config` 和隔离 CODEX_HOME 不继承外层 UI 设置。现在会读取宿主 `.codex/models_cache.json` 中既有官方目录并校验指定模型/effort/Fast 元数据，再原字节冻结到调用目录；可用 `PROACTIVE_HWE_MODEL_CATALOG` 指定已冻结的目录。缺目录或元数据不支持时直接报错，不编造支持、不换模型或强度。基准实验应给两组显式使用同一份冻结目录；每次调用保留 model-catalog-receipt.json、codex-version.txt 和 codex-launch.json。

model-audit/*.diagnostic.json 与 model-transport.log 区分 declared（请求配置）、sent（代理出站请求字段及正文哈希）、response（实际模型/服务档/用量）。`tierStatus=unconfirmed` 表示未观察完整响应，downgraded 表示显式 Fast 的完整响应为 default；后者必须标 Standard。2026-10-03 短真实验收 6 个模型请求中 5 个完整可见响应均为 default，首个观察器尝试未确认。正式历史 632/default、80/未确认事实不变；账户/上游降级原因仍未确定。官方语义见 [Fast 文档](https://developers.openai.com/api/docs/guides/fast-mode)，不能凭配置解析或耗时声称 Fast 生效。

代理日志提供 callId/owner/requestId、失败阶段、连接/读取时限、已开始/已发送响应头、部分字节、异常类型与可用 errno/reason。localHttpStatus=502 是本地生成错误，upstreamHttpStatus 则来自上游；两者不能混称。已开始流式响应的中断关闭连接并记录，不追加第二个 502。凭据仅由宿主代理读取；审计不保存真实 token、认证头、auth.json 或请求内容。CLI 在 HWE 上不重试 HTTP 或 SSE（均为 0），代理每请求一次尝试，不自动重放。最终失败照原规则停止派工并收尾，不能重派已消费 Worker 或补足预算。

Worker 完成改动、必要局部检查与 REPORT.md 后应立即给最终答复；时间是上限，不要求耗尽。bridge 观察 turn.completed，给最多 5 秒退出余量后冻结、导出并清理。worker-session-result.json 记录 completed/timeout/cancelled/error、实际 exitCode、turnCompleted 和 processExitForced；完成后进程仍被宿主结束时，不能声称 CLI 自然退出。到时/取消仍保存源码、报告与原会话，Worker 自述不替代固定外部验证。取消通过宿主信号写取消文件，30 秒仍不收尾才强制兜底；整个运行和验证队列的原预算/屏障保留。

短验收包括 Manager 的真实 decisionSchema 启动、Worker READY/注释加 lint、真实 HWE 容器中的正常/阻塞退出/到时/取消注入，以及实际 CLI 的单次连接拒绝。最终独立 owner 审计无本批容器、代理进程或 socket。尚不能证明小时级稳定性或 Fast 可交付；压缩、半流、响应头和大 stdin 的部分边界仅离线覆盖。完整协议、用量、原日志和限制见 [诊断报告](../.local/hwe-runtime-diagnostics-20261003-102325/report.md)。

当前根目录旧 `.local/hwe-readiness` 的 verifierSha256 与认证环境不符；本轮未覆盖或重建它。既有 `.local/hwe-adapter-readiness-20261001-c74b9a20/.local/hwe-readiness` 与自然指纹一致。下一轮须在自己的冻结环境中复用原认证目录并核对指纹，沿用 Manager 900 秒/宿主 1,500,000 毫秒、独立验证并发 2；如果使用根目录默认入口，先明确选择匹配的既有认证输入。以 Standard 为共同条件可准备下一轮策略 benchmark；以实际 Fast 为必要条件时仍缺上游确认。本轮没有自动启动。

后续内部 Fast 诊断新增 received（CLI 到代理的字段）；代理保持请求正文原字节、declared/sent/response 三层记录仍保留。真实 Manager 显式 fast 经 CLI 转成 priority，完整响应仍为 default。一次有界兼容性诊断将出站值改为 fast，后端返回 HTTP 400 / Unsupported service_tier: fast；该诊断改写已撤回，原日志与实现快照保留。公开 Responses API 的 fast/priority 别名语义不能直接套用此 ChatGPT 后端。实际 Fast 未生效，服务端降档原因仍未返回；不能把诊断分类或标准档短验收写成 Fast 修复成功。

## 独立 Fast 控制（2026-10-03）

研究配置现在接受 `manager.serviceTier`、`worker.serviceTier`，值为 `fast`、兼容别名 `priority` 或明确关闭的 `default`。每个角色显式值优先于 `PROACTIVE_HWE_SERVICE_TIER`；缺省仍保留旧环境变量/后端行为。恢复比较保留这个差异：省略不等于明确关闭，改变已保存角色档位必须拒绝恢复；不能通过恢复切换实验条件。两组模型目录仍应使用同字节冻结输入。Standard 也可冻结目录，但不要求目录声明 Fast 能力；请求 Fast 而目录不支持时仍拒绝。

桌面聊天的 Manager 模型菜单和执行模型菜单各有 Fast 按钮，各自保存设置。Manager 传给 app-server 的 thread/start、thread/resume 和 turn/start；Codex Worker 的初次/续接 CLI 显式传入 service_tier，并启用目录中的 Fast 选择能力。Command Code 不使用 Codex 服务档位。目录只声明可请求的能力，不证明实际服务档；按钮显示请求设置，不能显示“已确认 Fast”。app-server 没有提供实际响应档位的当前调用标记为 unconfirmed。

本机官方 Codex 源码 `bcd6d9a` 的 core/client.rs 会为原生 ChatGPT 后端构造 `x-codex-routing-hint: model=…;tier=…`。隔离自定义提供方不会自动进入该分支。HWE 显式 Fast 调用现在由宿主代理从实际、未改写的正文补齐该提示，并写 routing 审计；缺省与显式 Standard 不启用此补充。它不伪造账户、客户端身份或权限，也不改变上游、认证及 HTTP/SSE 方案。真实 Manager 和 Worker 请求补齐提示后均仍返回 default，因而这只是补齐原生路由信息，尚未修复实际 Fast。

最后短预检还显式启用了 fast_mode。原生提供方对照仅在独立复制的 harness 中进行：覆盖保留的 openai ID 被 CLI 拒绝；改用官方 openai_base_url 后停在 workspace routing discovery，零模型请求；均未替换生产提供方，也未开放容器网络。最多 1 次 Manager、3 次 Worker 容器预检，只有 Manager/隔离 Worker 各 1 个请求到达模型。父快照前后哈希不变，各 owner 独立审计零残留。原始退出码、强制退出标记和失败日志保留；不计入正式测速。

当前具体未解决项是：成功到达上游的显式 priority 请求仍返回 default，上游没有给出原因；尚不能归因于账户、地区、CLI 版本或代理。本轮不继续无界重试。官方 [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) 明确 fast 映射 priority，直接重写成 fast 的失败诊断不能再作为修复。详细证据见 [Fast 控制报告](../.local/hwe-fast-controls-20261003-144700/report.md)。
