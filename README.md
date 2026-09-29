# Proactive Agent

本地 TypeScript 管理内核：让已有 Codex worker 执行任务，由外部检查决定停止或恢复原会话继续推进，并保存证据。提供持续 goal 模式，以及固定 B0/B1 实验模式。

提供 Electron 聊天客户端和 CLI。桌面支持真实 Codex 对话、续聊、带外部验收的 JavaScript 工程任务和 HWE 微架构实验；CLI 保留协作任务调度与基准对照。支持规划有依赖关系的工程任务；尚未实现桌面主动观察或 ALE 评测系统。

## 运行

### 桌面 GUI（主要入口）

```powershell
npm --prefix "D:\Projects\Proactive Agent" run desktop
```

打开独立桌面窗口，无需浏览器或本地网页服务。本机也可双击项目目录中的 `Proactive Agent.lnk`。按 Ctrl+N 或点「新聊天」直接进入空白对话，在底部输入任务，Enter 发送、Shift+Enter 换行。

窗口最小尺寸为 420 × 400，支持左右半屏贴靠。内容宽度不超过 800 时自动收起侧栏，可从左上角展开，点击内容区或按 Escape 收起；恢复宽窗口后沿用原来的侧栏开关状态。输入栏按钮会随可用宽度换行。窗口尺寸限制的修改需重启桌面应用生效。

左侧切换聊天，中央展示消息。发送会调用项目私有 Codex CLI，使用现有 ChatGPT 登录和 GPT-6 Sol/high。聊天和原始执行日志保存在 `.chats`，每个对话使用独立工作目录，同一聊天后续消息恢复原 Codex 会话。一次执行上限 30 分钟；当前客户端同时执行一个对话。输入框右下角在运行时变为停止按钮。

输入栏可选择模型和推理强度、操作权限、是否允许子 Agent（最多 2/4 个）。权限默认「项目内编辑」，另有「只读」与「完全访问」；设置实际传入 CLI，运行期间锁定，下一轮生效。项目标题展开/收起聊天列表，不会清空对话。菜单支持 Escape 关闭、上下键选择，推理滑块支持左右键。

历史协作任务移至「运行记录」侧面板。普通自由对话可调用 CLI 原生子 Agent，同模型与权限；普通聊天回复不代表已验证交付。模型目录由本机登录缓存提供，账号实际访问失败会显示错误，不自动换模型。

### 微架构实验：按证据管理多个假设

左下「微架构实验」管理 HWE 的 RV32IM 优化任务。Manager 与 Worker 可分别选择模型和推理强度；Manager 分配隔离实验，外部验证器检查正确性并测量 CoreMark、频率和面积，结果进入后续轮次。页面展示真实候选、分配理由、失败证据和当前最佳。

此入口需要已配置的 WSL、Docker 和固定版本硬件工具链，且基线连续两次完整验证通过。配置、限制及 CLI 用法见 [HWE 管理闭环](docs/hwe-management.md)。普通聊天和 JavaScript 工程入口继续保留。

### 工程任务：从目标到检查与交付

1. 点击输入框上方「选择工程项目」，选择已有 JavaScript 项目，再描述改动。
2. 查看生成的交付清单、验收要求，展开各任务及「整体验收与范围」。点击「执行计划」启动。
3. 管理器在项目副本中执行；外部检查失败时恢复原会话修复，同一路线失败两次后换会话重试。基础设施错误停止并保留证据。
4. 通过检查后点击「打开交付文件」。原项目不会被自动覆盖；点击项目名旁的 × 返回普通聊天。

当前支持不依赖安装步骤、可直接用 `node --test` 运行的项目，必须已有 `*.test.js/mjs/cjs` 或 `*.spec.*` 基线测试。最多 300 个文本文件、2 MiB；跳过隐藏文件、依赖和构建目录。规划器可生成 1–8 个任务，最多两个同时执行；每个任务最多四次执行、两条路线，执行与最终检查共用 20 分钟时限。循环依赖、未知依赖、重复任务和交付路径冲突会在执行前拒绝。工程模式固定在副本内编辑、关闭 CLI 内嵌子 Agent。

输入快照、原有测试和生成的验收测试在执行前冻结；检查器只将声明的交付文件覆盖到独立重放目录后运行测试。后续任务只接收通过检查且哈希匹配的依赖产物，每个文件只允许一个任务负责交付。全部任务通过后合并产物，再运行原有测试、每个任务的测试及整体验收测试；合并失败时不交付，当前不会自动重规划跨任务修复。模型起草的测试需审阅，通过仅代表这些检查通过，不证明完整正确性。当前不是 Docker 或恶意代码隔离环境。计划保存在 `.engineering`，执行、检查日志与交付文件在 `.runs`；中断后不自动接管，保留的待执行计划可在重启后启动。

「停止」终止该窗口启动的进程树并保留证据；运行中关闭窗口会询问是否停止并退出。历史运行不会自动恢复，无法确认的进程显示“状态待确认”。应用通过受限 IPC 调用管理器，渲染页面禁止直接使用 Node，关闭外部导航。当前为本地开发版，尚未制作安装包；源码更新后使用上述命令重新构建。

旧浏览器界面保留为开发入口 `npm run ui`，不随桌面应用启动。Windows 状态文件原子替换保留有上限的占用重试，最终写入失败会停止并保留证据。

需要 Node.js 22+。

```sh
npm ci
npm test
npm run typecheck
npm run demo
npm run demo:goal
```

`demo` 是确定性测试夹具，不调用模型。第一次产物故意不满足要求，第二次修复，输出 `.runs/demo-*/report.md`、状态与事件记录。

`demo:goal` 同样不调用模型，演示连续四轮（前三轮 fail，第四轮 pass），用来验证持续管理流程。它不是对真实任务成功率的证据。

从任意 PowerShell 目录运行：

```powershell
npm --prefix "D:\Projects\Proactive Agent" run demo:goal
```

### 使用真实 Codex

准备一个专用工作目录，以及在该目录以外的可信检查脚本。以下 JSON 的 workspace/output 相对配置文件解析；checker 中的脚本使用绝对路径。Windows 的 codex 应使用实际 `.exe` 路径，不使用 npm `.cmd` shim。

```json
{
  "goal": "Create answer.json with sum equal to 19 + 23 and sorted equal to [1,2,3].",
  "workspace": "./workspace",
  "output": "./evidence",
  "mode": "B1",
  "codex": "codex",
  "model": "gpt-6-sol",
  "effort": "high",
  "initialMs": 120000,
  "repairMs": 120000,
  "totalMs": 300000,
  "checker": {
    "command": "$node",
    "args": ["/absolute/path/to/examples/check-json.mjs", "{workspace}"],
    "timeoutMs": 10000
  }
}
```

```sh
npm start -- run /absolute/path/to/task.json
npm start -- status /absolute/path/to/evidence/run-ID
npm run build
```

模型必须能通过当前 CLI 登录方式访问；不自动替换模型。Codex 使用 workspace-write、禁止提权询问、显式关闭两个 multi-agent 开关，并忽略用户 config/rules。它仍可能访问全局 skills、服务或账号上下文，因此这个本地路径**不满足独立 benchmark 所需的完整环境隔离**。

Windows 已实测 Codex **0.157.1 + gpt-6-sol + ChatGPT 登录**，可创建文件并在同一会话中修复。适配器显式选择 `windows.sandbox="elevated"`：仅指定 workspace-write 且忽略个人配置时，本机实际会话曾降为只读。这里的 elevated 指 Windows 沙箱实现，worker 仍受工作目录写入边界限制；适配器不自动切换到完全访问。机器需要已有可用的 Windows 沙箱设置。参见 [官方 Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)。

本机使用项目私有 CLI，保留现有桌面应用版本：

```powershell
npm --prefix "D:\Projects\Proactive Agent\.local\codex-runtime" install --save-exact @openai/codex@0.157.1
```

Windows x64 配置中的 `codex` 路径为 `D:\Projects\Proactive Agent\.local\codex-runtime\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`。其他机器应使用自己的实际路径。

两阶段真实接入试验及证据索引见 [当前开发范围](docs/implementation-status.md)。该试验有意制造首轮失败，不用于计算模型解题成功率。

## 检查器协议

检查进程通过 stdout 返回一个 JSON 对象，其他诊断写 stderr。发现产物错误时仍返回退出码 0 和 fail；进程非零退出、超时、非法 JSON 属于 error，不触发修复。

```json
{
  "checks": [
    { "id": "contract", "status": "pass", "detail": "A specific requirement was checked." },
    { "id": "remaining", "status": "not_checked", "detail": "Not covered by this checker." }
  ],
  "artifacts": []
}
```

status 为 pass / fail / not_checked / error；artifact 可提供 path 和 SHA256。任一 error 优先于 fail；全空或全部未检查记 unverified。有通过且没有失败/错误时记 checks_passed，**仅表示已实现的可见检查通过**，报告保留 not_checked。

B0：一次执行、检查、停止。B1：首次正常退出且明确 fail 时，按原 session ID 修复一次。缺 session ID、worker 错误/超时、checker error 都不会自动新建会话重试。

### 持续目标管理

在真实配置中设置 `"mode": "goal"`，并添加 `"requiredChecks": ["sum", "sorted"]`（替换成该任务必须通过的检查 ID）。goal 模式必须明确必需检查；必需检查缺失或 not_checked 时记 unverified，不能用其他检查通过替代。

明确 fail 时持续恢复同一会话，直到检查通过、证据不足、执行/检查错误、人工取消或总期限到达。可以配置 `maxAttempts`，省略时不设次数上限；总时间上限始终有效。这是确定性监督策略，尚不会自行判断新证据价值、改计划或调度多个 worker。

在另一个终端请求暂停：

```sh
npm start -- pause /absolute/path/to/evidence/run-ID
npm start -- status /absolute/path/to/evidence/run-ID
npm start -- resume /absolute/path/to/evidence/run-ID
```

暂停请求会等当前 worker 及检查完成，在需要继续的检查失败点保存 checkpoint 并释放工作目录锁。成功、错误或截止期限等终局结果优先。暂停不杀正在工作的 worker；需要立即取消时使用 Ctrl+C，该取消状态不能自动恢复。

`resume` 仅接受 cleanly paused 的 goal 运行，复用原 session ID，追加新的 attempt 目录，不覆盖旧证据；重新核验 worker/checker 指纹。暂停期间仍消耗原始墙钟期限，恢复不重置预算。崩溃留下的 running/checking 状态不会自动接管，仍需确认旧进程已经停止。

## 证据与异常

- 每次 attempt 独立保存 prompt、调用配置、stdout/stderr、进程身份及检查报告。
- state.json 原子更新；events.jsonl 追加记录管理事件；report.md 汇总结果。
- 记录 CLI 版本、可直接读取的二进制哈希、prompt 哈希、checker 绝对文件哈希。每次外部检查前验证已记录 checker 文件未改变；这不是针对恶意 worker 的完整防篡改边界，导入依赖也尚未递归指纹化。
- 同一主机临时目录中的 workspace lock 阻止两个 manager 同时修改同一工作目录；独立主机/Windows 与 WSL 各自启动时仍需额外协调，不是分布式锁。
- SIGINT/SIGTERM 和超时会终止当前进程树。强杀管理进程/断电后不自动恢复；旧目录拒绝复用、workspace lock 保留。先查看锁文件及 process.json，确认旧进程已退出，再人工删除该锁文件并决定恢复方式。
- 旧 goal/B0/B1 路径保留原始 token usage，不对未确认的恢复语义推断累计费用。HWE 的独立会话用量另行汇总，缓存输入不重复相加；实际账单费用与隐藏最终评分不由公开检查推断。
- 原始日志可能含任务数据，默认 `.gitignore` 排除 `.runs`，不要直接发布。

## 当前范围与下一步

已实现：本地 CLI、Codex 适配、持续目标循环及 B0/B1 策略、必需检查、正常检查点暂停/恢复、外部检查协议、限时与取消、状态及证据包、行为测试。

已新增：team 模式支持任务依赖、多 worker 调度、验收快照交接和可替换的 Master 决策策略，使用方式见下。

已新增：Electron GUI、工程任务规划、ProgramBench Docker 适配，以及 HWE 的模型 Manager、多假设隔离 Worker、外部仿真/形式化/FPGA 测量和跨轮记忆。HWE 开发试跑已真实完成，详见 [开发结果](docs/hwe-development-run.md)；独立对照另见 [对照结果](docs/hwe-first-comparison.md)。

未实现：桌面主动观察、全局唤起快捷键、自动崩溃接管、ALE deployer、通用 CAD/EDA 应用控制。既有 ALE 规格保留为后续方案，本地 demo 不作为 benchmark 结果。

产品原则与后续里程碑见 [当前开发范围](docs/implementation-status.md)。

## 多会话任务管理与 Master 策略

运行不消耗模型额度的完整演示：

```powershell
npm --prefix "D:\Projects\Proactive Agent" run demo:team
```

演示包含两个独立任务及一个依赖任务：一个任务先续跑、再切换路线；另一个任务补充验证；二者通过后才启动整合。所有 worker 为确定性夹具。

调用真实 GPT-6 Sol（会消耗账号额度；示例采用上述项目私有 Windows CLI）：

```powershell
npm --prefix "D:\Projects\Proactive Agent" run team -- run "D:\Projects\Proactive Agent\examples\team.json"
npm --prefix "D:\Projects\Proactive Agent" run team -- status "D:\Projects\Proactive Agent\.runs\team-ID"
```

`examples/team.json` 定义任务 goal、dependsOn、routes、requiredChecks、outputs 与各自 checker；可添加同格式 verifier 进行补充检查。output 与显式以 `./`、`../` 开头的命令/参数路径相对配置文件解析；`{workspace}` 在执行时替换。示例为接入检查，不是工程 benchmark。

### 执行与决策边界

- 每个任务、每条路线有独立工作目录与会话。默认单并发，可配置 1–20；示例两并发不代表机器适合 20 个重任务。
- 首次明确失败恢复原会话；同一路线至少两次失败且有备选时，切换到下一条预先声明的路线，启动新会话。每个任务的 maxAttempts 跨路线累计。
- 必需检查缺失或 not_checked 时，调用已配置的 verifier 一次；仍不充分则停止。新增失败不会被旧的通过结果掩盖，基础设施错误不会伪装成解题失败。
- Master 默认是 `evidencePolicy` 确定性策略，也可启用下述 Codex LLM 策略。决策及理由写入 events.jsonl。调度器独立执行硬约束：策略不能跳过检查、降低验收要求或使用未声明路线。这一版没有自动拆任务或生成新路线。
- 上游通过检查后，复制已声明产物到 accepted 快照并保存 SHA256；若检查器提供产物哈希，必须一致。下游启动前再验快照哈希，复制到 `inputs/<任务ID>/`。拒绝越界路径、符号链接、缺失文件及超过 64 MiB 的单文件；下游不能修改上游工作目录中的产物副本。检查器本身的覆盖质量仍决定验收可信度。
- 每次状态变化持久化到 state.json，原始 worker 日志、检查报告、决策和验收快照均保留。Ctrl+C 和总期限通过信号终止正在执行的 CLI；独立任务失败不取消无依赖的任务，失败链下游标记 blocked。
- team 尚不支持暂停续跑和崩溃自动接管；每次启动创建新 run 目录。隔离是本地 workspace-write 边界，不隔离所有读取权限、账号配置或主机资源，不能替代 Docker。

本机真实三会话试跑已完成：两个任务并行输出 42，经检查与快照交接后，第三个任务输出 84。该结果证明接入链路与调度可运行，不证明复杂工程效率提升。

### 启用 LLM Master

在 team 配置顶层增加 `"master": { "policy": "codex", "timeoutMs": 60000 }`。省略或设置 policy 为 rules 时保留规则对照组。Master 沿用同一配置的 CLI、模型和 effort，当前已实测 gpt-6-sol 与现有 ChatGPT 登录。

```powershell
npm --prefix "D:\Projects\Proactive Agent" run team -- run "D:\Projects\Proactive Agent\examples\team-master.json"
```

此命令调用真实模型，消耗账号额度。Master 输入包括目标、固定路线、必需检查、执行/检查历史、剩余尝试次数和墙钟时间；输出为 action、reason 和可选 guidance。它可以选择同会话修复、切换下一条已声明路线、调用已配置的补充验证、建议验收或停止。修复建议会进入下一次 worker 提示，始终从属于原任务要求。

每个决策启动独立只读 Codex 会话，提示要求仅根据所提供证据决策，不使用工具；只读沙箱不等于完全禁止工具或隔离主机读取。输出通过 JSON Schema 与本地合法动作校验，随后还须通过调度器验收门槛。CLI 接入使用 [官方非交互模式的结构化输出参数](https://learn.chatgpt.com/docs/non-interactive-mode)。

Master 的 prompt、输入、调用参数、原始日志、response、decision 和原始 usage 分开保存在 attempt 下的 master 目录；补充验证后的决策位于 master-after-verification。状态查询可看到 deciding。Master 用时计入总期限，每次调用另受 timeoutMs 限制。超时、非法 JSON、越权决策或模型服务错误明确停止当前任务，不静默退回规则；上游失败后依赖任务仍然 blocked。原始 token 保留但不推断累计费用。

真实接入验证：`.runs/team-b0904e50-1952-48e3-a1e8-c8a88af3b3c9` 完成“故意生成 41 → 检查失败 → LLM Master 选择 resume 并给出建议 → 原 worker 会话修复为 42 → 检查通过 → Master 选择 accept”。这是一次有意制造错误的流程测试，不是成功率或效率证据。

### Manager 与 Worker 分别选模型

选择工程项目后，输入栏右侧的模型按钮标为 Manager，用于规划与失败后的管理决策；Worker 按钮可独立选择执行模型和推理强度。待执行计划的任务详情里可勾选「单独设置 Worker」覆盖该任务。未覆盖的任务继承 Worker 默认值，运行开始后冻结配置，修复/换路线沿用该任务的设置。

Manager 负责规划；执行期出现明确检查失败且剩余尝试次数大于零时，使用同一 Manager 模型选择修复、切换路线或停止。检查通过、基础设施错误、缺失必需证据和耗尽尝试次数由固定规则处理；检查器运行程序，不调用模型。Manager 每次最多 120 秒，计入工程总期限；调用失败明确停止，不静默退回规则。普通聊天里的 CLI 内嵌子 Agent 仍沿用普通聊天配置，不等同于工程管理器的 Worker。旧工程记录缺少新设置时沿用原 model/effort，不改写历史计划哈希。

实际规划设置记录在 planner/options.json，Worker 设置记录在每个 attempt/options.json；工程 state.json 和运行 provenance.json 保存默认值与任务覆盖。模型访问失败明确报错，不自动换模型。

每次执行前保存 `memory.json`：之前各次尝试的路线、检查、产物哈希和管理决策。新路线也收到这些证据，必须重新运行检查，不能把旧版本通过记录当作当前版本的证明。每次决策保存在 `decisions.json` 与任务状态中。

### 同一任务的双路线竞争

工程计划的「执行方式」可选择「两条路线竞争」或「单路线」。桌面新执行默认双路线；旧 API 调用未指定 candidates 时保持原行为。双路线分别使用独立目录和会话，读取相同快照与验收要求，不互相读取候选输出。每条路线最多两次 Worker 调用（一次实现、一次修复），合计仍最多四次；同时最多两个 Worker，任务之间按依赖顺序处理。两条路线共用 Worker 模型设置。

等两个候选结束后，按声明顺序检查通过的候选，从已验收快照复制产物再做一次外部检查；首个复查通过的候选入选。不会混合两个候选的文件，也不会把速度或模型自评当作正确性证据。全部任务结束后仍做整体验收。一个候选的错误保留在记录中，不妨碍另一个经过检查的候选入选；复查基础设施错误停止当前任务。

候选状态和检查可在任务详情展开。原始证据位于 tasks/<task>/candidates，入选复查位于 selection-candidate-*，state.json 保存 selectedCandidate。当前独立验证指冻结测试的外部重放，并未实现独立 Agent 生成反例测试、最优性排名或 Docker 隔离。通过测试不代表完整需求已获证明。

### ProgramBench 单题入口

新增通用执行适配接口，以及 gron 单题适配器。复用候选调度、公开检查与入选流程；评分在候选冻结且 Worker 关闭后进行。运行方式、环境准备和证据说明见 [ProgramBench 单题执行](docs/programbench.md)。当前通过 CLI 运行，尚未接入桌面创建菜单。
