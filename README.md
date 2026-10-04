# Legion

**Legion 是一款 Multi-Agent 管理器，通过协调多个 Agent，探索用 1000 倍 Token 换取 10 倍效率与生产力。**

这是研究目标，尚未实测达成。我们关心的是：在基本不增加人的监督、决策、验收和返工时间的前提下，更多计算能否带来更多合格交付。

Legion 是现成执行器之上的持续管理层：围绕目标安排任务、并行探索、检查候选、保留证据，再决定继续、返工或结束。管理 Codex、Claude Code 等执行器是项目方向；**当前已接入 Codex 与 Command Code，尚未接入 Claude Code**。

## 它怎样工作

1. **给目标与约束**：选择项目、添加文件，说明要交付什么。
2. **安排多个 Worker**：Codex 主会话担任 Manager，在独立工作目录分配任务、读取结果并调整下一步。
3. **检查确定版本**：把候选交给外部验证器；执行结束或模型自评通过，都不能替代验收证据。
4. **继续或交付**：保留候选、失败、检查与决策记录；只有已安装验证器覆盖并通过的要求才能获得认证，覆盖不足时保持 `unverified`。

当前有普通聊天、显式持续目标、可恢复工程任务和通用候选管理接口，能力与验收范围仍有区别。详见[主 Agent](docs/primary-agent.md)与[架构边界](docs/architecture-boundaries.md)。

## 验证与研究边界

产品负责管理任务、预算、候选版本、交付检查和恢复。外部项目通过自己的说明、文件与命令提供任务上下文；产品不自动识别领域、安装工具链或改变项目验收规则。

通用候选循环接收 `ResearchDeps` 与 `QualityPolicy`，支持不同指标和比较方向。默认桌面主会话使用通用任务工具；宿主可通过已有 `PrimaryCapability` 接口安装明确的能力。历史实验、原始数据与冻结实现独立保全，不属于产品发布包。离线回归证明声明的行为边界，不能据此宣称管理效率或人效提升。

## 开始使用

### Windows 安装包

从 [Releases](https://github.com/lizaixi01/Legion/releases/latest) 下载 `Legion-Setup-*.exe`，安装后打开 Legion。安装时可选择桌面快捷方式；卸载保留 `%APPDATA%\Legion` 中的会话与运行记录。

安装包与 main 的开发进度可能不同；本文的能力说明以 **2026-10-04 的产品工作分支**为准。

### 从源码运行

需要 **Node.js 22+** 和本机可用的 Codex 登录；沿用现有登录，不额外配置 API Key。

```sh
git clone https://github.com/lizaixi01/Legion.git
cd Legion
npm ci
npm run runtime:install  # 安装项目固定的 Codex CLI 0.159.2
npm run desktop         # 构建并打开桌面应用
```

选择项目、添加相关文件后输入目标；需要跨轮推进时开启“持续目标”。已有工程任务可在恢复入口核对要求与批准的测试，安全暂停后在原任务恢复，限制见[恢复设计](docs/resumable-engineering.md)。

不调用模型的流程演示：`npm run demo`、`npm run demo:resume`。CLI 用法：`node bin/legion.cjs --help`；安装包用户也可通过 `legion` 打开桌面应用。

## 当前支持范围

| 能力 | 当前范围 |
|---|---|
| 执行器 | Codex 主会话；Codex / Command Code Worker。Command Code 的工具能力比 Codex 窄，Claude Code 尚未接入。 |
| 管理与继续 | 任务分配、并发队列、候选与决策记录、显式持续目标；可恢复工程任务有独立入口与条件。 |
| 验收 | 通用交付认证目前限内置数值聚合验证器；其他文件可获审查证据，功能覆盖不足仍未验证。工程入口重放批准的测试。 |
| 仍待完成或验证 | 桌面观察、主动建议、关闭应用后常驻执行、多日可靠性、任意工程环境支持与跨后端 Token / 费用硬预算。 |

通用入口尚未强制识别所有需要登记交付契约的任务。Worker 候选主要使用复制目录与内容哈希，尚未统一为 Git worktree / commit 验收。隔离工作目录也不等于操作系统安全隔离。

## 开发与资料

```sh
npm run build       # 清理旧输出、编译产品源码并生成桌面资源
npm test            # 行为测试
npm run dist        # Windows 安装包输出到 dist-release/
```

开发前阅读[架构边界](docs/architecture-boundaries.md)、[迭代计划](docs/benchmark-development-plan.md)与[实验期间的隔离规则](docs/benchmark-safe-development.md)。项目固定 runtime 位于 `.local/codex-runtime`；实验快照需记录运行时版本，不在冻结实验上原地升级。旧 Linux benchmark harness 有独立运行时配置。

## 许可证

Legion 原创代码与文档采用 [Apache License 2.0](LICENSE)。第三方依赖、CLI、benchmark 数据、任务仓库与工具链保留各自许可证。
