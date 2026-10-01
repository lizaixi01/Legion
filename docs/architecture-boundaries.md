# 管理核心、任务环境与 benchmark 的边界

状态：第一轮源码解耦已实现。桌面主会话与候选研究循环仍是两条管理路径；本轮提取各自的通用接口，没有合并调度器，也没有运行模型 benchmark。

Legion 管理任务、资源、候选和证据。任务环境负责产物验收和质量比较，benchmark harness 在声明的实验条件下测量系统。HWE 的 formal、仿真、指标和 readiness 属于任务环境；A/B 组配置、跨组统计和实验报告属于评测层。

## 当前结构

```mermaid
flowchart TD
    UI[桌面聊天] --> Assembly[primary-agent：产品装配]
    Assembly --> Primary[primary-runtime：通用主会话]
    Assembly --> Capability[hwe-primary-capability：领域能力]
    Primary --> Tasks[任务、交付与预算]
    Tasks --> Pool[managed-queue / WorkerPool]
    Pool --> Backend[Codex / Command Code]
    Capability --> Strategy[primary-strategy：通用决策与派工约束]
    Capability --> Check[primary-hwe-check：HWE 验收]
    Check --> Runtime[hwe-runtime：领域宿主执行]
    CLI[research-cli：兼容入口] --> Harness[benchmarks/hwe-cli：实验编排]
    Harness --> Facade[research-loop：HWE 兼容接口]
    Facade --> Loop[management/candidate-loop：通用候选循环]
    Facade --> Quality[hwe-quality：指标门槛与排序]
    Harness --> Deps[hwe：Manager / Worker 适配]
    Deps --> Runtime
    Harness --> Arms[普通组、原生参考组与汇总]
```

产品默认在 `primary-agent` 装配已有 HWE 能力；调用 `primary-runtime` 可以不安装领域能力，也可以注入另一种宿主能力。能力由宿主提供，模型输出不能注册验证器或改写验收规则。

| 边界 | 当前实现 | 依赖约束 |
| --- | --- | --- |
| 候选管理核心 | [candidate-types](../src/management/candidate-types.ts)、[candidate-loop](../src/management/candidate-loop.ts)：状态、来源、资源、并行执行、串行验证和恢复 | 不导入 HWE 或 benchmark；不解释 RTL、ISA、formal 或固定质量字段 |
| 主会话管理核心 | [primary-runtime](../src/primary-runtime.ts)、[primary-capability](../src/primary-capability.ts)、[primary-strategy](../src/primary-strategy.ts)：任务、交付、能力生命周期与证据约束 | 不导入 HWE 或 benchmark；领域工具、提示、证据兼容性和完成检查由宿主提供 |
| 执行基础设施 | 既有后端、队列、进程接口；[wsl-path](../src/wsl-path.ts)、[model_proxy.py](../scripts/runtime/model_proxy.py) | 路径转换与模型传输不归 ProgramBench；执行完成不能签发产物验收 |
| HWE 任务环境 | [hwe-quality](../src/hwe-quality.ts)、[hwe-runtime](../src/hwe-runtime.ts)、[hwe-primary-capability](../src/hwe-primary-capability.ts)，以及既有归档、指纹、证据分类与 Manager 上下文 | 解释 PREUNSAT、ALTOPS、固定 RV32IM 接口、指标和覆盖范围；沿用同一验证器 |
| benchmark harness | [benchmarks/hwe-cli](../src/benchmarks/hwe-cli.ts)、普通组、原生参考组和汇总模块 | 调用被测系统与任务环境；核心不反向导入实验编排或依赖实验组身份 |

HWE 的宿主执行模块不再引用 ProgramBench 的路径工具或模型代理。ProgramBench 现有入口仍可使用：路径导出保留兼容接口，代理准备步骤将共享代理实际文件复制到独立运行目录，旧代理路径保留转发脚本。冻结实验中已复制的文件不迁移、不改写。

## 契约与兼容性

**质量策略。** `QualityPolicy<M>` 提供稳定身份、指标有效性与比较方向，可补充领域基础设施异常判定。HWE 仍要求 fitness、fmax_mhz、lut4、cycles 四项有限且为正，并最大化 fitness。离线另一环境使用最小化 defects，零值合法；同一循环无需修改即可运行。

只有 verified、证据 PASS、无基础设施异常、具备快照且指标有效的候选进入排名。FAIL 与异常可以同时存在：候选仍被拒绝，原始诊断保留，运行停止继续派工。即使某个环境错误地同时返回 PASS 和基础设施异常，核心也不能将其选为 best。

**主会话能力。** 宿主提供工具、领域提示、调用路由、未完成工作、失败、最终证据检查和清理。核心拒绝工具名称冲突；必要工作未结束或选中证据失效时阻止完成。先停止新派工，再关闭任务与领域资源。HWE 指纹兼容性由 HWE issuer 提供，通用策略不自行解释环境字段。

**持久记录。** `research-loop.ts`、`primary-agent.ts`、`research-cli.ts` 和 `hwe.ts` 的原导出/入口保留兼容。HWE `state.json` 仍为 version 1，未重置轮数、Worker 配额、耗时、期限或持续目标账本。新候选运行额外写入 `quality-policy.json`，恢复前核对策略身份；缺少此文件的旧 HWE 运行仅由 HWE 兼容入口按原策略恢复。改动策略语义时宿主必须更换身份，不能复用同一 ID 静默改变目标。

**来源与认证。** 新实验实现清单包含新增核心、环境、CLI 及共享代理依赖。候选源码、父子 diff、Worker 报告和历史 PASS 只是带来源的资料，不能认证新版本。验证器指纹仍自然计算，旧 readiness 与历史证据不改写；实际运行继续遵守原认证要求。

持续目标账本目前已经使用通用 `worker/check` 类别，并没有将 HWE 写进账本类型。本轮保留既有每目标调用上限与未知调用处理，没有增加可任意扩展的资源系统。

## 验证与限制

[边界回归](../tests/management-boundaries.test.ts) 验证不同指标与排序方向、异常保留、恢复策略绑定、旧 HWE 记录兼容、无 HWE 资产的实际离线主会话协议、宿主工具调用与清理，以及未完成/失效证据阻止交付。导入图检查覆盖传递依赖，防止核心通过其他模块重新引入领域或 benchmark。

HWE 的本机路径、WSL/Docker 配置和工具链仍集中在 `hwe-runtime`，尚未实现跨机器自动安装。研究 CLI 的环境维护命令和实验命令仍共用一个兼容入口，但产品验收不依赖该入口。两条管理路径及其预算仍各自保留，是否合并需要另行依据执行语义决定。

本轮结构性回归不能证明 Manager 收益或新场景适用性；也没有扩大真实乘除法、建筑或建模验证覆盖。后续优化管理策略时，可以在这些边界之外冻结任务和评测条件，独立比较策略变化。
