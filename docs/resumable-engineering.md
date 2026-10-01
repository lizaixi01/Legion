# Resumable Engineering Run v0.1

## 使用

GUI：新聊天 → 选择已有 Node/JavaScript 项目 → 点击输入框的“工程任务” → 输入目标。Manager 只生成计划与检查提案；展开每个任务的验收测试及整体验收，核对需求覆盖后点击“批准以上需求与测试的覆盖并执行”。批准会冻结目标、DAG、源文件、测试及执行配置。暂停后在项目列表打开原任务，点击“恢复同一任务”；不用重发目标。取消不可恢复。旧版本缺少检查点的数据仅能查看历史。

交付保存在隔离候选目录，不自动覆盖源项目。该入口只支持现有小型、无外部依赖的 Node 行为测试项目；通用聊天入口不受此限制。并发上限 2，默认总期限 20 分钟，每调用最多 5 分钟；等待人工批准也计入规划时起算的期限。

CLI（在仓库根目录）：

```powershell
npm run demo:resume
npm run engineering -- list
npm run engineering -- detail <run-id>
npm run engineering -- pause <run-id>
npm run engineering -- resume <run-id> --allow-model-calls
npm run engineering -- cancel <run-id>
```

`pause` 向持有执行权的服务发送请求；返回写入成功不等于已暂停，使用 `detail` 确认。Ctrl+C 请求安全暂停。GUI 正常退出先等待工程暂停，最多等待 30 秒后中止并记录 interrupted。

CLI 创建：配置 JSON 包含 `project`、`goal`、`plan`（沿用 EngineeringPlan）、`options` 和 `approvedHash`。先 `npm run engineering -- prepare <config.json>` 查看原始目标、检查提案与批准 hash；人工审核后将 hash 写回配置，再执行 `create <config.json>`。`create` 不调用模型，`resume` 需要显式模型调用开关。CLI 的预生成计划来源应由调用者保留；GUI 将规划调用及原始用量纳入同一任务记录。

真实执行器 smoke：`npm run smoke:resume -- <approved-config.json> --allow-model-calls`。最多 10 分钟、12 次调用、并发 2，使用配置选择的现有后端与模型。没有该开关时立即拒绝；本轮未执行真实模型 smoke。

## 数据与执行权

复用 `runTeam` DAG、现有 Worker 队列/进程执行、`runChallengedTask`、冻结 Node 测试和 acceptance WeakMap。新增服务协调恢复，不增加第二套调度器。

`.engineering/<id>/run.json` 的校验和封装是唯一恢复依据。写入顺序：临时快照 → 追加审计事件 → rename 快照。日志是派生审计记录；半行不会被解析为恢复授权，下一次追加先换行。日志追加或快照提交失败则停止执行。未提交的临时文件不恢复。这不是断电事务保证，也不能抵御同一系统用户恶意重写所有文件。

每次恢复创建 `executions/<epoch>`，保留原 Run、绝对 deadline、累计调用/检查次数、节点 sessionId 与旧证据。派发模型或验证器前先持久化预约，结束后再提交结算。结果未知的预约不删除、不猜测免费。

每个 Run 用短期 claim gate 和 owner token/PID 排他领用；每次写入校验 token，迟到回调不可提交。旧 owner 仍存活、PID 重用造成不确定、残留 claim gate 或任何在途结果未知时均保守阻塞，不因缺少 PID 文件直接重新派发。v0.1 不自动接管孤儿进程；需要先调查证据，不能删除预约后声称可靠恢复。

## 验收边界

- 人工批准记录逐节点的需求 → 测试入口及源码 hash；模型提案本身不拥有认证权。通过批准的测试只证明其覆盖的行为，不能证明无遗漏。
- 恢复逐项核对原项目、冻结配置、代码版本、契约、候选 manifest、产物、依赖快照、报告与冻结挑战源码，再运行独立挑战和批准的功能检查。旧 JSON PASS 不注入 WeakMap；仅新进程实际验证签发新证据。
- 恢复时验证器实现或 Node 版本变化会阻塞。开发中改了相关源码的旧 Run 不能混用新检查器继续。
- 已通过复核的节点跳过实现；缺失、失败或不确定的检查阻止依赖推进。最后仍构造根级候选并做集成检查。
- 冻结基线和批准测试分别执行；每份必须有实际注册且通过的 Node 测试，空文件、全 skip、异常退出不能通过。Worker 对副本测试的修改不影响宿主回放。
- 检查子进程仅获得候选/必要源文件及最小环境。Node permission 禁止写入与创建子进程，模块限制拒绝常规网络接口。此为进程级限制，不是恶意代码的完整 OS 沙箱。

## 已验证与未验证

离线 fixture 在真实子进程执行 Node 模块、行为测试与文件交接；A 暂停后重启、A 重新验收但不再实施、B 与跨模块集成继续。测试覆盖安全边界故障、真实检查过程中杀死 Manager、存活孤儿 Worker、重复恢复、取消/期限、篡改、零测试、环境清理、集成失败、写入失败与日志半行。示例只是集成 fixture，不是用户项目 benchmark。

未验证：真实模型端到端恢复、原生 GUI 视觉、持续多日运行、任意断电、外部副作用 exactly-once。未知在途节点的自动恢复、动态改图、桌面观察、跨项目调度均不在本增量范围。GUI 计划批准前的 Manager 中断仍需重新规划；已有批准 Run 的恢复不重发需求。

### 本轮本机验证证据

- 修改前：151/151；最终：165/165（`.local/resume-full-tests.log`）。
- 类型检查、构建、桌面脚本语法检查通过；两套离线演示通过。
- `.local/engineering-resume-demo-1790704898699/demo-result.json`：同 Run `ed78ea56-de7b-49c1-90f4-69c00b4bd0e6`，epoch 1 → 2，调用 1 → 3，原 deadline 不变。A、B、total 各实施一次；A 在新进程重新验收。
- 真实 smoke 开关拒绝验证：`.local/resume-smoke-gate.log`；未授权时没有模型调用。
