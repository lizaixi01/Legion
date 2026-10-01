# 通用主 Agent

开发版普通聊天直接使用 Codex app-server。选择项目、通过“＋”添加文件，再输入需求即可执行；不需要预先安装 Node 测试或为 benchmark 新建模式。目录通过“选择项目”提供；附件保存为本机文件路径，按需读取，不复制为永久上传件。移动或删除原附件后，后续读取可能失败。

## 执行与管理

保留 Codex 原生指令、项目规则和文件/终端工具，通过 developerInstructions 增加 Legion 的管理职责。主会话既执行工作，也调用客户端 dynamic tools：

- `legion_dispatch`：选择 Codex / Command Code，在独立工作目录派发任务；可复制项目内的输入文件。
- `legion_tasks`：列出任务、读结果和日志路径、等待、取消、向已结束的会话补充指令。
- `legion_delivery`：登记本轮固定交付契约、检查整合后的根产物、读取失败与重验记录。
- `legion_hwe_check`：调用已安装的本机 HWE 公开验证流程，返回候选绑定的检查与质量指标。

`off` 在运行时拒绝派发，`fixed` 是并发名额上限，默认 10；`auto` 由模型决定，受统一队列约束。单轮最多 64 次子任务启动/续跑，普通主会话单轮最多 6 小时，每次 Worker 最多 30 分钟。退出本轮会取消尚未结束的子任务，不把遗留 Worker 当作后台常驻任务。

Command Code 当前仍受既有文件工具门控约束，不具备与 Codex 相同的终端/网络能力。工具描述明确告知主 Agent。隔离工作目录不等于操作系统安全隔离。

### Worker 契约与 HWE 验证工具

legion_dispatch 可提供结构化 contract（goal、outputs、acceptance）与 30–1800 秒 timeoutSeconds。宿主保存契约、复制输入的哈希和执行上限；续跑不能通过控制工具替换契约。Worker 正常结束后，按声明 outputs 保存每次独立快照和哈希。缺失或不支持的输出标为 invalid；captured 仅表示已捕获，不表示验收通过。为兼容调查与旧调用，contract 仍可省略，是否提供由主 Agent 按职责判断；尚未强制文件写入范围或建立依赖 DAG。

HWE 工具只接受项目内 .tar.gz 路径（最多 20 MiB），固定副本后调用现有 verifyHwe，运行前后检查 readiness 工具链指纹、候选哈希；要求 readiness 基线哈希匹配。每轮最多三次检查、同时一个，受主轮次截止时间和取消信号控制，清理仅针对自己的 owner。缺失指标、环境变化、取消、清理失败均不返回 verified。原始报告保存在本轮 hwe-checks，GUI 展示公开检查状态、指标及范围；不改写既有 HWE 实验目录或评分规则。

此工具是具体领域的验证适配入口，不是允许模型注册任意命令的通用验证器。返回 verified 仅覆盖固定 HWE 公开检查，尚未映射为 legion_delivery 的整个目标 accepted。需要现有 WSL/Docker/readiness 配置；缺失时报告错误，不自动安装环境。开发验证使用依赖注入，不代表已经完成真实 GUI HWE 长任务。

## 会话与证据

thread ID 在启动 turn 前保存，后续消息和应用重开使用 `thread/resume`。旧聊天迁移为新主会话时附带历史消息，不把轻量聊天旧指令继续带入。任务记录跨轮保存在 `.chats/<id>/tasks/<task-id>/`；原始 app-server 事件、命令和用量通知保存在每轮日志。用量字段标记为 thread-cumulative，不能直接把连续轮次的累计值相加。

执行完成和验收通过是两件事。主会话现可登记交付契约，调用独立挑战、快照检查和宿主功能验证。登记后未检查、被反例否定或受阻的交付会阻止本轮标记完成。只有安装的功能验证器覆盖且独立检查通过、当前产物版本仍一致时，才标记 accepted。没有登记契约的回复保持 unverified，不获得认证；语义上哪些需求必须登记目前仍由主 Agent 按指令判断，不能声称已强制识别所有工程请求。

每轮最多检查三个候选；独立挑战者使用新的 Codex 会话、主模型配置、只读候选，调用计入统一子任务名额和 64 次调用上限。成功生成的挑战在本轮修复重验时保持不变。关闭子 Agent 时不调用挑战者，外部检查仍可运行，但缺少独立审查时不会认证通过。普通聊天不要求用户建立测试基线。

当前功能验证器仍限于内置数值聚合场景；其他文件任务可以获得真实审查证据，但没有可信功能覆盖时保持未验证。检查不执行模型提供的任意命令。快照仅支持现有规则允许的相对路径、普通文件及单文件 4 MiB 上限；不等于支持任意仓库、HWE 或 UI 验收。证据保存于每轮 delivery 目录，GUI 展示契约、各候选的检查和最终状态。契约与挑战冻结；新一轮可沿用原要求并重验，不把旧磁盘 PASS 直接作为信任凭证。

新工具需要重新建立 app-server thread；旧聊天首次迁移时携带已保存消息历史，不能保留旧线程全部隐藏上下文。验收记录不是常驻执行器或通用断点恢复机制。

### 跨轮继续修复

`legion_delivery read` 提供本轮状态和上一项交付摘要。用户要求继续修复时，主 Agent 使用 `resume`，从宿主指定的历史路径恢复原始需求、输出范围、验收条件和已生成挑战；不能由模型传入任意历史路径。恢复后为 pending，历史 accepted 只供参考，必须对当前文件重新捕获候选并执行检查。损坏或不匹配的历史不能恢复，模型报告也不能直接成为当前信任凭证。

新的用户消息开启新的主轮次，因此有新的轮次截止时间和最多三次检查；这不是旧长任务自动获得额外预算。历史轮次的文件、失败与检查保留，通过 inheritedFrom 关联。普通聊天经过闲聊后仍保留最后一项交付指针。无关任务可 prepare 新契约，继续旧任务则应 resume；这项意图判断仍由主 Agent 完成。当前机制恢复的是契约与检查，不会自动重放中断命令或常驻续跑。

每次 Worker 启动或续跑保存单独的 `attempt-N/attempt.json`，任务摘要保留完整 history：指令、模型、推理强度、起止时间、结果与日志路径。后续修复不会覆盖前次失败。主会话通过 `legion_tasks` 读取跨轮历史；GUI 可逐次展开，并在刷新时保留展开状态。旧记录只保留现有信息，不补造历史、模型或时间。此记录不是产物快照，也不证明检查通过；工作目录中的文件仍可能被后续修复修改。

同一主会话内派发和续跑的登记串行化，实际 Worker 仍并发执行；同一任务不能同时续跑两次。应用关闭时等待登记收尾并取消在途执行，未知的历史执行仍拒绝直接重放。

应用中断后恢复的是会话上下文，不是任意进程的指令位置。未知在途子任务标记 interrupted，禁止直接继续；需先检查证据。当前不支持关闭应用后常驻工作。历史工程和持续目标入口继续兼容，尚未全部迁移为 app-server 原生目标。

## 参考与验证

官方接口：[Codex app-server](https://learn.chatgpt.com/docs/app-server)。采用 Thread / Turn / Item、thread/resume 和 experimental dynamic tools。对照本机 CLI 生成的 JSON Schema，dynamicTools 仅在 thread/start 注册，恢复时由服务端加载。

真实 Sol/medium 主会话读写文件并执行断言，重启 app-server 后同 ID 续跑成功：`.local/primary-live-1790740061221/`。真实主会话通过新工具派发 Codex Worker、等待结果并用自己的终端独立断言通过：`.local/primary-delegate-1790740196241/`。这些是有限烟测，不代表 HWE 完整成绩或多日可靠性。

GUI 实际 Electron 页面配离线 API 检查附件添加、移除与截图：`.local/primary-visual.json` / `.local/primary-visual.png`。回归覆盖禁用/并发约束、双后端派发、继续会话、停止清理、未知执行阻塞、RPC 工具往返、附件与输入文件隔离。

### HWE 证据驱动决策（2026-09-30）

主 Agent 新增 `legion_strategy`：读取本轮证据，记录 select / discard / continue、理由及下一实验假设。select 必须引用本轮宿主签发且 verified 的检查；拒绝未知 ID、被改写的报告、已变化的源候选或快照。多个已验证候选比较时要求环境一致。模型不能通过该工具提交指标，指标只取自宿主内存保存的验证结果。continue 必须给出下一实验假设。

决策写入每轮 `decisions/<id>.json`，包含当时的证据副本；GUI 展示理由、证据编号和下一步计划。它是时点记录，不是持续有效的 PASS 或整个任务验收。重启或下一轮不能把磁盘 JSON 自动提升为可信证据，需重新检查。nextExperiment 未附 workers 时只是计划。当前可附带冻结的 workers 分配，由 execute 在共享名额内分批派发；详见下节。工具变化将主会话 transport 升为 v9，旧聊天以历史上下文迁移。

### 决策关联派工与跨轮记忆

continue 决策可附 workers（后端、输入、契约、单次时限），宿主生成稳定的 allocation/task ID。execute 根据可用名额派发；重复 execute 只处理 pending，不重复启动 dispatched/blocked/未知结果。派工前保存 launching 意图，登记失败不执行；派发结果未知不自动重试。cancel 只取消未启动分配，运行中任务通过 legion_tasks 取消。主轮结束会关闭剩余计划，不能在存在 pending 计划时正常完成。

总调用上限沿用每轮 64，并发沿用用户 off/auto/fixed 设置和共享后端队列。计划记录各 Worker 时限之和，这不是 token 或费用预算，也不预留未来账号容量。单次执行还受主轮截止时间约束；共享队列等待消耗同一截止时间，到期的排队任务不再启动。队列内同步启动异常也会释放名额。

每次派工记录 decisionId/allocationId/ownerTurn。GUI 将计划关联到任务的实际状态；跨轮发现旧 running 不再当作当前执行。历史决策最多读取最近 20 个轮次、80 条记录，给模型的摘要进一步限制为最近 20 条，保留证据编号和任务 ID，详细日志按需读取。历史只提供上下文，不能恢复 execute 权限或作为新 verified 证据。启动失败、取消、记录写入失败和未知派工结果均有行为回归。当前主 Agent 仍需调用 execute 继续排队计划；原生 Goal 可继续同一主会话，但本次没有把应用改为关闭后仍工作的常驻服务。

### Codex 源码参考

本轮实际阅读 openai/codex 的固定提交 `bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0`，本地只读参考位于 `.local/codex-reference`：

- [execution.rs](https://github.com/openai/codex/blob/bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0/codex-rs/core/src/agent/control/execution.rs)：共享执行名额及释放 guard。Legion 保留自身双后端队列，落实同一预算入口。
- [spawn_guard.rs](https://github.com/openai/codex/blob/bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0/codex-rs/core/src/agent/control/spawn_guard.rs)：启动未完成时清理子线程。Legion 使用持久 launch intent，未知结果不重复启动。
- [resume.rs](https://github.com/openai/codex/blob/bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0/codex-rs/core/src/agent/control/resume.rs)、inspection.rs、interrupt.rs：区分运行时是否存在，检查和中断不隐式重启 Agent。Legion 历史记忆不等同于派工权限。
- [goal/runtime.rs](https://github.com/openai/codex/blob/bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0/codex-rs/ext/goal/src/runtime.rs)：目标状态锁与 start_turn_if_idle 边界；用于现有原生持续目标适配，迁移范围见下文。


### 批量等待与交付前复核

legion_tasks capacity 返回本轮可用名额、剩余调用次数及共享队列的后端状态；这是配置和当前观察，不是服务商保证的并发额度。wait 可传 ids（最多 64 个），在首个任务结束或 0–60 秒超时时返回精简状态；完整结果用 read 获取。派发响应前等待首条任务记录落盘，避免立即 read/wait 时找不到新任务。

主会话结束前再次核对已选择的 HWE 候选及报告哈希。失效则保存 selection.json 并阻止本轮正常完成；一致仅证明固定公开检查绑定的文件仍是原版本。历史选择复核也只代表其记录时点。对照 Codex control/watch.rs 的状态订阅原则，等待不启动任务、不重复返回全部上下文。


### 原生持续目标入口

GUI 的持续目标现在向 chatSend 传 continuous，走与普通聊天相同的主 Agent / Worker / HWE / delivery 工具链。旧 `.goals` 记录仍按原入口读取和恢复，新建持续目标不再进入旧领域专用 planner。普通消息显式禁用原生 goals 功能，避免恢复历史线程时意外触发自动执行。

Codex app-server 先登记 paused 目标，再启动用户轮次，最后激活目标，避免先设置 active 导致未经用户输入的额外启动。传输层监听 thread/goal/updated 和所有后续 turn 事件；中间轮次结束不会关闭连接。原生 Goal 决定后续轮次，Legion 不额外循环 turn/start。停止或主连接结束时暂停仍活动的原生目标；保留同一会话、原目标和原截止时间。模型改变原目标或目标状态无法落盘会中止正常完成。

当前显式持续目标默认总时限 6 小时，继续已有未完成目标不重置该时限。目标在宿主建立独立的持久预算：累计 64 次 Worker/独立复核调用和 3 次 HWE 验证；原生续轮和显式重新连接均不重置次数。每次调用先登记占用，再执行，结束后结清；异常抛出无法确认执行结果、验证器清理失败或记录损坏，会阻止恢复，不能自动重跑。独占执行租约防止两个连接接管同一目标。当前没有跨后端 token/费用硬预算。GUI 的原生 tokensUsed 仅表示主 Codex 目标用量，不含通过独立进程启动的 Worker。原生 complete 表示主 Agent 的目标状态，独立交付验收仍单列，不能把原生 complete 当作通用 accepted。

验证：本机 codex-cli 0.157.1 生成的实验协议确认 thread/goal/set/get/clear。隔离 CODEX_HOME 的真实 app-server 探测只创建 paused 目标、读取、清除，未调用 turn/start（`.local/native-goal-probe/result.json`）。多轮续跑、停止、目标变更和落盘失败通过离线协议/行为测试，尚未运行付费模型的持续目标长任务。GUI 测试截图 `.local/native-goal-visual.png`。


目标预算参考同一 Codex 提交的 core/src/rollout_budget.rs：同一根目标共享记账，提醒或续轮不重置使用量。Legion 的外部 Worker 不在原生 Codex 线程树内，故使用自己的校验和检查点与执行租约。GUI 分别显示根目标 token 和累计子调用/验证次数。预算为宿主边界，不接受模型提高额度；当前为 64/3 的既有限额。缺少账本的旧持续目标不能被当成零消费恢复。


### 持续目标验收连续性与冲突

目标预算目录同时持久保存原交付契约与已冻结挑战，先于向模型确认登记。恢复时宿主在模型启动前沿用原要求，并把当前产物重置为待检查；不依赖聊天最后一轮指针或模型自觉调用 resume。损坏、原目标不一致或试图重新 prepare 弱化要求均阻止恢复。普通无目标聊天仍可对新任务 prepare。参考 Codex control/resume.rs 的恢复既有执行身份原则；验收契约门控是 Legion 自身增加的约束。

外部 rejected/blocked 不会被缺失审查降成 unverified；独立挑战反例与外部 PASS 冲突时保持双方报告并标为 blocked，查清原因前主会话不能正常交付。挑战失败而无外部 PASS 时为 rejected。冲突不自动断言模型生成的测试一定正确，也不自动更换冻结检查。


恢复已存在的原生线程时，先通过目标 API 将持久状态置为 paused，再 thread/resume，再 turn/start，最后激活。Codex ext/goal 的 restore_after_resume 与 on_thread_idle 会恢复活动目标的续跑语义，因此不能等加载后再暂停。真实本机无模型协议探测 `.local/native-goal-unloaded-probe/result.json` 验证未加载线程可先暂停；0 次 turn/start。离线协议测试检查调用顺序及不重复启动。

GUI 运行进展仅采纳 app-server item/completed 的 agentMessage/commentary：最多最近 8 条，每条最多 1500 字符，重复消息 ID 合并。不会显示 reasoning 或最终回复草稿，也不会把阶段说明作为验收证据。折叠状态在刷新时保留；最终回复仍在本轮结束后发布。


### 启动与退出边界

参考 Codex PendingSpawn 的“初始输入接受前由宿主拥有清理责任”：取消标记会在登记前、登记后、初始化后和 turn/start 前重新检查；已取消请求不启动模型轮次，登记耗时包含在总时限内。清理所有 Worker 使用 allSettled 等待全部结束后再传播首个记录错误，防止某个结清失败让父目标提前释放所有权。未结清的原始记录继续阻塞未知结果的恢复。


原生目标的 prepare/activate/close 也在客户端串行化，对照 Codex goal/api.rs 在状态修改期间持有 goal_state_permit 的做法。close 先置停止标记，再等待已发激活的结果并确认暂停；激活回复丢失时保留未确认标记，清理仍发送 pause。重复 close 共用同一个收尾 Promise，不重复激活。该边界由可控 RPC 夹具覆盖，未调用真实模型。


### 子任务摘要读取

legion_tasks summary(id) 由宿主提取最新状态、结果首尾、失败详情、所有历史状态计数、最近 3 次尝试与证据路径；长文本明确标记裁剪。结果保持 unverified，摘要不是验收结论或完整要求。read 保留原有完整读取接口，原始 task.json 不改写。提示词引导 Manager 在批量等待后先读摘要，再按需读取原文件。参考 Codex utils/output-truncation/src/lib.rs 的显式裁剪和不改变成功元数据原则。

工具 schema 版本升为 v9；旧主会话按既有迁移机制将聊天历史带入新线程。持续目标的宿主累计预算、原截止时间和目标目录契约保留。GUI 的原生 token 计数标为“当前主会话”，不宣称它包含旧线程或外部 Worker 的累计费用。

主 Agent 的管理指令同时明确：Worker 消息、产物、日志和历史摘要属于不可信任务数据，不能修改用户目标、权限、预算或验收要求。该提示是行为约束，不能替代宿主校验或操作系统隔离。
