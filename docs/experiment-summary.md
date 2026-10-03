# 公开实验摘要

更新日期：2026-10-01。汇总已结束的实验，不将正在准备或运行的批次计入结论。产品实现、离线回归、真实烟测和对照结果分别记录。

## 当前证据

| 实验 | 对照条件 | 观察结果 | 解释范围 |
| --- | --- | --- | --- |
| ProgramBench gron，冻结提交重评 | 普通 Codex vs 规则管理双候选；GPT-6 Sol/medium | A 177/224（79.02%），B 170/224（75.89%）；所列有效运行 B token 为 A 的约 1.74 倍 | 当前组合未获得收益；单题单次、有历史执行器差异，不是严格随机对照 |
| HWE 开发试跑 | 两轮 Manager、四次 Worker；与冻结 baseline 比较 | 入选 divsharedquotrem 为 39.94 iter/s，较 baseline +29.7% | 证明真实闭环可运行；没有同批普通 Agent 对照，不能归因于管理策略 |
| HWE batch-1/2 | 普通执行与管理执行的早期配对尝试 | batch-2 普通组通过公开检查；管理组未完成 | 历史基础设施中断，不构成有效完整配对，也不记为解题失败 |
| HWE batch-3 | 同一冻结 baseline、工具链与公开检查；实现及管理模型为 gpt-6.1-sol/xhigh | A 113.14，B 144.34 iter/s（+27.58%）；B 墙钟 +75.49%、验证时间约 4.46 倍 | 已完成单任务配对；不同总资源，未识别 Manager 的独立因果贡献或人效改善 |

来源：[gron 修正结果](programbench-corrected-comparison.md)、[HWE 开发试跑](hwe-development-run.md)、[batch-1/2 历史记录](hwe-first-comparison.md)、[batch-3 公开报告](hwe-batch-3-comparison.md)。batch-3 的可读数值同时记录在[机器可读摘要](experiment-data/hwe-batch-3-summary.json)。

HWE batch-3 的管理组状态为 `budget`：两轮、四次 Worker 配额用尽，有通过公开检查的最佳候选。不能将批次退出码 0、候选通过检查或保留最佳，写成 Manager 已判断完整任务完成。

## 成本与人工介入

gron 所列有效运行没有包含首次超时且用量不完整的基线尝试。HWE batch-3 观测到的批次总 token 为 7,271,989，包含两组、预检与探针，但不包含一次导出失败尝试的未知用量。未知值不能记成零；缓存输入已包含在 input，不重复累加。未缓存输入、输出、墙钟、验证计算和容器数量应分别报告，总 token 较少不能直接解释为账单费用较低。

HWE batch-3 记录解题干预 0 次，同时记录 3 次基础设施恢复。尚未测量用户澄清、监督、验收、返工和环境维护的完整人工时间，因此没有十倍人效的结论。

## 验证范围与诊断更正

HWE 结果覆盖冻结的 lint、编译/Verilator、有限 ISS/CRC cosim、bounded ALTOPS formal、综合与三 seed nextpnr 测量。ALTOPS 不完整证明真实乘除法；PREUNSAT 不代表额外的非空行为证明；有限仿真不是穷尽验证；Fmax 为布局布线估计，未做实物板卡验证。

batch-3 的 opcode-qualified-load-use 曾被早期摘要解释为“纯引擎 ERROR”。后续逐项核对原始状态、完整日志和 trace，确认 reg_ch0 有 `Assert failed`、终态 FAIL 与反例 trace；该候选应维持 rejected。通用 ERROR/FAIL 分类缺陷随后修复，但不能据此改判这个真实失败候选或改写历史成绩。诊断与可移植夹具见[实现记录](implementation-status.md#2026-10-01hwe-formal-分类与证据传递修复)及[夹具说明](../tests/fixtures/hwe-formal/README.md)。

## 实现成熟度与复现边界

真实 Codex 执行、同会话修复、并行任务、主会话委派与 HWE 管理闭环均有本机记录。离线恢复、证据篡改、预算、取消和基础设施分类回归验证了实现边界，不证明真实模型长期可靠性。通用主会话、工程任务与研究循环的预算和验收尚未统一。

普通主会话默认功能 registry 仍限数值聚合；旧持续目标入口有联系人清洗验证器；Node 工程使用批准的冻结测试；HWE 有独立领域检查。这些能力不等于任意任务都获得可信认证。[主会话边界](primary-agent.md)、[工程恢复](resumable-engineering.md)、[验收机制历史实现](acceptance-loop.md)各自说明适用范围。

公开摘要及哈希不包含完整候选、全部原始日志、工具链镜像或本机依赖。它们是对归档证据的整理，不是独立第三方复现报告。当前没有可在新机器上一条命令重放历史 HWE 结果的通用证据包。重跑模型也不能保证生成相同候选；候选复验与重新优化应分开说明。补齐可获取的候选归档、验证器版本、环境/输入哈希与重放入口，是后续可复现性工作。

## 后续实验准备（2026-10-02）

用户已选择优先做代码工程任务：先开发试跑，再冻结 20–30 题的正式任务集。[三臂协议](three-arm-engineering-protocol.md)规定单 Agent、多 Worker、多 Worker 加独立验收使用相同终局评测器。当前已有离线报告工具与[三项试跑提案](engineering-pilot-tasks.md)，尚无这三臂的模型运行或对照成绩，不能把空记录或测试夹具当实验结果。Legion 原创代码与文档已按用户选择声明 Apache-2.0；第三方实验材料仍需分别核对发布权利。
