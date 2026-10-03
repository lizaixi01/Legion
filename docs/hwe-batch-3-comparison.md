# HWE batch-3：普通 Codex 与管理组的配对运行

日期：2026-10-01。归档批次为 `hwe-comparison-batch-3`，状态 `complete-valid`。以下内容来自本机冻结 result.json、运行记录与后续诊断；整理文档时没有重跑模型或验证器。

## 方法

同一冻结 RV32IM baseline、工具链和公开验证门槛。A 为普通 Codex 的一次工作会话；B 为 Manager 管理的两轮、最多四次 Worker，并发上限 2。两组实现模型和 B 的管理模型均为 gpt-6.1-sol/xhigh。实际实验 Linux Codex 为 0.157.1；Windows 私有 0.159.2 没有用于本批次。两组资源配置不同，不能由这一次结果识别管理策略的独立因果效应。

## 结果

| 指标 | A：普通 Codex | B：Legion 管理组 |
| --- | ---: | ---: |
| 运行结束状态 | completed | budget（两轮 / 四次 Worker 配额用尽） |
| 最终候选公开检查 | pass | pass |
| 入选候选 | 普通组提交 | borrow-driven-restoring-divmod |
| CoreMark fitness（iter/s） | 113.14 | 144.34 |
| Fmax（MHz） | 61.46 | 64.83 |
| LUT4 | 7,795 | 7,356 |
| CoreMark 周期 | 5,432,318 | 4,491,485 |
| 墙钟时间 | 34.33 分钟 | 60.24 分钟 |
| Manager / Worker 调用 | 0 / 1 | 2 / 4 |
| 外部验证次数 | 1 | 4 |
| 外部验证累计时长 | 321.741 秒 | 1,434.924 秒 |
| 观测 input（含 cached） | 3,839,419 | 3,329,397 |
| 其中 cached input | 3,678,464 | 3,052,672 |
| 未缓存 input | 160,955 | 276,725 |
| output | 31,688 | 54,921 |
| 观测 input + output | 3,871,107 | 3,384,318 |

B 相对 A：fitness +27.58%，LUT4 −5.63%，墙钟 +75.49%，验证累计时长约 4.46 倍。两组最佳候选随后在新验证容器复核，记录中的指标完全复现。B 保留了通过检查的候选，但 Manager 未发出 finish；不能用批次退出码代替运行状态。

冻结 baseline 的 fitness 为 30.79 iter/s、Fmax 13.83 MHz、LUT4 13,964、周期 4,491,485。相对 baseline 的改善与相对普通 Agent 的差异分别报告，不能混为管理收益。

## 失败与成本完整性

B 的其他三条候选中，两条通过公开检查但性能低于最终入选者；opcode-qualified-load-use 被拒绝。原摘要曾将后者误读为纯工具 ERROR。后续完整日志确认 reg_ch0 的 step 20 断言 FAIL、反例 trace 和 FAIL 终态，拒绝有独立失败证据支持。合法 `_ch1` PREUNSAT 和真实 FAIL 必须区分；历史报告保留，诊断不能静默修改原结果。

正式有效运行之前发生了期限修正、过期锁和导出等待余量问题。批次记录 3 次基础设施恢复、0 次人工解题干预。一次失败尝试没有完整用量，记 unknown。批次观测总 token 7,271,989 含 A/B、预检与探针，不含该未知用量，不能称为完整精确成本。有效 A/B 都使用增加宿主导出等待余量后的代码；Worker/Manager 容器内时限没有因此提高。

## 可核对身份与公开可获取性

| 项目 | SHA-256 |
| --- | --- |
| 冻结 baseline 包 | `7447e15a991cb8b366f11aa956eee1d9afe8f2608d1fde7a44537ff1027ebf62` |
| A 最终候选包 | `3024ad19f24cceffc18fc0b8eebdb7a212c96c42fe1a1ea638d27804c1bd42ca` |
| B 最终候选包 | `0acbf7d9287f0393ab0c5a754a76736b085ec1afced26ed00598ca5ebfbe0a89` |

镜像身份为 `sha256:2cd0841ed21c21d10ef82655f457e239a633c22989e02223686e04ac14d67d03`。原始本机目录：`.local/hwe-comparison-batch-3/`；A 运行 `.runs/ordinary-975363cb-b1cd-4ea9-b91c-316ddb591d38/`；B 运行 `.runs/run-925fc0a3-6d33-4806-b5cf-92bdc4625334/`。这些被忽略的目录不会随 Git checkout 下载，完整候选和镜像也未由本页发布。

[机器可读摘要](experiment-data/hwe-batch-3-summary.json)提供数值与身份核对，不把哈希当成可下载的产物，也不声称一条命令即可在新机器上复现。当前新版 verifier 已修复 formal 分类；复验历史成绩须明确使用历史冻结验证器，扩展检查须另列结果，不覆盖原评分。

## 覆盖与结论

公开门槛为 lint、编译/Verilator、有限 ISS/CRC cosim、bounded ALTOPS formal、综合及三 seed nextpnr。ALTOPS 不完整证明真实乘除法，PREUNSAT 不是新增有效行为证明，有限程序不是穷尽工作负载，Fmax 没有实物板卡确认。

这次结果提供了管理组产物性能更好的探索信号，同时付出了更多墙钟与验证计算。单任务单次、不同资源和未测人工总时间，不能推出通用正确性、稳定管理收益或十倍人效。更早的未完成批次见[batch-1/2 历史记录](hwe-first-comparison.md)，不得与本批次混成同一配对。
