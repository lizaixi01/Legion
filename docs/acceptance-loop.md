# 统一证据验收（2026-09-29）

## 本轮范围

`WorkerResult.status` 仍表示执行器结果；新增 `acceptance` 表示交付验收。执行正常结束可以同时是未验证或存在反例。Manager 的 `finish` 只是申请交付。

- `src/managed-chat.ts`：work / delegate / finish 共享验收入口；普通聊天关闭 delegation 后的工程交付也走此入口。严格识别的招呼/解释保持只读回复。其他无法确认的内容保守保留未验证，不能靠 Worker 在结束时自称“聊天”绕过检查。
- `src/acceptance.ts`：冻结任务契约、检查前候选快照、内容 manifest、输入依赖版本、外部功能验证器 registry、运行时证据封印和最终交付检查。
- `src/challenged-task.ts`：独立 Challenger、真实断言重放、有限返工、会话续用及每个候选的检查记录。
- `src/agent-roles.ts`：版本化 Manager / Worker / Challenger 规则和批准的 `evidence-v1` skill，记录实际注入的内容 hash、来源与能力。未知必需 skill 在派工前失败。
- `src/team.ts`：保留原 DAG、快照交接、会话规则；补上 checker 未报告 artifact hash 时仍必须检查前后版本一致的门槛。受管理聊天的依赖派工直接复用它。

## 验收与配置

契约在实施前保存，包括稳定 taskId、原始需求、非目标/假设字段、requirements 映射、输出范围、skills、固定依赖内容哈希与预算。当前非目标和假设默认为空，不声称已自动分析所有规格歧义。任务方法可改变，目标和验收条件不能在同次执行中悄悄修改；需要新一轮显式授权任务，旧尝试不自动续跑。

Manager 可以在首轮 decision 提供 `contract: {goal, outputs, acceptance}`；每个 assignment 可提供 `dependsOn` 和 `skills`。同批依赖由已有 team DAG 校验与调度，只交接已验收快照。跨批依赖重规划尚未开放，未知依赖会被拒绝。已有任务的最多两次返工在任务内部完成；Manager 不能用新无关成功抹去旧的必需任务。

`TrustedVerifier` 只能由宿主代码安装到 `VerifierRegistry`；模型不能传入 command、注册验证器或上传 PASS JSON 获得认证。检查报告沿用 `ReportSchema`，判定复用 `checkOutcome`。结构检查与 Challenger 的测试提案不构成功能认证。没有可信功能覆盖，输出为 `unverified`。

当前内置唯一功能能力为 `json-aggregation@1`，严格支持原始请求：

```text
Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.
```

它从原始请求提取数字，使用独立 Node 子进程比较 sum 和完整升序数组。输入不能取自 Worker 输出或 Manager 编造的 expected 值。这是窄范围垂直能力，**不是通用程序正确性检查**。更广场景需要宿主安装与原始需求匹配的 verifier。测试中的 fixture registry 是明确的宿主依赖注入，不是产品向模型开放的配置。

## 挑战与最终交付

Challenger 通过现有 pool 调用，使用新会话、只读候选和原始需求；不注入 Worker 成功总结。它提供按原验收项一一对应的独立断言。运行时保存 candidate/contract 身份、重放结果、断言 expected/actual 日志和未覆盖项。模型的测试代码属于提案，运行时实际执行后才形成审查证据。

- 语法错误、权限错误、环境错误、未知/未覆盖不是功能 pass，也不冒充已证明的功能缺陷。
- 功能验证器与独立审查冲突时停在 `unverified`，不会无限修复以满足错误审查意见。
- 每次返工捕获新 candidate，旧失败留在审计记录；只有当前、未被篡改的证据可用于验收。
- 每个子任务通过之后，运行时从其快照构造最终文件集合；冲突路径拒绝合并，再按根契约执行功能验证。最终候选和子任务候选身份不同。
- 交付候选保存在隔离目录，不自动覆盖原项目。GUI 提供当前证据定位；源项目合入需要后续明确操作。

## 预算、持久化与中断

默认总模型调用上限 32，Manager 决策最多 4 次，每任务实施最多 3 次；检查批次上限 12（每批内含所声明检查），共享同一不可延长的 deadline。Manager / Worker / Challenger 全部经过已有 WorkerPool；本地检查不占用模型槽，受检查批次预算和同一取消信号约束。原始 usage 按角色保存，不推算未知费用。

`events.jsonl` 保留顺序事件；`management.json` 原子替换。保存失败会取消相关工作，禁止发布成功。`run-start.json` 排他创建，已有/中断 attempt 不自动重新派工。取消后到达的成功回复不生成验收。已有聊天历史可展示，但不会加载为本轮运行时认证凭据。本轮没有实现任意断电续跑或分布式租约。

证据注册仅存在于当前运行时；会核对内存序列化封印、磁盘证据文件、候选 manifest、当前文件内容与契约/依赖身份。模型伪造的同形 JSON 不被接受。

## 权限的实际边界

角色模板不增加权限。Challenger 强制只读；Worker 保留用户权限设置。Command Code 仍保留 `--no-skills`，Legion 明确注入批准的 skill 文本，并使用已有文件工具适配器。

本地断言使用 Node permission 限制文件读取、禁止写入/子进程；模块钩子只允许 fs/assert/path/url 和候选文件，并拦截常规 fetch、WebSocket、网络 builtin API。测试覆盖实际拒绝行为。**这些是正常工具接口和进程级限制，不是恶意同用户进程、内核漏洞或 Docker/OS 沙箱隔离证明。**没有改变账户、密钥或后端模型配置。

## 重现

```powershell
npm run typecheck
npm test
npm run build
npm run demo:acceptance
```

离线 demo 的 Manager、Worker、Challenger 决策均明确标为 fixture；断言与安装的功能验证器真实运行。首版 sum 错误，第二版修复，最终根任务再验收。产物位于 `.local/acceptance-demo-<timestamp>/`，含 result、contract、manifest、逐次报告、角色加载记录和事件。它验证接线与状态机，不证明模型审查效果或可靠性提升。

真实 smoke 默认拒绝启动；仅显式执行 `npm run smoke:acceptance -- --allow-model-calls` 才调用真实后端，上限 3 分钟 / 6 次模型调用。本轮未执行真实 smoke，未消耗付费模型调用。

GUI 使用现有管理视图，显著展示运行时验收状态；Worker 文字放在“未经认证”的折叠区域。离线渲染测试已覆盖此行为。启动真实浏览器预览被自动审批审核以 `blocked by policy` 拒绝，本轮未完成视觉检查；未发布或替换桌面稳定安装包。

## 本轮最终验证记录

- `npm run typecheck`：通过。
- `npm test`：151/151 通过；含依赖副本被修改后禁止交接、报告文件被篡改后验收失效。
- `npm run build`、`node --check desktop/app.js`、`git diff --check`：通过（Git 仅提示既有 LF/CRLF 转换）。
- `npm run demo:acceptance`：通过；两次实施，第一版功能反例，第二版修复，根任务新候选验收通过。
- 最终证据：`D:/Projects/Proactive Agent/.local/acceptance-demo-1790695167856/result.json`；根检查报告位于同目录 `turn/delivery/verification/functional.json`。
- 无授权参数运行 `npm run smoke:acceptance`：按设计拒绝启动，未调用模型。
- 原生桌面/浏览器视觉检查未完成，原因见上；离线渲染和链接/状态测试通过。
