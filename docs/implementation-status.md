# 当前开发范围与验证

2026-09-28 用户明确要求开始构建，产品讨论结束并进入实现。

## 已确认产品方向

以一个有依赖的复杂工程为对象，允许增加 10～1000 倍计算，以基本不增加人类监督、决策、验收和返工时间为约束，争取约 10 倍合格工作量。此为研究目标，不是已经得到的实验结果。

用户启动目标；系统主动读取授权资料、起草验收清单和持续推进。可以重规划、返工、并行探索并丢弃候选；不能降低要求或扩大授权。新增有效证据可以支持继续探索。每次交接需要验证，程序化证据充分时可直接推进，覆盖不足或争议时增加独立审查。用户最终看到一个推荐方案、最多两个实质不同的备选和证据包。

先固定需求，再扩大依赖工程，后加入受控变更。电子设计为候选领域，尚未选定其 evaluator；ALE 保留作为已有研究资产。

## 当前状态

开发版普通聊天使用可执行的 Codex app-server 主会话，支持文件上下文、双后端动态委派与历史会话恢复；既有工程 DAG、持续目标与 HWE 专用流程继续兼容。通用入口尚未统一所有强制验收、常驻恢复与桌面观察能力。以下按阶段保留实现记录，每阶段的“下一步”以最新条目为准。

## 初始切片（历史）

实现固定策略而非 LLM manager：启动 Codex → 公开检查 → 明确失败时恢复同会话一次 → 证据包。这个阶段先验证调度、证据与失败语义，不声明已经实现长期多代理管理。

TypeScript/Node 作为本地内核，使用 JSONL 和原子状态文件。Electron 是后续客户端；ReAct 是后续策略实现，不能替代进程控制和验收边界。

## 已实测

- 最初状态机测试在实现前因缺模块失败；实现后通过。
- 确定性 fixture 端到端：首轮 fail、同会话修复、次轮 pass，保存两次证据；不调用模型。
- Windows Codex 0.154.0 的真实 gpt-6-sol 请求被服务拒绝：当前 ChatGPT 登录方式不支持该模型。失败保留，manager 未进行无依据续跑。
- WSL Codex 0.157.1 的只读预检发生模型列表请求超时及服务连接错误，在 45 秒限制内未产生成功回复，无法证明目标模型可用。没有替换模型或改用 API 计费。
- 行为测试覆盖 B0/B1、最多两次调用、缺失 session、checker 异常、原始 usage、超时与取消、并发 workspace 锁、检查器变更和路径隔离。类型检查与构建通过；编译后的 CLI demo 已运行。

## 后续顺序

### 持续管理切片（2026-09-28）

新增 goal 模式，按固定监督策略在明确检查失败后持续恢复原会话，不再局限两次调用。B0/B1 继续作为固定实验模式。

goal 的 requiredChecks 声明必需验收项目；缺失或 not_checked 不构成完成。额外 maxAttempts 可限制次数，但没有配置时仍受总时间约束。异常、检查错误和缺失会话不会被循环重试掩盖。

新增正常检查点 pause/resume：暂停等待当前 worker 与检查结束，恢复追加 attempt，保留原 session、原 run ID 和原始截止时间。强杀/断电的自动进程恢复仍未实现，不把 clean pause 冒充 crash recovery。

新增六项行为测试覆盖四轮推进、缺失必需检查、未检查要求、暂停续跑、配置变更拒绝和预算不重置。此前测试保持通过。真实模型接入未在本次再次测试，之前的模型/网络限制仍未解决；四轮 demo 使用明确标识的 fixture。

接下来优先解决真实 worker 接入，再实现任务分工与多个隔离会话。当前没有 LLM master、动态规划或多 worker 调度。

1. 真实 exec/resume 已打通（见下）；token 用量的增量/累计语义仍需核验。
2. 实现独立 Docker worker 环境，固定软件与任务输入；配置与隐藏评估资料不进入 worker。
3. 接入 ALE 或核验合适的电子设计 evaluator，运行真实交付比较。
4. 增加阶段依赖与证据失效传播，再扩展并行搜索和独立审查。
5. 需要长期可视化时接入 Electron/快捷键，最后扩展主动桌面发现。

### 真实 Codex 接入验证（2026-09-28）

项目私有安装 Windows x64 Codex 0.157.1，继续使用 gpt-6-sol、high 和现有 ChatGPT 登录；未更换模型或计费方式。早期 0.154.0 的模型拒绝不能代表这个账号在新 CLI 上也不可用。

修复 Windows 调用参数：显式传入 `--sandbox workspace-write` 与 `-c windows.sandbox="elevated"`，初次和 resume 均保留。仅改成 `--sandbox` 尚不能解决问题；加入 Windows 沙箱实现配置后才实际写入成功。此前实际 turn_context 为 read-only，与原请求不符。保持 approval_policy=never，不自动放宽到完全访问。依据：[官方 Windows 沙箱文档](https://learn.chatgpt.com/docs/windows/windows-sandbox)。

本机证据（原始日志在被忽略的 .runs 中，不随源码发布）：

- 单轮真实写入：`.runs/run-fb80e5d5-9320-4d17-b73e-1767234d183b/report.md`。生成 answer.json，sum 与 sorted 均通过，约 27 秒。
- 两阶段真实恢复：`.runs/run-a948d375-9642-428e-b005-c4350635c44b/report.md`。约 52 秒，首轮依照试验提示故意写 sum=41，公开检查 fail；第二轮修为 42，检查 pass。两轮 session ID 均为 `01a0e77c-3d33-77c3-a007-a9cd9b0a5466`，文件 SHA256 发生变化，sorted 始终通过。
- domain_quality 明确保持 not_checked。这验证进程、文件、检查和会话恢复链路，不证明复杂任务成功率提高，更不证明 10 倍效率。
- 两轮原始 usage 已保留；仍不汇总，不据此推断实际费用或增量 token。
- 26 项测试、类型检查和构建通过，新增初次/恢复均携带 Windows 沙箱配置及非 Windows 分支的回归检查。

当前下一步：引入多个隔离工作目录中的独立 worker 会话与统一验收，再接入具有工程意义的任务。桌面观察、Electron 和 LLM master 仍未实现。

### 多会话调度与证据策略（2026-09-28）

上述“下一步”中的多会话与统一验收已实现。新增 team CLI、声明式任务依赖、独立路线工作目录、并发上限、任务状态和产物快照交接。B0/B1/goal 保持兼容。team 暂不提供 pause/resume，崩溃后保留证据，不自动重新接管。

Master 默认 evidence-v1 规则：明确 fail 时同会话修复；一条路线累计两次失败后切换预先声明的下一路线；缺少必需证据时安排一次补充验证；全部必需检查通过后才允许产物交接。可替换 decide 接口已接入，验收和预算约束由调度器强制执行。这里的 Master 不包含 LLM 自主规划，任务及备选路线仍由配置定义。

验证：37 项行为/边界测试、类型检查和构建通过；team fixture 演示覆盖续跑、换路线、补充检查和下游交接，也验证了证据写入失败时取消其他执行中的 worker。真实 gpt-6-sol 三会话试验存于 `.runs/team-43f4b14f-9ae9-4def-9825-09d2ef1df435`：left/right 并行通过后，combine 读取验收快照生成 84 并通过，约 89 秒。全程保留 domain_quality=not_checked，未推断性能提升或 token 总费用。

接下来可在这一内核上加入有工程意义的任务与检查器，并评估受硬约束限制的 LLM 决策策略。Docker 读取/资源隔离、任意依赖失效传播、桌面观察和 Electron 仍待实现。

### LLM Master 接入（2026-09-28）

新增 codex-master-v1 可选策略，默认仍为 evidence-v1，便于同一任务比较。Master 使用与 worker 相同的 CLI、gpt-6-sol 和配置 effort，但每次决策开启独立只读会话；通过 JSON Schema 返回动作、理由和修复建议。调度器注入检查历史、剩余次数与时间，将建议传给下一轮 worker，并独立拒绝无证据验收、未声明路线与无配置验证器。Master 不生成任务图，不修改验收规范。

Master 与 worker 分别保留原始用量；失败、超时和非法响应不自动回退规则。修复了按任务判断是否有补充验证器的能力信息，避免将其他任务的 verifier 误报为当前任务可用。取消或总期限到达后，迟到的模型响应不能触发验收。策略来源、调用限制写入 provenance.json。

43 项测试、类型检查、构建通过。真实试跑 `.runs/team-b0904e50-1952-48e3-a1e8-c8a88af3b3c9` 约 74 秒完成两次 worker 调用与两次独立 Master 决策：公开检查首轮 fail，Master 选择 resume；原会话修复后公开检查 pass，Master 选择 accept。检查覆盖之外的 domain_quality 仍为 not_checked。这只证明接入和决策传递，尚未评估管理策略相对规则的收益。

下一步是接入 FIFO 等工程任务及可信检查器，开展规则/LLM 策略对照。当前不承诺 10 倍效率，亦未完成 Docker 隔离或桌面主动观察。

### 本地工作台界面（2026-09-28）

新增 `npm run ui` 本地中文浏览器界面，绑定 127.0.0.1:4318，复用 team CLI。支持启动流程演示、规则真实示例及 LLM Master 真实示例；展示历史、任务状态、决策和检查证据，允许停止该 UI 启动的进程。额度提示、启动错误和无法确认进程的历史状态明确展示。没有任意命令/路径输入，也不把该界面宣称为自由任务产品。

API 端到端测试验证页面访问、令牌与来源校验、拒绝未确认的真实运行、路径越界拒绝，以及从启动 demo 到读取 completed 证据。增加 Windows 原子状态替换重试以处理界面轮询导致的短暂文件占用。当时尚未实现 Electron。

### Electron 桌面工作台（2026-09-28）

用户明确选择独立桌面 GUI，浏览器界面降为开发入口。使用 Electron 44.4.5、本地静态资源协议和受限 IPC，直接连接 TypeScript 管理服务；不启动 HTTP 服务。保留原 CLI 和执行协议。窗口采用运行列表、执行记录、子任务与检查证据三栏布局，提供原生菜单、Ctrl+N 新建运行、停止、报告和已验收文本产物预览。

渲染进程启用 sandbox/contextIsolation、禁用 Node 集成，IPC 校验发送窗口和主 frame；只允许预设启动及受限证据读取，产物预览重新检查 SHA256。单实例启动，正在运行时退出需选择停止并退出，等待进程树结束。历史运行不会自动恢复。项目本机快捷方式可直接启动开发版，尚无安装包。

验证：46 项测试通过，新增桌面服务真实 fixture 启动到验收产物读取的测试，以及篡改产物、未验收产物和越界读取拒绝测试。实际独立窗口已打开并检查三栏布局与历史证据。界面仍只运行预设示例，自由目标规划、桌面主动观察和复杂工程收益评估继续保留为后续工作。

### 聊天交互重做（2026-09-28）

用户明确要求参照 Codex 桌面端截图：新聊天直接进入空白对话，克制的项目/聊天侧栏、中央留白、底部输入框，移除示例选择弹窗和常驻日志面板。桌面页面重做，正文 17px、侧栏 15px；历史协作证据仅按需展开。刷新只在数据改变时更新消息，用户阅读上文时不强制滚动到底部。

新增持久化聊天服务，复用 Codex worker 与进程终止实现，GPT-6 Sol/high、现有登录、workspace-write。每个聊天独立工作目录，后续消息恢复同一 session，保留原始日志；进程中断不冒充完成。当前一次执行一个对话，单轮 30 分钟上限。自由聊天暂未接入多代理规划和外部验收，模型回复不表示已验证。

48 项测试通过，类型检查和构建通过。临时目录真实两轮验证：第一轮记住口令“青松”，第二轮恢复会话准确返回口令；测试数据不出现在用户聊天列表。实际桌面窗口已重启并检查布局。用户在调整窗口，未继续抢占鼠标操作。

### 执行设置与交互（2026-09-28）

输入栏增加模型/推理强度、权限和子 Agent 三个设置入口，替换没有操作价值的“工作空间”文字。模型来自本机 Codex models_cache 的可见目录，按模型限制推理档位；服务端再次验证，失败不自动更换模型。选项写入每轮 options.json 和 chat.json，恢复对话保留选择。模型目录存在不代表所有模型都已在此账号实测。

权限映射 read-only、workspace-write、danger-full-access，默认 workspace-write。当前非交互 exec 通道没有逐项批准 UI，因此不展示“请求批准／帮我批准”假选项。子 Agent 可关闭或配置最多 2/4 个，启用本机 CLI 的 multi_agent V1、禁用 V2，max_depth=1；沿用主 Agent 模型与权限。它们是 CLI 内的子会话，尚未等同于现有 team 管理器的独立验收与快照交接。

项目标题仅展开/收起，不再隐式清空当前对话；侧栏折叠、菜单 Esc/点击外部关闭、上下键选择、推理滑块键盘操作，以及减少动画偏好均已考虑。运行期间设置不可改，改变仅影响下一轮。模型/权限参数依据官方配置与本机 CLI 帮助：[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[权限说明](https://learn.chatgpt.com/docs/security)。

真实验证：GPT-6 Sol/low/read-only/最多 2 子 Agent 的执行成功，底层 session 记录实际 spawn_agent 与 wait_agent 调用，结果 42。CLI JSONL 当前只显示 wait，没有完整子会话列表，界面不编造子 Agent 状态。测试证据保存在 .local/settings-smoke-result.json 指向的临时目录。
验证完成：50 项测试、类型检查、构建通过；桌面实际点击模型切换、只读/项目内编辑、子 Agent 开关、项目收起/展开，操作推理滑块及左右键、Escape 关闭，检查菜单布局。测试后恢复 GPT-6 Sol/high、项目内编辑、子 Agent 关闭。

### 自由工程目标接入验收闭环（2026-09-28）

GUI 增加原生项目目录选择、计划审阅、执行计划与交付目录入口。规划器读取项目快照，给出一个实现任务、交付文件、验收要求与 Node 测试；执行前冻结快照和检查。现有 team 管理器用 evidence-v1 规则管理 Codex worker，失败恢复原会话、重复失败切换路线、基础设施错误停止。工程模式固定 workspace-write、关闭内嵌子 Agent，原项目不自动覆盖。

首版范围：已有 Node 内置测试的纯 JavaScript 文本项目，无自动依赖安装，最多 300 文件 / 2 MiB。规划 180 秒、每次实现 300 秒、最多四次、总计 20 分钟。当前一次一个实现任务，不是自动多任务 DAG。检查通过仅表示冻结测试通过；新增测试仍由模型起草，完整需求覆盖与恶意代码隔离均未实现。进程中断保留证据，不自动恢复；待执行计划可在重启后启动。

工程记录保存在 .engineering，执行证据沿用 .runs。检查在 attempt/checks 内独立重放，避免和 worker 的排他日志文件冲突。运行子 Node 测试时清除继承的 NODE_TEST_CONTEXT，防止父测试进程使子测试静默跳过。

验证：53 项测试通过，TypeScript 构建通过。新增回归覆盖失败→同会话修复、worker 改写测试副本不能影响冻结检查、原项目不变、重启执行与取消拒绝交付。真实 GPT-6 Sol/medium 经现有登录执行文本规范化改动，6 项测试通过，原文件不变；证据位于 .runs/team-5d809706-fba0-40bd-84c8-7c33290422ae。首次真实运行曾因日志路径冲突停止，失败记录保留，未计作成功。原生窗口已检查项目列表展开、真实结果展示及交付按钮。此次仅验证链路，不构成成功率或效率提升证据。

### 多任务工程计划与合并验收（2026-09-28）

工程规划 schema 新增 1–8 个任务，每个任务含目标、依赖、独占交付文件和冻结验收测试。旧单任务计划保留原内容与哈希，可继续执行。执行前拒绝重复 ID、循环/未知依赖、大小写或父子路径冲突，以及与总交付清单不一致的计划。

复用 team 调度器，最多两个任务并行；每个任务拥有独立工作目录和会话。后续任务以原始项目快照加全部已验收祖先产物为输入，交接重新验证 SHA256，检查器不信任 worker 修改过的依赖副本。所有任务验收后，将产物合并，重跑基线、每个任务的测试和全局验收。只有整体通过才创建 delivery；合并失败会保留检查结果并禁止交付，目前不自动重规划跨任务修复。执行和合并检查共用 20 分钟期限。

GUI 展示任务依赖、状态、每次执行检查与最终合并结果。测试与日志默认折叠，状态刷新保留已展开内容。资源管理当前仅限制并发和时间，尚未按 CPU、内存或任务收益动态分配。仍限已有 Node 内置测试的 JavaScript 工程，不包含 Docker、桌面观察或任意工程环境支持。

验证：56 项测试和 TypeScript 检查通过。新增测试覆盖实际双任务并发、后续任务交接、依赖副本改写不影响检查、合并失败拒绝交付及非法计划拒绝。

真实运行补充：GPT-6 Sol/medium 将文本工具集拆为 normalize、count 和依赖两者的 summary。前两个任务于 13:25:01 UTC 同时启动，均验收后 summary 于 13:25:49 UTC 启动；最终 6 项合并测试通过，三个交付文件已生成。证据：.runs/team-a89fc7ec-e5f8-487a-b61a-6f0130ee2a3a，工程记录 701b56b9-b14e-4f3a-aba1-75053b4c0e91。此次通过服务层启动同一份真实规划结果；用户正在桌面窗口输入，未抢占输入或点击执行按钮，因此本轮不声称完整 GUI 点击端到端验证。仅验证链路，不推断效率或成功率收益。

### 消息链接与运行记录交互（2026-09-28）

消息中的 Markdown 链接渲染为带下划线的可点击链接，支持相对文件路径、带空格的绝对路径和 HTTP(S)。其余消息保持转义，代码示例不变为可点击链接。本地路径由主进程按当前聊天工作目录解析，并检查真实路径边界；可预览文档交给默认应用打开，其他文件仅定位，避免把脚本链接作为程序执行。运行记录改为同一按钮展开/收起，去掉面板的关闭 ×。

验证：58 项测试、构建通过；实际桌面点击验证记录面板展开与再次收起，确认教程消息已渲染成链接，并点击相对路径教程入口。

### Manager / Worker 模型配置分离（2026-09-28）

工程规划保留 Manager 的 model/effort，新增独立 Worker 默认 model/effort。计划待执行时可对单个任务覆盖；执行前验证本机目录、任务 ID 和推理档位，随后冻结并保存执行配置。每个任务构造自己的 Codex worker，恢复及换路线沿用该任务设置。旧计划缺少 Worker 设置时使用原配置，不改动 planHash。

GUI 在工程模式中将主模型按钮标为 Manager，Worker 菜单提供独立模型/推理强度；任务详情支持单独覆盖。Worker 默认偏好保存在本地。Manager 当前仅用于规划，执行期仍由 evidence-v1 规则管理；普通聊天 CLI 内嵌子 Agent 沿用普通聊天配置，尚未接入本次分离。

规划器与每次 Worker attempt 均保存 options.json，provenance 包含执行默认值与覆盖项。59 项测试、构建通过；新增行为测试验证规划配置与 Worker 不同、任务覆盖优先、跨重启保留、非法配置拒绝和实际 worker 工厂收到的配置。该测试使用注入 worker 执行本地检查，不宣称不同真实模型的效果评估。

### 工程 Manager 决策与跨路线失败记忆（2026-09-28）

工程服务接入 codexMaster，使用工程计划锁定的 Manager 模型/推理强度；明确检查失败且有尝试余额时调用，单次上限 120 秒并计入总期限。通过、基础设施错误、缺失必需证据和耗尽尝试按固定规则结束；模型异常不静默降级。provenance 策略为 engineering-master-v1。调度器继续强制检查与产物哈希门槛。

每次 attempt 保存 memory.json，将过往路线、检查、产物哈希和决策传给新会话；保留原始检查日志，不用模型摘要替换证据。decisions.json 和 state.json 保留管理决策。旧版本证据明确不能证明新候选正确。

61 项测试通过，包括工程层 Manager 配置传递、失败后换路线与失败记忆、恶意接受失败产物被拒绝。使用注入 Manager/worker 加真实 Node 检查；本轮未做真实模型运行或视觉检查。并行竞争同一任务、独立挑战者、自动崩溃恢复仍待实现；当前并发仍是独立任务分工。

### 双路线竞争与入选复查（2026-09-28）

工程执行支持 candidates=2，桌面待执行计划新增「两条路线竞争 / 单路线」选择；未提供该字段的旧调用保持原行为。调度器一次推进一个逻辑任务，两个独立候选会话同时工作，每条最多两次 Worker 调用，合计四次。复用现有 Manager 对失败证据做修复/停止决策；候选内部只有一条声明路线，不允许借 switch 增加候选。

候选分别运行冻结检查；两者结束后按声明顺序尝试复查通过者，从验收快照复制产物、核对哈希、再次外部重放后才交给依赖任务。最后仍有整体集成检查。保留候选失败/错误、入选记录和复查报告。取消、期限和证据写入故障通过现有控制链处理。

65 项测试通过，新增真实并发屏障、失败候选淘汰、入选重放失败、取消、依赖交接与确定性平局处理。官方设计参考记录在 agent-design-references.md。当前并非独立 Agent 生成挑战测试，也不做质量最优排名；目录隔离不代表恶意代码安全隔离。

真实链路补充：固定测试计划 + 两个真实 GPT-6 Sol/medium Worker 并行执行 sum 钳位任务；会话各约 58/65 秒，均一次通过，两份产物哈希相同。入选复查及最终集成检查通过，工程记录 7ea28efa-4e87-4464-b654-47f29f80b479，运行 .runs/team-a0ff8d84-2cdc-4309-8a84-46373f22709b。本次未调用真实规划器/失败决策模型，也未完成 GUI 视觉检查；只证明执行链路，不证明多样性、成功率或效率收益。构建与界面脚本语法检查通过。

### 通用执行边界与 ProgramBench 单题（2026-09-28）

新增 ExecutionAdapter，将环境准备、Worker、公开检查、收集产物、关闭资源、最终评分与团队调度分离。ProgramBench 首个适配器固定为 tomnomnom__gron.88a6234，通过 CLI 使用现有 team 的双候选和入选复查流程；旧 Node 工程和 GUI 入口保持原有范围，尚未迁移为任意工程执行器。

候选使用 WSL Docker cleanroom_v6，普通 agent 用户、断网、2 CPU / 4 GiB、删除全部 Linux capabilities。仅挂载模型 Unix socket、非敏感占位登录文件、工具和适配脚本；真实 ChatGPT 凭证留在宿主。宿主代理只转发限定模型端点。公开检查在新的断网容器中从源码重建，使用运行前固定的四个差分案例。选择及 SHA256 写入 selection.json 后关闭 Worker，再调用固定版本的官方评分器；隐藏结果不能回流或挑选候选。

本轮管理用规则策略，不含 LLM Manager 效果比较或单 Worker 对照。评分取消/失败清理资源，禁止把取消记成完成；异常退出后的自动恢复尚未实现。未来新运行会保存适配脚本快照。本轮真实试跑在开发期间启动，使用当时的脚本与后续修正的评分桥接，不能视为冻结策略评估。

环境约束：cleanroom 默认 root 在 cap-drop ALL 后无法写 agent 所有的 workspace，必须显式 --user agent，并用 sh -ec 验证 oracle 移动和目录可写；Linux Codex 需同目录 codex-code-mode-host。WSL 对模型服务的直连在本机不可用，使用宿主代理，不能将代理网络传入候选。早期启动/连接失败记录保留，不计作有效解题样本。

真实结果：.runs/programbench-c23a07c8-6091-4c78-af69-37e19a5c646f。两条 GPT-6 Sol/medium 路线各一次完成，各通过 4/4 公开案例；声明顺序选 candidate-1，外部复查通过。官方过滤后的单题得分 0.7098214285714286（70.98%），未完整解决该题。评分器无 errorCode、无 branchErrors、无 warnings。首次评分依赖安装直连 PyPI 超时并出现 results_read_failed，关闭后仅为官方评分容器配置代理，对相同冻结 SHA256 重新评分；没有重新启动 Worker、修改提交或依据隐藏结果改变选择。首次日志和 recovery.json 保留。结束时本次容器与模型代理 PID 均已清理。

验证：70 项自动化测试通过，TypeScript 构建及 Python 语法检查通过。新增测试覆盖选择冻结、关闭 Worker 后才能评分、公开失败不评分、产物哈希变更拒绝以及评分取消清理。此次未改 GUI，未声称视觉验证。下一步应补桌面入口及可见的「公开检查通过 / 官方未完全通过」状态，再冻结策略与单 Worker 对照，扩至 3–5 题；本次不能证明成功率或效率提升。

### 普通 Codex 单会话基线对照（2026-09-28）

candidates=1 现明确限定一次完整 Worker 调用，不做外部修复或换路线。正常提交即使公开检查失败也评分，不把低分样本筛掉；管理组验收门槛不变。超时先暂停容器、保存源码与会话用量，再清理；基线可评分超时快照，但保留 timeout 状态。无提交或基础设施错误不冒充解题失败。正常 token 统计用 turn.completed，超时使用 session token_count 最后累计记录，可能缺在途请求。通过真实无模型 Docker 超时夹具验证冻结、导出、用量与清理。

首次基线 .runs/programbench-ed95e8cd-bc60-4bba-9388-96071533ceb3 超时，旧桥接直接清理导致源码和完整 token 丢失，不能评分。保留该记录；修复后按相同配置重跑，未读取首次分数或修改解题提示。该失败尝试成本不包含在下列有效运行数字中，不能用这些数字宣称本轮实验的总成本优势。

可评分基线 .runs/programbench-b093a9f9-3b4c-4377-9550-a9c4ca51f062 正常完成，公开检查 4/4，官方 74.11%（166/224），无评分器错误、分支错误或警告。输入 315939（缓存 277888），输出 8268，总 token 324207；执行含检查墙钟 365.107 秒，评分及收尾 327.374 秒。本机已清理本次容器与模型代理。

历史规则管理双 Worker 得分 70.98%（159/224），总 token 565595，执行墙钟 505.254 秒。本次管理组低 3.125 个百分点，用 1.7446 倍 token，没有观察到收益。两组模型/effort/镜像/上游提交/CLI/公开案例哈希一致，基线任务提示与历史 candidate-1 哈希相同。历史组与新基线的适配脚本存在基础设施修正差异，且每组仅一次，不能推断一般收益。详见 programbench-first-comparison.md。

验证：72 项测试通过，TypeScript 构建、Python 语法通过。新增基线公开失败仍评分、不增加调用、超时快照评分保留状态的行为测试。尚未评估模型 Manager 的自主分工。后续重点是根据公开证据改进管理策略，再冻结配置做未调优任务对照，不能根据 gron 隐藏反馈修复后当作泛化证据。

### 对照分数纠正：评分环境污染（2026-09-28）

事后分析确认 grade() 向整个评分容器注入的 HTTP_PROXY/HTTPS_PROXY 被候选程序继承，导致 localhost HTTP 测试走宿主代理并返回 502。用两份冻结提交分别重建并运行同一本地 HTTP 小例子：无代理均通过，有代理均失败。此前分数与排名结论必须暂缓；不能因 errorCode/branchErrors 为空宣称环境无误。尚未修复或完整重评，不能断言所有 URL 失败都由此造成。诊断详见 gron-experiment-diagnosis.md，比较报告顶部已标记。token 观察值有效，首轮缺失成本和单样本限制仍在。

代码追踪还确认双候选采用声明顺序选首个通过者，两者都通过时第二候选对交付无影响；本次没有互补分工、独立挑战或模型 Manager 决策。下一步应先隔离依赖安装代理与被测程序环境，验证后只重评冻结提交，再讨论架构收益。gron 隐藏结果已用于事后诊断，后续不作为未调优泛化样本。

### 完成冻结提交重评（2026-09-29）

已将官方评分容器的通用 HTTP 代理改为 pip 专用 PIP_PROXY。两份冻结提交均通过 localhost 回归检查；新增 regrade-programbench.ts 只对相同归档重评并保存独立证据，不调用模型。A 177/224（79.02%），B 170/224（75.89%），各增加 11 项，差距仍为 3.125 个百分点。历史评分保留，当前报告见 programbench-corrected-comparison.md。72 项测试、构建及 Python 语法检查通过。此结果仍只覆盖规则管理双候选，不代表 LLM Manager 的收益。


### HWE 微架构管理闭环（2026-09-29，真实试跑完成）

新增通用 research-loop 与 HWE 适配器：结构化可验证假设、独立容器 Worker、冻结 RTL 快照、外部测量、按证据择优、跨轮失败记忆和有限预算。Manager 可以继续不同分支、修复失败快照、淘汰路线、分配各 Worker 时间或提前结束；检查门槛与最大资源由程序强制执行。默认无 Worker 间直接通信。

本机 baseline 连续两次完整验证一致；GUI 可以发起真实实验并显示检查阶段、候选指标和决策依据。83 项测试、构建通过，实际检查了模型/推理强度独立选择、记录导航、证据展开/收起及无横向溢出。开发试跑、正式普通 Codex 对照、管理组和官方参考组分别保存；当前运行及结果见 hwe-development-run.md 和 hwe-first-comparison.md，未完成的结果不预先宣称。

目前使用 Codex CLI 已有登录；Claude Code 的独立上下文和持久记忆机制作为设计参考，尚未接入执行后端。桌面观察尚未实现，仍作为后续触发来源。工具链路径为本机配置，未宣称通用安装器。公开验证范围和本机移植约束详见 hwe-readiness.md。

开发试跑 `research-befd4e2c-0275-449d-86ca-9a924d091646` 已完成两轮四 Worker，Manager 根据外部结果淘汰旧路线并从最佳快照分配下一轮。最终 39.94 iter/s，相对本机 baseline 30.79 提升 29.7%，LUT4 从 13,964 降至 7,565；耗时 64.39 分钟，记录 token 6,105,791（含缓存输入）。另两条路线性能退步、一条 RVFI/ISS 不一致均未覆盖最佳结果。正式普通 Codex 对照另行启动，此开发结果不证明管理架构优于普通 Codex。

### HWE 用量上限的错误分类与队列停止（2026-09-29，故障排查与修复）

首次正式对照在 2026-09-28 被模型**用量上限（HTTP 429）**中断：普通组候选被标记 `error`，但 CLI 返回 `0`，批处理队列因此继续启动管理组；管理组首个 Manager 调用随后也因额度耗尽失败，官方参考组未运行。两组均按未完成对照保留，不重跑择优。

排查确认三处缺陷：

1. `parseCodexLog` 的 zod `Event` schema 只保留 `type/thread_id/usage`，丢弃了错误事件的 `message`，额度错误与普通错误无法区分。
2. `research-cli.ts` 仅对 `run`/`resume` 设置 `process.exitCode=1`，`ordinary`/`native` 分支**永远以 0 退出**。
3. `ordinary` 的 `summary.json` 顶层没有 `status`/`error`，使队列的 `report.error||report.status==='error'` 判据同样失效。

修复：

- `classifyCodexFailure` 区分 `usage-limit`（用量/频率/配额/429）与 `provider-error`；`parseCodexLog` 保留最后一条失败消息。
- Worker 与 Manager 的基础设施失败都携带分类原因；研究循环把原因写入候选 `evidence.detail`。
- `ordinary`/`native` 报告新增顶层 `status`，CLI 在 `status==='error'` 时以退出码 1 结束，队列判据随之生效。

**语义约定**：模型用量、传输或验证器故障属于基础设施中断，保留证据并停止，**不记为解题失败**，也不据此推断成功率。行为测试覆盖额度错误分类、普通组两态、官方组状态谓词与研究循环的原因透传；测试增至 92 项，类型检查与构建通过。原始记录冻结在 `.local/hwe-interrupted-2026-09-28/`，中断说明见 [首次正式对照](hwe-first-comparison.md)。

补充回归测试（2026-09-29）：新增 `comparison` 动作，把「普通组 → 管理组」的顺序与停止规则并入 CLI——任一臂基础设施失败即停止，不再启动下一臂；`PROACTIVE_ARM_DEPS` 仅作为维护/测试的依赖注入缝，未设置时行为不变。端到端测试以子进程运行真实 CLI：普通组基础设施失败时退出码为 1 且**不启动管理组**；仅公开正确性检查不通过时退出码为 0，并作为**正常解题结果**记录（候选 `rejected`、`eligible=false`）。另加 readiness 复用判定 `fingerprintMatches` 的测试。测试增至 97 项，类型检查与构建通过。

环境指纹（2026-09-29）：当前指纹与 `.local/hwe-readiness/ready.json` 完全一致（同 commit、镜像 ID、verifier 与工具哈希），故**复用已有 readiness，未重复运行基线**。

冻结基线、验证器与评分规则未改动；未启动新的付费模型调用；正式对照待选定执行后端后按新批次重做。


## 2026-09-29：合并项目与 Manager 双后端调度

唯一活动目录为 D:/Projects/Proactive Agent。原 GUI 副本的源码、历史与账户容量记录已合并；4958 个运行文件无冲突迁移，清单保存在 .local/consolidation/runtime-manifest.json。旧副本移至 .local/consolidation/retired-gui-copy，仅用于恢复。桌面快捷方式构建并打开主目录。

GUI 提供 off / auto / fixed 三种委派模式。auto 允许主 Agent 自行完成或根据证据安排子任务；fixed 默认 10 个可用名额，可设 1–64，Manager 按有效任务分配，避免填满名额而制造工作。旧会话配置保持兼容。统一队列限制总并发 64、Codex 64、Command Code 32；数量设置是调度上限，不是稳定容量承诺。

普通目标使用持久化 Manager 决策轮次；分别记录任务、后端、隔离目录、Worker 回报与外部检查。最多三轮委派；跨轮/跨消息传递已记录证据。工程模式直接执行 Manager 计划，并继续运行冻结测试及整体验收。两种模式的 Worker 均接入统一队列。

Command Code 使用 DeepSeek-v4.1-flash/high。非交互模式写入需要 --yolo，因此只在配套 workspace-mod.mjs 启用：允许限定目录内文件工具，阻止 shell、委派、网络工具及越界/符号链接。此工具门控不是操作系统沙箱。Codex 保留 Sol 后端。普通目标外部检查只覆盖文件存在、哈希、JSON/JS 语法，不宣称功能正确；工程测试覆盖范围按计划显示。

验证：111/111 离线测试、类型检查及构建通过。修正旧测试中 /0.5/ 会误匹配时间戳的断言，改为检查评分字段泄漏。真实双后端记录 .local/managed-smoke-1790678020780：Manager 分配两个独立任务，Codex alpha.json 与 Command Code beta.json 均完成，文件内容另行核对符合请求，约 58 秒。此前写入被 CLI 门控阻止的试跑保留为失败证据。未重跑 HWE。Electron CDP 实际检查三个选项切换、默认数量 10，并截图检查黑色主题布局；主界面移除手动任务队列入口。

启动修复（2026-09-29）：桌面快捷方式遇到无可见窗口的已有实例时，second-instance 现在 restore/show/focus。Windows 启动脚本按退出码判断构建和启动结果，避免把 Electron stderr 诊断误报为致命错误；统一 UTF-8 日志。脚本源码保存在 desktop/launch-windows.ps1，部署到 LocalAppData/ProactiveAgent/launch.ps1。已通过真实桌面快捷方式验证首次打开和重复点击复用同一可见窗口。

启动入口补充（2026-09-29）：桌面及项目快捷方式改用 wscript.exe → launch.vbs → 隐藏 PowerShell 构建启动，避免控制台闪窗。Electron 增加 .gui-profile/lifecycle.log，记录启动、窗口显示、renderer 退出及应用退出。使用 Explorer ShellExecute 冷启动验证可见窗口。用户报告的未启动现象本次未复现，不能视为已确定根因。

快捷方式路径修正（2026-09-29）：用户反馈 WSH 找不到 LocalAppData 下 launch.vbs；检查时该文件存在且 cscript 可执行，未确认其消失原因。桌面和项目快捷方式现在直接引用项目内 desktop/launch-windows.vbs，脚本从 LocalAppData 读取既有启动配置。已用更新后的快捷方式经 ShellExecute 验证可见窗口。

启动入口简化（2026-09-29）：根据快捷方式属性反馈，将桌面「Proactive Agent 启动」改为直接指向项目 electron.exe，并将 desktop/main.cjs 配为入口。Electron 主进程从 LocalAppData/ProactiveAgent/current.json 读取匹配主项目的 Node 路径，CLI worker 使用此路径。去掉 PowerShell/VBS/build 中转；直接 ShellExecute 启动并验证生命周期记录 window-shown。

## 2026-09-29 — General project conversation before engineering workflows

The desktop composer always calls chatSend, regardless of project selection or delegation mode. A selected directory is persisted as chat.project and used as the primary Agent working directory; it is not eagerly copied through projectFiles. Empty/non-Node/binary/large projects can therefore be opened without a test baseline. Workspace-write now edits the selected project directly; read-only remains read-only. Existing engineering/HWE verification APIs and historical records remain available but are not implicit prerequisites for conversation.

The outer Minimal Agent handles greetings, identity questions, thanks and short small talk with GPT-6 Luna at low reasoning, read-only access and no sub-agents. Other messages continue through the selected direct Codex or managed Agent path. Substantive tasks can still delegate; worker directories live under the turn evidence directory to avoid creating agents/ in the selected project. Relative artifact links resolve against the persisted project, retaining containment checks. A chat cannot silently switch project directories after starting.

Minimal Agent now uses the local Codex app-server JSON-RPC stream. Final-answer deltas are persisted as they arrive and rendered in the conversation before the completed item replaces the draft. The CLI remains the path for all other messages. On the installed Codex app-server, a local handshake passed and a real Luna/low small-talk turn completed with 23 delta events plus one final event in 7.5 seconds; this reduces blank waiting but does not reduce model/network first-token latency. The app-server protocol is experimental and may change with Codex upgrades.

Sidebar conversations without an assigned project now appear directly above project folders. Pinned chats have a persistent top section; each chat row menu can pin/unpin or delete, with deletion confirmation in the renderer and an active-run guard in the service. Build, renderer/main/preload syntax checks and 6 chat-service tests passed, including pin persistence, deletion, and refusal to delete an active chat.

Verification: 117/117 tests, TypeScript build and renderer syntax checks passed. Includes all three modes, non-Node project with binary content above the old size limit, persistence across service restart, project link containment and actual composer routing. Real Sol/medium auto-mode smoke `.chats/671d5f96-f9e3-49f3-852f-90c982b76530` completed: greeted user and read hello.py in a testless Python directory, no delegated workers. Functional correctness of arbitrary future tasks remains dependent on task-specific validation.
Installed Legion updated with matching executable/ASAR after graceful close; user profile preserved. Actual installed GUI greeting completed (hi → Hi!, no workers) and screenshot inspected: .playwright-cli/page-2026-09-29T12-37-57-137Z.png. GUI-DEVELOPMENT.md corrected to describe the installed shortcut rather than the obsolete script launcher.

## 2026-09-29 — Independent challenge, repair and re-verification

Delegated artifact tasks now carry explicit acceptance criteria. After submission, a fresh Codex challenger receives only the contract (not implementation claims or source) and generates one executable assertion script per criterion. The challenge is frozen across at most two repair attempts. The original Worker backend performs repairs using concrete failure logs. Parent cancellation/deadline bounds the entire loop.

`src/challenge.ts` runs checks against copied regular-file snapshots under Node's permission model (snapshot reads, no writes/child processes; not an OS sandbox or network isolation guarantee). A missing-candidate control must fail, and malformed checks/declared limitations remain unverified. Contract, verifier and artifact hashes plus all version results are retained. Final acceptance rechecks live and snapshot artifact hashes. A Manager success message or direct-work fallback cannot bypass unsuccessful delegated acceptance. Historical failures remain in the version list and a repaired accepted version can complete that task.

The first validation adapter supports assertions over JSON/text and pure JavaScript modules with built-in Node libraries. It does NOT establish Python/RTL/UI simulation support, adversarial-code security, exhaustive correctness, semantic adequacy of every LLM-written test, or multi-artifact integration correctness. Unsupported tasks remain unverified; ordinary conversation is still available without a test baseline. Skills/cron/event-driven scheduling are not implemented by this change. Manager direct execution and subagent-off tasks do not gain independent functional acceptance from this change.

GUI now displays submission, independent challenge, validation, repair, accepted and unverified states, with expandable failed/passed version evidence and fingerprints. This change is in source/Beta; stable installation was not updated.

Verification: initial complete suite 123/123 passed; after adding malformed-check classification, targeted challenge tests 7/7 and build passed (124 tests now present). Real controlled smoke `.chats/da5bb483-6e84-4a37-9238-89be9214ca36`: deterministic Manager/initial defect injection, real Sol/medium independent challenger and repair Worker, completed in about 94 seconds. First candidate implemented Math.min, failed max(2,7); second implemented Math.max and passed the SAME verifier hash. This is a controlled integration check, not a benchmark or evidence of general efficiency improvement. Evidence summary: .local/challenge-smoke-result.json.
Final verification: 124/124 complete-suite tests passed. GUI evidence panels were exercised with Playwright using the actual managementView function and stylesheet plus the real smoke record in an isolated preview; both version panels expanded, long logs were bounded, screenshot inspected at .playwright-cli/page-2026-09-29T13-26-31-898Z.png. Restarting Beta with a debugging port was rejected by automatic policy review; no forced restart was attempted, so full desktop recheck is not claimed.

### 2026-09-29：统一证据验收增量

详见 [统一证据验收](acceptance-loop.md)。work / delegate / finish 和关闭 delegation 的工程交付共用验收门槛；Manager/Worker/Challenger 接已有队列，依赖任务复用 team DAG 与已验收快照。新增契约、候选 manifest、运行时功能证据、根产物检查、角色/skill 注入审计、预算与排他 attempt 记录。修复 team checker 不提供 hash 时的版本绑定缺口。

此前“独立生成测试通过即可 accepted”的结论已收紧：生成测试属于审查提案，必须另有宿主安装的功能验证器覆盖需求。当前生产内置仅支持严格匹配的 JSON 数值聚合任务；其他任务可执行但仍可能未验证。离线 demo 证明错误候选→真实反例→修复→根产物验收，不代表多 Agent 效果测评。真实模型 smoke 明确 opt-in，本轮未运行；HWE 实验未启动或修改。

UI 展示执行与验收不同状态，旧历史不升级为验收通过。真实浏览器视觉检查被自动审批审核拒绝，保留未验证说明；未改稳定安装包。

最终验证：typecheck、build 通过，151/151 测试通过；`demo:acceptance` 在 `.local/acceptance-demo-1790695167856/` 完成两次实施和最终验收。默认真实 smoke 拒绝启动已验证，未调用模型。依赖副本发生变化也会使下游验收失败，不能静默替换固定输入。

## 2026-09-30 — 可恢复工程任务 v0.1

本轮重新核对 HEAD `509c151`：原有 goal-resume、DAG、独立挑战和 WeakMap 验收都存在，缺口是工程产品流程未将它们接成跨进程恢复链路。本机修改前重新执行 typecheck/test/build/acceptance demo，151 项测试通过，日志 `.local/resume-baseline.log`。

新增 `engineering-run.ts` / `engineering-store.ts` 持久化恢复服务，复用 `runTeam`、现有 pool、challenge/acceptance 与工程检查。`engineering-product.ts` 接入桌面 IPC，增加明确批准、暂停、恢复和取消；旧记录历史只读。新增 CLI/offline demo/显式 opt-in smoke。恢复只从安全边界继续，未知在途调用阻塞且保留预算，源项目与验证器版本变化阻塞。当前开发任务没有调用付费模型，没有改动 HWE/SaaSBench 协议或稳定安装包。

详细使用、验收与恢复边界见 [resumable-engineering.md](resumable-engineering.md)。这不代表任意中断安全、多日生产可靠性或效率提升已验证。

本轮最终验证：`npm test` **165/165**；`npm run typecheck`、`npm run build`、桌面 JS 语法检查通过；`npm run demo:acceptance` 与 `npm run demo:resume` 通过。最终日志：`.local/resume-full-tests.log`、`.local/resume-acceptance-demo.log`、`.local/resume-demo.log`。最新恢复演示：`.local/engineering-resume-demo-1790704898699/demo-result.json`，同一 Run 在 epoch 1 暂停、epoch 2 完成，A/B/total 各实施一次，模型 fixture 调用从 1 累计到 3，deadline 不变。真实 smoke 缺少 opt-in 时拒绝启动的检查也通过，记录 `.local/resume-smoke-gate.log`。

未执行真实付费模型 smoke、原生 GUI 视觉检查和多日运行；仅桌面服务接口与前端路由/语法经过自动化验证。开发版本使用新入口，稳定安装包没有替换。

## 2026-09-30 — Worker 模型选择窗口

输入框新增独立 Worker 选择窗口，支持搜索 OpenAI/Codex 模型、选择对应推理强度、重新读取本机模型目录与本地保存。列表沿用 Codex `models_cache.json`，显示缓存来源，不把目录项宣称为已通过账号权限验证。本机当前读取 8 款模型。

`ChatOptions.worker` 单独验证并保存在聊天配置中；普通管理聊天派发 Codex Worker 时应用它，Manager/独立挑战者保留主模型，Command Code 保留其后端配置。工程模式沿用 `workerOptions` 冻结执行配置，重开可恢复任务时从已记录的 Worker 配置显示模型。本轮没有调用付费模型。

验证：完整回归 194/194 通过（.local/worker-model-tests.log）；typecheck、build、desktop/app.js 语法检查通过。未进行原生 GUI 视觉检查。

## 2026-09-30 — 通用对话默认入口

新聊天默认通用对话，选择项目仅提供上下文；切换回历史聊天重置可恢复模式，避免后续消息误入工程规划。工具栏“工程任务”改名“可恢复任务”，移除输入框中的 Node 测试要求，项目入口简化为“选择项目”。

显式启用可恢复任务时，先进行不调用模型的支持检查；缺少 Node 测试或当前快照格式不支持时，保留原输入和项目转入普通对话并显示限制说明。不放宽可恢复运行的冻结检查、批准和验收约束。普通执行缺少验收证据时保留带待验证标签的回复；已被反例否定或基础设施阻塞的结果继续阻止成功宣称。通用验证器覆盖面没有因此扩大。

Electron 使用实际页面和离线接口夹具完成截图与模式切换检查：初始关闭、开启成功、新聊天恢复关闭；结果位于 `.local/general-entry-visual.json` / `.local/general-entry-visual.png`。相关行为回归 18/18 通过，typecheck/build 通过；本轮未调用付费模型。
完整回归：197/197 通过，日志 `.local/general-entry-tests.log`。

## 2026-09-30 — 持续目标与动态跨轮调度

新增 persistent-goal 服务并接入桌面产品，复用 sharedPool、runTeam、独立挑战、候选验证以及工程持久化锁。Manager 按跨轮证据选择任务、后端、并发和最终候选；失败路线保留。累计模型/验证预算与原截止时间不因恢复重置。轮次中途状态未知时拒绝自动重派；暂停在轮次边界收尾，恢复重验候选。

新增冻结输入的联系人清洗 Host 验证器，真正执行外部 Node 对照，期望值不由模型产生。GUI 显示持续目标、轮次分配、检查与预算，提供暂停、继续、取消和交付入口。设计与边界见 [persistent-goals.md](persistent-goals.md)。默认 24 小时/8 轮/64 次模型调用，尚未实测付费后端长时间可靠性，没有接桌面观察。

三个独立演示进程完成同一 Run 的失败路线 → 暂停 → 换后端成功 → 暂停 → 重验集成交付，调用累计 4/6/7，deadline 保持不变。模型与后端响应为明确离线夹具，外部验证真实执行。Electron 使用实际界面配离线接口完成模式互斥/重置和截图检查，记录 `.local/persistent-goal-visual.json` / `.local/persistent-goal-visual.png`。
最终验证：完整回归 204/204 通过（`.local/persistent-goal-full-tests.log`）；typecheck/build 与桌面脚本语法通过。额外针对持续目标与输入入口的最终回归另存 `.local/persistent-goal-final-targeted.log`。持久化决策记录同原始数据一起落盘；未重跑 HWE 或进行任何付费模型调用。

## 2026-09-30 — 恢复能力不再作为输入模式

移除输入框“可恢复任务”开关。普通对话与持续目标代表用户意图；保存与恢复属于运行机制。已有工程记录的批准、暂停、继续和验收接口保留，持续目标继续自动保存跨轮证据。普通聊天目前保存消息上下文，尚未拥有持续目标相同的执行检查点恢复；不能把移除按钮理解为任意工具中断后均可无感重放。

参考官方 Codex Goals 文档（https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex）：目标状态属于会话，自动续跑在轮次结束等安全边界发生。保持既有未知在途执行阻塞规则。

验证：入口和持续目标行为测试 11/11 通过（`.local/builtin-recovery-tests.log`）；typecheck、build、桌面脚本语法检查通过。Electron 实际页面配离线接口检查按钮移除、目标切换、新聊天重置、历史目标与交付入口，并查看截图（`.local/builtin-recovery-visual.json` / `.local/builtin-recovery-visual.png`）。未调用付费模型。

## 2026-09-30 — 通用主会话与客户端委派工具

普通聊天改用 Codex app-server 的持久 thread；保留 Codex 原生工具与指令，仅追加管理职责。移除聊天服务中的问候特判和只读 JSON 规划入口。主会话可以直接执行任意项目任务，也能用 dynamic tools 调用双后端队列、读取证据、等待、取消、补充 Worker 指令。线程 ID 在 turn 开始前保存；旧会话迁移携带聊天历史。

GUI 增加原生文件选择、可移除附件和子任务结果。固定子 Agent 数量是上限；关闭委派时运行时拒绝派发。普通主轮次上限为 6 小时。详细边界和真实执行证据见 [primary-agent.md](primary-agent.md)。旧持续目标/工程入口仍兼容；普通执行结果不冒充 Host 验收通过。没有重跑正式 HWE 对照或更改评分规则。
验证：完整回归 209/209 通过（`.local/primary-verified-tests.log`）；typecheck、build 和桌面脚本语法通过。真实 Sol 主会话读写与命令断言、同 thread 重开续跑、新工具派发 Codex 子任务后主会话独立断言均成功；原始日志确认命令退出码 0。Command Code 新工具分支本轮使用离线执行器测试，未重新做真实 Command Code 模型调用。Electron 实际页面配离线 API 检查附件添加/移除与截图。恢复范围是会话和已记录子任务，不宣称任意中断命令能自动续跑。

## 2026-09-30 — 本地文件拖放

补齐 Electron 拖入附件入口：preload 通过 webUtils.getPathForFile 获取实际磁盘路径，主进程检查存在性与文件/文件夹类型后登记；聊天接收文件夹上下文。拖入高亮、放下清理、去重和可移除附件复用原发送链路，不触发导航或自动发送。目录作为附件上下文，不自动切换当前项目。

20 项相关测试、typecheck/build 与桌面脚本语法检查通过。实际 Electron 页面使用真实 preload 和主进程登记函数，通过 Chromium 原生拖放事件拖入 package.json 与 docs 文件夹；两项均显示且登记路径正确。截图与结果见 `.local/drop-result.png` / `.local/drop-result.json`。未调用模型。

## 2026-09-30 — 文件粘贴与可见附件卡片

补齐输入框 Ctrl+V 文件粘贴：优先使用原生 File 的磁盘路径，Windows Explorer 文件复制使用 STA 剪贴板文件列表读取；普通文本粘贴保持原行为。主进程确认路径后才显示“已添加”，失败给出明确反馈。附件采用横向卡片显示文件名、类型、状态、移除按钮，悬停查看完整路径，顶部显示总数量。“已添加”仅表示本地上下文已加入待发送消息，不表示模型已读取或文件已上传。

使用用户指定的 5 个 PDF 的实际文件路径，在 Electron 原生拖放获得磁盘 File 后通过粘贴事件完成接入：5 张卡片均出现，移除后剩 4 张，登记路径与输入一致；未阅读 PDF 内容。Windows 剪贴板列表读取也单独运行成功，未改写剪贴板。13 项相关回归、typecheck/build 与脚本语法通过；截图 `.local/paste-cards-result.png`，结果 `.local/paste-cards-result.json`，日志 `.local/paste-tests.log`。未调用模型。
# 桌面附件加载修复（2026-09-30）

正式 proactive 协议曾遗漏 drop-files.js 与 attachment-cards.js，导致 app.js 模块加载失败，拖放和界面初始化均未执行。资源入口现统一为 desktop/resources.cjs；测试必须复用正式资源入口，不能用任意文件均可访问的测试路由替代。新增模块依赖图回归测试，覆盖附件模块和非公开资源拒绝访问。使用正式入口、沙箱 preload 的 Electron 窗口验证 5 个本地 PDF 拖入、粘贴卡片与移除；类型检查和构建通过。粘贴测试使用真实文件对象触发事件，未模拟系统按键。

## 2026-09-30 — 普通主会话的跨轮子任务记录

子任务每次启动、续跑保存独立 attempt.json，并在 task.json 中保留历史指令、模型/推理强度、时间、结果和证据位置。修复成功不覆盖旧失败；旧任务续跑保留已有摘要，不补造缺失历史。legion_tasks 提供历史读取和轮次状态。GUI 分次显示失败和待验证结果，自动刷新保留证据展开状态，历史中断不会仍显示执行中。

派发及续跑登记串行化，Worker 执行仍并行；防止并发续跑同一任务，关闭时等待登记收尾。新增回归覆盖失败→修复→重开读取、同任务并发续跑拒绝和 10 个同时派发请求下的单名额约束。

216/216 全量测试通过（.local/task-history-tests.log）；typecheck、build、renderer 语法通过。正式资源入口与 sandbox preload 的 Electron 窗口用离线数据检查历史展开和截图（.local/task-history-visual.png）。未调用付费模型、未重跑 benchmark。记录不是冻结产物或验收认证，普通入口的强制独立验收仍未全部接通。当前打开窗口需重启 Beta 才加载新的主进程实现。

## 2026-09-30 — 普通主会话交付验收入口

新增 legion_delivery prepare/check/read，复用已有候选快照、独立挑战重放、宿主功能验证与 currentEvidence。登记的契约本轮不可修改，最多三个候选，修复重用同一挑战。未检查/被否定/受阻的已登记交付使主会话不能记为 completed；无契约或无可信覆盖保持 unverified。关闭子 Agent 不启动挑战者。挑战者通过主会话子任务名额及统一队列执行，包含在调用与取消约束内。

GUI 展示根交付要求、候选版本、独立检查和外部检查；聊天服务保存本轮证据位置。旧主会话迁移到含新工具的 thread，以保存的聊天历史提供上下文。适用范围和限制详见 primary-agent.md；当前功能认证范围仍窄，尚不能认证通用 HWE/任意仓库，不自动识别所有必须登记契约的需求，也不是跨轮恢复服务。

全量 220/220 通过（.local/primary-delivery-tests.log）。随后补齐挑战者共享名额并增加测试，最终相关 12/12 通过（.local/primary-delivery-final-targeted.log），typecheck/build 通过。验证错误候选→同检查修复通过→产物变动失效、关闭委派、未知覆盖、检查预算及 app-server 完成门槛。模型与 app-server 响应使用离线夹具，检查进程真实执行。正式 Electron 资源入口配离线接口渲染真实测试证据并查看截图（.local/delivery-visual.png）。未调用付费模型或重跑 benchmark；未重启用户正在使用的实例。

## 2026-09-30 — 主会话跨轮恢复交付要求

legion_delivery 新增 resume，read 提供历史摘要。宿主从当前聊天的已记录轮次定位上一次交付，普通聊天后仍保留 lastDeliveryTurn；工具不接受任意历史文件路径。恢复保留原始需求、输出和已生成挑战，当前状态回到 pending，重新捕获产物并运行检查；旧 accepted 不授予本轮信任。历史内容经过结构验证，坏记录不能污染新契约登记。无关需求仍可 prepare 新任务，继续/新任务的语义判断由主 Agent 完成。

GUI 展示历史结果与本轮验收，保留来源关联。新用户轮次按本轮预算运行，不等于旧持续目标自动重置预算。thread 工具版本更新会迁移已保存聊天上下文。未实现后台常驻或未知命令自动重放。

224/224 全量测试通过（.local/delivery-resume-full.log），typecheck/build 和桌面语法通过；实际 Electron 配离线接口显示跨轮真实测试证据（.local/delivery-resume-visual.png）。覆盖跨轮失败修复、同一挑战复用、历史 PASS 重验、坏记录、新任务与闲聊后保留指针。未调用付费模型、未修改或运行 benchmark。重启 Beta 后加载本轮修改。

## 2026-09-30 — Markdown 回复与完整展示

普通聊天生成期间只提供执行状态；回复在 Worker 结束并保存后一次展示。完成消息的 DOM 保持原位，状态与任务证据单独更新，避免轮询重建历史、打断文本选择和滚动。Markdown 采用 Marked，支持粗体、列表、标题、代码和表格；原始 HTML 仍作为文本，链接沿用受检查的 IPC 打开入口。

渲染器及解析依赖打包为 dist/desktop/message-links.js，由正式资源入口提供。npm run build 与 Beta 启动脚本共用 desktop/build-renderer.cjs；单独运行 tsc 不会更新浏览器包。CheckOnly 使用独立 beta-check.log，避免已运行 Beta 占用启动日志。

19 项相关测试、构建和 Beta CheckOnly 通过。Playwright 在实际 Chromium 页面使用正式资源映射与离线接口，检查截图原文、粗体/列表/代码/表格、生成期间不显示草稿、历史 DOM 零改动与文字选择保留，以及完成回复只新增一次。截图为 .local/message-display-original.png 与 .local/message-display-complete.png。未调用模型；正在运行的 Beta 需关闭并重新打开才能加载新增资源入口和服务实现。
## 2026-09-30 — Worker 契约与主会话 HWE 检查工具

Worker 派发新增可选结构化契约、输入哈希和 30–1800 秒单次时间限制；保存按次候选快照，续跑不覆盖前次提交。旧调用和调查任务兼容；独立目录仍非操作系统隔离，快照捕获不等于验证通过。GUI 展示任务要求和提交状态。

新增 legion_hwe_check，调用既有 verifyHwe，不修改 bridge、评分与实验配置。核对 readiness 基线及运行前后工具链指纹、输入/固定副本哈希，要求完整有效质量指标；每轮最多三次、同时一个，取消后只清理自身 owner，主轮次结束会取消并等待未完成验证。结果落在当前 turn/hwe-checks，GUI 展示公开检查及指标。此为具体 HWE 验证入口，尚未升级为根任务 accepted 或通用验证器注册，也未补齐任务依赖 DAG。

233/233 全量回归通过（.local/contracts-hwe-tests.log），相关 17 项回归另存 .local/contracts-hwe-final-targeted.log，typecheck/build 与桌面语法通过。Electron 正式资源入口配明确离线 HWE 数据完成视觉检查（.local/hwe-tool-visual.png）。测试用验证器依赖注入，未启动真实 HWE、模型、Docker 或更改正式实验。主线程工具版本更新后按既有方式迁移聊天上下文。



## 2026-09-30：Manager 的 HWE 决策记录

- 新增 legion_strategy，将保留/淘汰/继续实验的理由绑定到本轮宿主签发的验证证据；禁止选择未通过、被修改或未知的候选证据。
- 决策保存于当前 turn 的 decisions，聊天详情与 GUI 展示对应时点、证据和尚未启动的下一步计划。
- 不等于完整目标验收或自动资源再分配；既有统一队列约束不变。没有调用付费模型、Docker 或真实 HWE，也没有修改冻结实验。
- 新增三项行为回归，验证证据伪造、过期、报告篡改、指标不能由调用者改写、拒绝未通过候选及跨环境比较；类型检查、构建及 Electron GUI 夹具验证通过。

本轮全量回归 236/236 通过（`.local/strategy-tests.log`）；GUI 截图 `.local/strategy-visual.png` 已检查。


## 2026-09-30：根据 Codex 源码推进决策派工

实际阅读 openai/codex 固定提交 bcd6d9ab6b9f26f85d76d0c680b3f88b367bffa0 的执行名额、spawn guard、恢复/中断/状态订阅及 goal runtime。参考映射见 docs/primary-agent.md，不把公开 CLI 源码声称为桌面应用的完整实现。

- 决策可附冻结的双后端 Worker 计划，按统一队列名额派发；稳定 allocation/task ID、派发前日志和不可自动重放的未知结果防止重复启动。每个任务保存其决策来源。
- 主截止时间覆盖排队及实际执行；队列超时不启动；同步启动异常释放名额；正常完成前不得残留待派工计划。
- 跨轮决策按需提供受限摘要，旧日志不变成当前证据或派工权限。GUI 区分历史，关联实际任务状态。
- Manager 可批量等待任一 Worker 完成并查询本轮/后端队列容量。已选候选在主会话完成前再次检查，失效时明确报错。
- 计划的总执行时限为各 Worker 时限之和，不是 token/费用预算或未来账号容量预留。尚未迁移旧持续目标入口，也未实现应用关闭后的常驻执行。
- 验证使用离线 Worker 和验证器夹具，没有付费模型、Docker、HWE 实验调用；冻结 benchmark 未修改。244 项全量回归通过后增加批量等待回归及候选最终复核覆盖。


## 2026-09-30：持续目标复用主 Agent

上一管理派工阶段最终 245/245 回归通过（`.local/manager-dispatch-final-tests.log`）。本阶段继续参考 Codex ext/goal 的空闲续跑与生命周期实现：新持续目标改走普通 chatSend 和主 Agent，不再创建旧领域专用目标；保留旧记录兼容读取。主 Agent 可使用同一套双后端工具、Manager 决策、HWE 验证和交付验收。

传输层登记暂停目标后启动用户轮次，再激活原生 Goal；保持连接等待原生后续轮次，避免第一轮结束就关进程。停止暂停仍活动的 Goal，继续保留原目标和 6 小时原截止时间；普通聊天禁用 Goal 自动执行。原生 complete 与 Legion accepted 分开显示，主目标 token 用量不含独立 Worker。

真实无模型 app-server 探测通过（0 次 turn/start）；离线多轮传输、截止时间恢复、关闭、目标变更、状态落盘失败及 GUI 持续目标入口检查通过。不是付费模型长任务实测，也不等于应用关闭后后台常驻。跨连接的子任务/token 累计预算仍待完善；连接内自动续轮沿用同一宿主限额。


## 2026-09-30：目标跨连接预算

原生目标阶段全量 251/251 通过（`.local/native-goal-full-tests.log`）。继续阅读 Codex rollout_budget.rs 的根线程树共享记账后，新增每个持续目标的累计 Worker/复核与 HWE 次数，恢复不刷新上限和截止时间。执行前持久预约、已知结束后结清；未确认的外部结果保留占用并阻止恢复。目标账本使用独占租约，避免两次接管。正常完成也检查未结清调用。GUI 展示累计调用和验证次数，已在实际 Electron 离线夹具中截图检查。无付费模型调用，无真实 benchmark 运行。这里的调用额度不是 token 或服务商容量保证。


累计预算阶段全量 257/257 通过（`.local/goal-budget-final-tests.log`），类型与构建通过。随后新增验收冲突回归，复现并修正外部失败被不完整审查降级、独立反例与外部 PASS 冲突仍允许正常结束两处漏洞。持续目标契约和挑战保存到目标目录，模型启动前强制恢复；原聊天指针丢失也不会让模型重新定义要求。损坏记录阻塞，旧 PASS 必须重验。新增离线恢复、弱化要求拒绝和损坏恢复检查通过。


验收连续性阶段全量 261/261 通过（`.local/goal-continuity-tests.log`）。随后按 Codex goal 恢复源码修正为先暂停持久目标、再恢复线程，真实本机无模型 API 探测通过；并增加 GUI 阶段进展（明确 commentary，排除 reasoning 和最终草稿），保留证据展开/折叠状态。Electron 截图 `.local/native-goal-visual.png` 已检查。

本阶段最终全量 263/263 通过（.local/goal-progress-tests.log），类型检查与构建通过。仅离线验证和不启动模型轮次的协议探测；未修改或运行冻结 benchmark。



## 2026-09-30：启动取消与退出清理

继续读取 Codex control/spawn_guard.rs 后，补齐启动过程中取消的边界：请求已取消时不创建进程，会话 ID 落盘期间取消后不发送 turn/start；登记耗时计入原时限。另修复 Worker 清理中的提前返回：一个任务结清报错时仍等待其他任务结束，随后才传播错误并释放目标租约。新增无模型子进程协议测试及失败结清/慢 Worker 并存测试。

启动取消与退出清理全量回归 266/266 通过（.local/cancellation-boundaries-tests.log），类型检查和构建通过。清理测试另使用明确的失败事件同步复验通过。未运行付费模型或 benchmark。



## 2026-09-30：目标激活与停止竞态

按 Codex goal/api.rs 的状态锁边界，串行化客户端 prepare/activate/close；停止发生在激活 RPC 途中时，等待激活后再暂停。激活响应未知也补发暂停，避免遗留 active 状态。新增暂停在途激活、丢失激活响应两项确定性测试。

激活/停止阶段全量 268/268 通过（.local/native-goal-race-tests.log）。随后补充迟到查询响应不能覆盖较新目标通知的检查；目标生命周期与协议 11 项定向测试通过。避免已完成目标被旧 active 查询回包显示为仍在运行。



## 2026-09-30：Manager 按需读取子任务证据

阅读 Codex utils/output-truncation 源码后，加入 legion_tasks summary：首尾裁剪长结果，保留所有历史失败计数、最近尝试及证据路径，完整 read 不变。摘要明确 unverified，不提供新的派工或验收权限。用五次执行、四次失败和大段中文/emoji 输出验证摘要体积、重启一致性、原文件不变、摘要不额外启动模型。动态工具 schema 迁移到 v9，目标宿主预算与契约保持连续。

子任务摘要阶段全量 270/270 通过（.local/task-summary-tests.log），类型检查和构建通过。主提示明确 Worker 产物与历史为不可信数据，不能据此改变目标或绕过宿主检查。未调用付费模型或 benchmark。


## 2026-09-30：实验启动失败与完成状态修复

核对 Legion-Experiment 原始 Worker invocation/result 与主会话日志：Worker 使用全局 npm Codex，主会话使用项目内置运行时；Worker 模型返回 HTTP 400；沙箱内 WSL 打包失败。实验快照没有当前宿主 HWE 工具，保持原快照及报告不变。

开发版统一主会话与 managed queue 的 Codex 到 codexRuntime(root)，禁止该路径隐式回退全局 CLI；invocation 增加 command。主会话结束时汇总本连接 Worker 最近失败和 HWE 最近检查失败，没有交付验收通过则返回 error + blocked acceptance，保留模型回复。成功续跑清除对应 Worker 失败，后续 HWE 通过清除其失败；已通过交付验收可覆盖早期探索失败。普通聊天不受影响。主提示明确使用 Windows 原生 tar 打包，宿主 legion_hwe_check 运行验证器，不要求 Agent 放宽沙箱或自行启动 WSL。

验证：全量 274/274（.local/benchmark-blockers-tests.log），随后补充聊天持久化和 HWE 恢复检查，相关 10/10 定向通过；typecheck/build 通过。未调用真实模型或重跑 HWE。模型目录仅代表发现结果，不保证账户授权；统一运行时不能保证服务端接受指定模型。Worker usage:null 保留未知，不能报告零 token。能力压测的独立全局 CLI 配置未在本轮迁移，不能把其容量结果直接等同于项目内置 Worker。

## 2026-10-01：固定 Codex 0.159.2，验证 6.1 Sol / xhigh

发现桌面活跃进程为 0.159.2，项目内置 0.157.1；PATH 优先命中的另一份 CLI 甚至为 0.154.0。开发目录内置 @openai/codex 已精确升级到 0.159.2。新增 npm run runtime:install 用于新安装/新实验快照的版本复现。主会话、工程入口、managed queue、容量查询、容量压测和 pool-service 都使用项目根下 codexRuntime，保持 Command Code 不变。冻结 Legion-Experiment 与旧 Linux HWE 专用执行器未修改，重测 GUI 链路应建立新快照，不能假设旧目录已升级。

真实内置 app-server model/list 返回 gpt-6.1-sol 并支持 xhigh；通过实际 backendSpec + runWorker 执行唯一一次只回复 OK 的模型预检，completed，8444 ms，输入 15170（其中缓存 8320）、输出 5，证据 .local/runtime-01592-smoke-1790785595765/。未调用 benchmark 或修改候选。类型检查、构建、15 项运行时/队列定向测试通过。

运行时 exe SHA256：52F75C649BEBB8001102A1DD129C1EA6D02B0940321E6D7E82EE0526753BD58A。回归中发现并修正 RTL archive 检查新增后旧 HWE 测试用字符串冒充 tar.gz 的夹具问题：改用真实 gzip/tar 数据，启动等待增加 5 秒断言，避免检查未启动时无限等待；5 项 HWE 定向测试通过。

全量回归 282 项中 281 项通过，剩余 primary-strategy 测试也是旧字符串 archive 夹具；已统一改用真实 tar.gz。修复后 benchmark-blockers / primary-hwe-check / primary-strategy 共 15 项定向全通过，类型检查通过。全量日志 .local/runtime-01592-tests-final.log 保留首次失败，未改写为全通过。

## 2026-10-01：HWE 快照迁移 readiness 误判

批次 Legion-HWE-20261001 在正式实验臂前停止，唯一差异为 additionalInputs 中两个仓库文件的绝对路径。测试先复现旧比较 false，再实现共享 hwe-fingerprint：只规范 Makefile/core.yaml 两项身份，旧路径兼容，所有哈希/镜像/提交/验证器/工具路径和其他字段仍严格比较；缺失、额外、重复身份、混合根拒绝。新 Python 指纹用稳定 repo: 键，原 readiness 不重写。readiness 初始化、CLI/GUI 复用、运行中复查和策略候选比较统一调用该函数，实现快照清单包含新模块。增加只读 research preflight 并显示变化字段。

实际证据：.local/hwe-preflight-after-fix.json 中 matches/baselineMatches=true；.local/hwe-relocation-proof.json 对失败批次保存指纹和实时重新采集的快照指纹都 compatible=true，baselineMatches=true，differences=[]，旧严格比较仍 false。模型和候选评分器未调用，历史批次未修改。全量 287/287 通过（.local/hwe-relocation-tests.log），类型检查、构建通过。宿主检查器集成测试确认迁移后进入验证、ready.json 原文不变，Makefile 改动不进入验证。

用户随后补充了十项具体故障，修复与验证记录见下。


## 2026-10-01：长任务稳定性十项修复

参照本地 Codex 源码 app-server-transport/src/transport/stdio.rs 的连接终止与 I/O 失败处理边界，修复开发目录内的执行、持久化和验收路径。冻结实验目录和既有报告不修改，没有启动模型或 benchmark。

| 故障 | 修复及回归证据 |
| --- | --- |
| 1. app-server 断管崩溃 | stdin/stdout/stderr 和 readline 错误统一停止当前进程、拒绝待响应 RPC；通知、审批和工具回复统一经过安全写入。真实子进程中注入 EPIPE，在 --unhandled-rejections=strict 下返回 error。 |
| 2. 日志写盘崩溃 | 每次追加立即捕获失败，停止本次执行；最终清理发生的日志失败也不能返回 completed。stdout/stderr 被替换为目录、退出清理阶段写盘失败均有子进程用例。 |
| 3. 取消与恢复竞争 | 任务立即登记取消意图，取消与继续共用串行队列；cancelled 持久状态禁止继续。持续目标和工程服务的 resume/cancel 串行，并在持有执行租约后复查状态。取消/继续、重载、取消/恢复用例均不产生额外执行。 |
| 4. 聊天临时文件竞争 | 每个对话串行保存调用时的快照，临时文件使用唯一 UUID；置顶和启动也按对话串行。25 次元数据更新与回复完成并发后，会话 ID、置顶和完整回复仍可重载。 |
| 5. sessionId 丢失阻断依赖 | 可恢复 Worker 保留已有后端会话 ID；持续目标向团队执行器提供稳定的宿主任务身份作为缺失 ID 的替代，该身份不传给后端作为 resume ID。两种后端不返回会话 ID 时，已验证依赖 A → B → 集成仍完成。 |
| 6. 验收超过截止时间 | 主会话、派工、HWE 和交付使用同一个绝对截止时间；结构检查、独立审查重放和安装的功能验证器均收到限时取消信号。真实死循环检查器在交付截止时间停止，忽略取消的测试适配器也不能晚发 PASS。 |
| 7. 审查不足掩盖功能失败 | 可重放的失败优先于其他检查的覆盖不足；功能拒绝/阻塞不能被审查 unverified 覆盖。错误实现会修复后再次检查，审查不足仍保持 unverified。恢复复核也保留功能失败。 |
| 8. 集成结算取消仍完成 | 持续目标在结算、证据复查、最终保存后检查取消和截止时间；工程服务也等待取消结清。两条集成路径在 settled 边界取消都持久化 cancelled，不产生完成交付事件。 |
| 9. 混合调用突破 64 | Worker 和独立审查共享绝对 64 次计数；maxWorkers 仍单独限制实现 Worker。62 次审查 + Codex/Command Code 各一次后，两个入口均拒绝下一次调用，容量返回零。 |
| 10. 全量扫描增长日志 | GUI 对每次执行维护串行字节游标，只读取新增记录；处理分段 UTF-8、文件截断/替换和有界进度。审计日志追加只读取最后一个字节，不再读完整历史。4 MB 日志连续 30 次查询不重复读取原有字节。 |

边界复验还发现 native goal 激活 RPC 的旧响应可能覆盖更新的 complete 通知，造成无后续工作却等到超时。set 与 get 响应都使用本地通知版本判断；确定性迟到响应测试和本机协议夹具通过。

验证：新增 20 项回归，最终全量 307/307，typecheck 和 build 通过。日志 .local/reliability-final-full.log；定向故障和目标状态竞争日志 .local/reliability-regressions-final.log、.local/reliability-goal-race.log。早期失败日志保留在 .local/reliability-boundaries.log。

约束：验证器必须遵守 AbortSignal 以停止其外部副作用；宿主可拒绝超时结果，但不能撤回不合作的第三方代码已产生的副作用。原始执行日志保留完整证据，GUI 只保留有界进度和回复预览。正式 benchmark 应从包含本轮修复的新快照启动，先运行 preflight；本轮离线回归不能替代真实模型的 benchmark 结果。

HWE 启动前复验：node --import tsx src/research-cli.ts preflight 返回 matches=true、baselineMatches=true、differences=[]，证据 .local/hwe-preflight-after-stability-fixes.json。未启动候选执行或评分。
