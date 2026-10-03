# 并行候选的设计依据

参考资料首次核对日期：2026-09-28；项目现状更新：2026-10-01。以下区分官方能力、历史实现与当前实现，不描述它们全部内部机制。

- [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)：将独立工作放入子上下文，主代理聚焦需求与决策，返回摘要；并行写入需要谨慎。
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)：可配置模型、推理强度、工具和权限；worktree 支持独立仓库副本。
- [Claude Code Agent teams](https://code.claude.com/docs/en/agent-teams)：竞争假设适合并行探索，团队增加协调开销，同文件修改会冲突。

## 当前实现

Legion 源码现已使用 Git。普通主会话以独立工作目录派发 Codex / Command Code；工程任务复制冻结的源文件和已验收依赖；HWE 研究 Worker 使用独立 Docker 环境及源码归档。目录、worktree 与容器是不同层次的隔离，不能互相替代。Worker 候选尚未统一使用“一条分支、一个 Git worktree、一个候选 commit”的形式。

验收仍绑定冻结契约、确定文件/归档内容、manifest、环境指纹和宿主签发证据。复制快照可以按内容哈希核对并重放；当前主要缺口是候选/环境的公开可获取性与通用重放入口，不能称为复制快照本身完全不可复核。Git commit 可补充标准来源、父子关系、diff 和恢复方式，但不能证明功能正确或自动锁定外部环境。

通用主会话与 HWE 研究循环已按宿主领域能力、质量策略和 benchmark harness 分离，仍保留两条管理执行路径。参见[架构边界](architecture-boundaries.md)、[主会话](primary-agent.md)及[当前实验摘要](experiment-summary.md)。

## 历史两候选切片

2026-09-28 的工程切片增加两条候选路线。每条最多两次实现调用，总上限四次；候选共享检查标准，分别重放。按照固定声明顺序选择复查通过的候选，不通过主观模型评分放宽验收。该策略筛选可行候选，不证明哪一个最优。当时尚未实现独立挑战者；此限制不代表当前全项目现状。

该切片同一时间运行一个逻辑任务的两条路线，避免任务并发乘以候选并发；取消与总期限传播给全部候选。随后已接入新会话 Challenger 和宿主断言重放；模型测试是审查提案，只有宿主安装的功能验证器覆盖并通过时才可认证。HWE 研究循环则由固定领域验证与质量排序筛选候选，不按历史声明顺序选择。[验收实现记录](acceptance-loop.md)注明了入口与预算差异。

## Git worktree 的适用范围

[Git worktree](https://git-scm.com/docs/git-worktree)让同一仓库的不同分支拥有独立检出目录；各自的 HEAD 和 index 分开，Git 对象与部分配置、refs 共享。[Claude Code 的 worktree 工作流](https://code.claude.com/docs/en/common-workflows#run-parallel-sessions-with-worktrees)也采用这种方式。它改善并行编辑、合并和来源追踪，不提供 CPU/内存、凭据、网络或同用户文件访问的 OS 沙箱。

候选 commit 已引用确定的根 tree；记录 tree hash 可明确内容身份，并区分同内容、不同提交元数据的版本。验收应由宿主检出该版本，限制未跟踪文件和外部输入，固定验证器/环境后实际检查；合并结果需要重新验收。源码对象也要可获取，例如公开提交或 Git bundle；仅列一个 SHA 不构成可复现证据包。[Git 对象说明](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)解释了 commit 与 tree 的关系。

开发 worktree 已可用于隔离当前文档工作；这不表示 Legion 自动为每个 Worker 创建 worktree 的功能已经实现。运行中 benchmark 的保护规则见[并行开发说明](benchmark-safe-development.md)。
