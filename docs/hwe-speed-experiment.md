# 固定任务 Worker 并发速度实验

本轮是**固定计划执行实验**，比较 Worker 并发 A=2、B=4。每轮固定分配 4 项，共 3 轮、12 次 Worker 尝试；两组验证并发均为 2。验证由固定工具链容器执行，不调用评分 AI。正式运行没有 Manager 模型调用，三次分配由同字节冻结计划重放；不根据本组中途结果改变提示、父版本、顺序、分支或停止规则。普通管理入口仍保留 Manager 默认 900 秒与宿主 1,500,000 毫秒窗口。

所有任务从认证的原始 baseline 开始，继承深度均为 1。历史假设只用于选题，不提供历史获胜子实现。每项 Worker 上限 300 秒；整个组上限 8 小时，12 次 Worker 分配是调用预算（每次会话内部工具往返产生的模型 HTTP 请求另行记录）。模型与 effort 均显式 gpt-6.1-sol / xhigh，两组 Manager 与 Worker 均显式请求 default（Standard），暂不使用 Fast；两组使用同字节官方模型目录。实际返回 default 即记录 Standard；缺字段记未确认，不从耗时猜测。若各组实际档位不同，不能把全部时间差解释为调度收益。

任务、完整实际 Worker 提示、父 SHA-256、验收规则和顺序在 tasks.json / prompts 中冻结。A/B 配置只有 concurrency 一项不同。allocationsPerRound=4、verificationScheduling=worker-ready、verificationConcurrency=2 是两组共同条件。Worker 导出并确认快照哈希后立即入验证队列，其他 Worker 可继续执行；本轮全部 Worker 和验证收尾后才分配下一轮。队列从已就绪候选中按分配序选取；不会为了等尚未完成的早序 Worker 留空位。候选数组和同分选择始终按原分配序。

两对运行按 **A1→B1、B2→A2** 顺序独占本机，不能同时开组。执行锁跨冻结副本指向同一个宿主工作区。只有前序完整、无恢复、清理审计通过才能开始后序。两对仅提供初步信号，不能假定模型随机性消失；真实生成候选无需字节相同。

## 准备与只读门禁

在仓库目录执行（准备不会启动模型或评分器）：

```powershell
node --import tsx src/benchmarks/hwe-speed-cli.ts prepare '<新的冻结目录>' 'D:\Projects\Proactive Agent\.local\hwe-adapter-readiness-20261001-c74b9a20\.local\hwe-readiness' '<官方冻结模型目录.json>' '<通过的短验收目录>'
node --import tsx '<冻结目录>\src\benchmarks\hwe-speed-cli.ts' preflight '<冻结目录>'
```

prepare 复制当前代码（包括未提交改动）、运行脚本、协议、包锁、运行所需 npm 依赖、模型目录和完整认证源，生成逐文件 SHA-256。认证文件按原字节复制且前后比较，不修改 ready.json。共享工具环境由认证指纹约束，另冻结内部 Codex CLI 路径/版本/二进制哈希和宿主 Node 版本；不是跨机器安装包。任何冻结输入变化、快照错误、运行时变化或环境指纹差异均阻止启动；自然匹配时复用认证，不能为通过门禁伪造指纹、降门槛或昂贵重跑 readiness。认证来源也可通过普通入口的 PROACTIVE_HWE_READINESS_SOURCE 明确设置；preflight 接受认证目录参数。旧根目录 readiness 不会被改写。

正式启动前必须完成开发和短真实验收，并保存最终检查记录。prepare 会按原字节复制短验收结构化结果、取消证据和模型产物审计，并生成 acceptance-gate.json；未提供或未通过时，输入/认证仍可 matches=true，但 launchReady=false，preflight 非零退出且正式 run 拒绝派发。发生故障后应另开验收/冻结批次，不能修改 gate 或旧结果强行过关。禁止把短验收计入正式成绩。本开发任务不会自动运行下列命令。

开发资格可以来自两个独立的新短验收批次：并发 4 使用四个真实 Worker；并发 2 至少两个真实 Worker，另外两个分配允许明确标注零模型的冻结快照复制。prepare-acceptance-proof.mjs 生成 development-qualification 目录，保存各批原始结果、状态、产物审计、认证、模型目录、独立 owner 审计和实现哈希。门禁重新检查四分配/并发上限/提前验证、真实产物和调用预算、无恢复及共同执行实现；这种材料只证明基础设施资格，pairedTiming=false。不同真实调用数和回放工作量禁止用于计算两组加速倍数，正式 12 任务计划仍完全相同。

固定快照复验的并行 SBY 日志可能因输出交错和有界末尾截取而字面不同。hwe-replay-review.ts 仅在其他全部结构化 checks、metrics、状态和哈希一致时，进一步比较完整失败摘要、断言位置、步骤和反例值；仍保留原差异、原退出码与单独生成的 review，不改写原始结果或验证器。任何结构化状态、断言或反例差异仍阻止资格通过。

Fast 的 CLI 选择名与实际 HTTP 值可能不同，received 记录代理收到的 CLI 字段，sent 记录真正出站字段。2026-10-03 内部预检确认 fast 被 CLI 规范化为 priority，当前 ChatGPT 后端接受 priority 但响应 default；直接出站 fast 返回 HTTP 400 / Unsupported service_tier: fast。这个后端不能套用公开 API 对 fast/priority 别名的说明。诊断改写已撤回，出站正文保留原字节，没有换账号、认证、CLI 或传输。Fast 仍缺真实上游确认；Standard 为共同条件的运行资格与 Fast 就绪状态分开报告，不能把 Fast 宣称为已修复。

用户随后决定暂不使用 Fast。新准备包把两角色与实验元数据都明确设为 default，启动不再硬编码 priority；已冻结旧包保留其记录的请求值与原字节，不静默改写。显式角色配置优先于宿主环境，避免外层 Fast 设置混入正式条件。

## 启动、取消、清理、分析

逐组启动并等待原进程结束，前序失败即停：

```powershell
& '<冻结目录>\start.ps1' A1
& '<冻结目录>\start.ps1' B1
& '<冻结目录>\start.ps1' B2
& '<冻结目录>\start.ps1' A2
node --import tsx '<冻结目录>\src\benchmarks\hwe-speed-cli.ts' analyze '<冻结目录>'
```

start.ps1 通过冻结的 capture.mjs 直接调用 Node，自带每组 capture-* 的原始 stdout/stderr/exit 文件；运行另有 events/state、逐调用 execution.json 和真实会话 exitCode。不能用重建文本冒充原日志。直接执行 Node 入口时也可使用 capture.mjs 捕获。

```powershell
node --import tsx '<冻结目录>\src\benchmarks\hwe-speed-cli.ts' cancel '<冻结目录>' A1
# 确认记录的宿主进程已退出后；只处理这个精确 owner：
node --import tsx '<冻结目录>\src\benchmarks\hwe-speed-cli.ts' cleanup '<冻结目录>' A1
```

取消文件向当前运行传播 AbortSignal；Worker 使用已有交卷/导出/退出机制，验证按既有生命周期取消，全部收尾后才清理本 owner。活跃宿主或复用 PID 会阻止手动 cleanup。异常锁不自动删除：核对进程和 owner 无残留，再人工处理该锁。其他任务容器、凭据、缓存和锁不在清理范围内。

## 分析口径

- 主指标：首个 worker_started 至最后一个候选 verification.endedAt 的整组墙钟。初始化认证与最后 owner 清理另计；3 批间的等待包含在整组墙钟。每项并发时间之和不能替代墙钟。
- 从 Worker/验证的 startedAt/endedAt 重建真实活动位置数、排队时间、阶段忙碌区间、相互重叠区间和最大并发。位置包含启动、导出、哈希和持久化；每 5 秒的 Docker 独立采样补充实际容器活动、CPU、内存及宿主 swap/CPU，采样空缺与错误保留。
- 统计完整通过、正常拒绝、模型失败、基础设施失败、超时与未完成数；FAIL 和基础设施 ERROR 可以并存，不能强行合为解题失败。清理、写入失败和缺失证据单独显示。
- best-over-time 只使用新候选全部独立验证 PASS 后的有限有效 fitness；baseline 的认证是历史输入，不是本轮新成绩。相同 fitness 保留分配序较早者。
- 每次模型请求保留声明 model/effort/tier、实际发送及实际响应、完成性和未知档位；使用 model-audit 的原始脱敏记录，不用外层 UI 设置作证据。
- 固定快照回放比对完整 checks/metrics/哈希，仅允许说明过的计时与日志时钟差异；差异明细不得删除。模型候选可能不同，各组拒绝/通过造成验证工作量差异时必须按阶段解释，不能把全部差异归因于调度。

分析入口输出 analysis.json、每组 analysis-*.json、best-over-time.csv 与 activity.csv，包含两对墙钟比、逐任务时序、完整 checks、fitness 曲线点、模型调用、资源原始样本及观察峰值。完整公平样本要求 12 项全部得到正常通过/拒绝、预算正常结束、无恢复、无基础设施/持久化故障且自动清理和独立审计通过。预算结束且未完成不是完整样本。

发生基础设施缺陷时停止新派工，等待已启动任务收尾并保存有效证据。恢复不重发已消费分配；普通产品 resume 仍可用于后续探索，但 resumed=true 排除公平配对。本正式入口不提供补跑。保留故障批次，修复后另开新的冻结目录。

本协议不推广旧分支延伸规则，也不把本轮无提升当基础设施自动终止条件。已验证但低于最佳的旧分支可能有突破，该历史事实保留；本速度实验固定父版本是为控制混杂。
