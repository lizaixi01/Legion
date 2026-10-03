# Legion

本地 Agent 管理系统：以 Codex 主会话管理 Codex / Command Code Worker，记录任务、候选、检查与资源分配。独立验收只认证已安装验证器覆盖的要求，执行完成不等于交付通过。

## 安装（Windows）

从 [Releases](https://github.com/lizaixi01/Legion/releases/latest) 下载 `Legion-Setup-*.exe` 并运行。

- 安装时可勾选**是否创建桌面快捷方式**，完成后可勾选**是否立即运行**。
- 卸载不会删除 `%APPDATA%\Legion`，会话与运行记录保留。

也可以从源码运行：

```sh
npm ci
npm link      # 让 legion 命令可用
legion        # 打开桌面应用
```

## 启动

双击桌面 **Legion** 图标，或在命令行输入 `legion`。

```
legion                打开桌面应用
legion run <config>   运行受管理的任务
legion status <run>   查看运行状态
legion demo           端到端演示（不调用模型）
legion --help         全部用法
```

## 它是怎么工作的

1. **你给目标** —— 在桌面应用里直接说要做的事，或选一个工程目录交给它。
2. **Manager 拆解** —— 一个 Manager 负责规划，把任务分给多个 Worker（子 Agent），可并行执行。
3. **独立检查** —— 登记交付契约后，对确定版本重放检查，不采信模型自评；没有可信功能覆盖的结果保持 `unverified`。通用入口尚未强制识别所有需要登记契约的任务。
4. **证据留痕** —— 每次执行的 prompt、日志、产物哈希与决策都写入 `.runs/`，可回放复查。

## 环境要求

- Node.js 22+（安装电脑默认使用系统 Node；未安装时回退到应用内置运行时）
- 真实执行需要本机可用的 Codex CLI 登录；沿用现有登录，不额外配置 API Key。

## 实验结果与当前边界

[HWE 实验总结与图表（2026-10-03）](docs/hwe-experiment-summary-20261003.md)：深度搜索最终达到 baseline 的 2.99×，历史配对的并行验证加速 1.59×；管理策略 A 的中断恢复结果仅用于探索，A/B 尚不能公平判胜。报告附关键数据和比较限制。

截至 2026-10-01，HWE batch-3 已完成普通 Codex 与管理组的单任务配对运行：管理组最佳候选的公开 CoreMark fitness 高约 27.6%，墙钟时间增加约 75.5%；管理组在配额耗尽时结束，并未收到 Manager 的 finish 决策。gron 的修正后比较则未获得管理收益。方法、失败、成本口径和覆盖限制见[公开实验摘要](docs/experiment-summary.md)及[HWE batch-3](docs/hwe-batch-3-comparison.md)。这些结果不证明普遍成功率或十倍人效。

下一批优先做代码工程任务，先开发试跑，再冻结 20–30 个未参与调优的任务。[三臂协议草案](docs/three-arm-engineering-protocol.md)和[试跑任务清单](docs/engineering-pilot-tasks.md)尚未成为已完成的实验。离线报告工具区分终局成绩、执行状态、基础设施失败、未知用量和重试成本；使用方式见协议。

当前开发重点为 benchmark、结果归因与可用版迭代，平台发放在可用版之后。优先级、已有故障修复和可用性建议门槛见[迭代计划](docs/benchmark-development-plan.md)。

普通聊天已有双后端委派；Command Code 的工具能力目前比 Codex 窄。工程 DAG、持续目标与 HWE 候选研究循环仍有不同入口和验收范围。桌面观察、主动建议、关闭应用后常驻执行和多日可靠性尚未实现或验证。源码已经使用 Git；Worker 候选仍主要使用复制目录和内容哈希，尚未统一为 Git worktree / commit 验收。

## 开发

```sh
npm ci
npm run desktop     # 开发态启动
npm run build       # 测试前生成桌面资源
npm test            # 行为测试
npm run dist        # 构建 Windows 安装包到 dist-release/
```

### 可恢复工程任务

管理核心、领域验收与 benchmark 的代码边界见 [架构说明](docs/architecture-boundaries.md)。HWE 作为宿主任务能力接入，候选循环和主会话核心可在没有 HWE 工具链的离线环境中验证。

benchmark 运行期间继续开发的隔离规则见[并行开发说明](docs/benchmark-safe-development.md)。开发 worktree 与实验冻结副本分开；依赖、任务输入、工具链和 Docker 资源也需要分别保护。

桌面新聊天中选择项目并开启“工程任务”，审核 Manager 提出的需求与测试后执行。安全暂停后可在原任务恢复；旧版本记录仅供查看历史。运行离线恢复演示：`npm run demo:resume`（不调用模型）。CLI、预算、验收与恢复限制见 [恢复设计说明](docs/resumable-engineering.md)。

### Codex runtime for local Legion

Run `npm run runtime:install` before starting a fresh development or experiment checkout. This installs the pinned Codex CLI **0.159.2** under `.local/codex-runtime`. Primary sessions, engineering tasks, workers and capacity probes use that project runtime, not the CLI found on PATH. Include the runtime in an experiment snapshot and record its version; do not upgrade a frozen experiment in place. The separate legacy Linux benchmark harness has its own runtime configuration.

## 许可证

Legion 原创代码与文档采用 [Apache License 2.0](LICENSE)。允许按许可证条款使用、修改、分发和商用；专利授权范围以[许可证原文](https://www.apache.org/licenses/LICENSE-2.0)为准。第三方依赖、CLI、benchmark 数据、任务仓库与工具链保留各自许可证，项目许可证不重新授权这些材料。
