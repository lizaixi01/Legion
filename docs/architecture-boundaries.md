# Legion 架构与职责边界

2026-10-04。产品管理通用任务、候选、资源、证据与恢复。外部项目通过项目说明、文件和命令使用产品；项目的验证器、工具链、质量指标和实验协议由项目维护。

## 默认桌面加载链

`desktop/main.cjs` 加载 `chat-service`、`desktop-service`、`engineering-product`、模型目录、聊天链接、账户容量和池服务。`chat-service` 使用 `primary-agent`，后者直接装配 `primary-runtime` 的通用工具、提示和空能力。默认注册 `legion_delivery`、`legion_dispatch`、`legion_tasks`，不依据目录或聊天内容自动安装领域能力。

桌面读取通用聊天、任务历史、交付证据、决策和累计预算。旧记录的附加字段只作为历史数据存在，不注册工具、触发检查或获得当前验收权；只读加载不修改旧文件。UI 不解释固定的领域质量字段。

## 保留的通用接口

| 边界 | 职责与约束 |
| --- | --- |
| [候选类型](../src/management/candidate-types.ts)与[候选循环](../src/management/candidate-loop.ts) | `ResearchDeps` 提供基线、决策、工作、验证和收尾；`QualityPolicy` 提供身份、指标有效性、比较方向及可选基础设施故障判定。管理层保留状态、哈希、派发、选择和预算。 |
| [主会话](../src/primary-runtime.ts)与[产品装配](../src/primary-agent.ts) | 通用任务与交付工具；默认无领域能力。保留原通用导出、参数和可选能力工厂。 |
| [PrimaryCapability](../src/primary-capability.ts)与[策略记录](../src/primary-strategy.ts) | 宿主可显式提供工具、提示、证据、完成门控与清理。拒绝重名工具；未完成工作或失效证据阻止完成。模型不能替换宿主规则。 |
| [交付](../src/primary-delivery.ts)与[验收](../src/acceptance.ts) | 冻结要求与产物，独立审查并重放声明检查。当前默认功能认证覆盖数值聚合；覆盖不足保持未验证。 |
| [共享执行](../src/process.ts)、[队列](../src/managed-queue.ts)、[WorkerPool](../src/worker-pool.ts)、[模型代理](../scripts/runtime/model_proxy.py) | 保留进程、队列、取消、排空、资源清理及已提交的可靠性优化。代理至多一次出站尝试，不把不确定执行隐藏为重试。 |
| [候选汇总](../src/research-summary.ts) | 使用通用状态类型与观测用量。未知成本不是零，重叠耗时之和不是墙钟。 |

候选管理和桌面管理继续各自运行，不合并调度循环，不增加环境安装器、搜索策略或重复抽象。其他既有评测入口保持自己的边界。

## 调度、质量与恢复不变量

`allocationsPerRound` 限制每轮分配，`concurrency` 限制活跃 Worker，`verificationConcurrency` 只接受 1 或 2。缺省保留原 `round-barrier`、每轮按 Worker 并发数分配和单验证位置；显式 `worker-ready` 支持完成后入队。当前队列已存在，本次没有更改其算法。

分配按原预算消费；取消、期限和基础设施故障停止新派发，已启动工作必须排空后清理。快照在派发及检查前后核对哈希，正常拒绝与基础设施异常同时保留。只有指标有效且无基础设施错误的通过候选可以排名；严格比较按分配顺序保留平局，包括基线。

新运行写入 `quality-policy.json`。恢复先核对策略身份及有效配置，不重写保存配置的形态，不补充已消费次数或时间。缺少策略旁文件默认拒绝恢复；既有通用参数只允许宿主显式声明相同历史策略。宿主改变策略语义必须改变身份。

主会话终止时先停止派工，再关闭任务与能力。持续目标保留原 6 小时期限、累计 64 次 Worker/独立复核和 3 次宿主检查账本。默认交付工具沿用每轮最多 3 次交付检查；账本类型、次数、占用和异常未知状态没有变更，不能把两个检查范围混为一谈。

## 构建与验收

[干净构建](../scripts/build.cjs)仅清理本工作树 `dist`，通过 [产品配置](../tsconfig.build.json)编译源码，再生成桌面资源。类型检查仍包含全部测试。发布清单只收 `dist/src`、`dist/desktop`、桌面文件及原依赖，不把仓库测试和实验材料装入包。

[边界回归](../tests/management-boundaries.test.ts)覆盖不同指标与比较方向、策略身份、恢复、能力生命周期及桌面服务传递依赖。[桌面离线回合](../tests/desktop-offline.test.ts)通过实际主进程入口及编译后的服务验证通用聊天、派工、交付和历史读取。详细验收范围见[审计清单](product-boundary-audit.md)。离线验证不证明真实模型、跨机器工具链、性能收益或多日可靠性。
