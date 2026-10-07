# CANN 实验结果与证据

归档日期：2026-10-07（Asia/Shanghai）。本次仅发布已有实验结果、候选和配套检查工具，没有调用模型或执行新的 CANN 提交。

当前已验证 incumbent 为 **input-prefetch-r03：Pass 15/15，官方总分 28.87**。10 月 7 日生成的两个后续候选只完成本地源码检查，不能沿用 r03 的成绩作为自己的结果。

## 平台优化实验：2026-10-04

题目为 AddRmsNormBias，problem ID `6a9a9a99bf41025d6013eb85`，CANN 9.0.0。官方总分越高越好，原始逐点耗时单位为 μs。

| 版本 | 官方总分 | 正确性 | 选择与正式报告 |
| --- | ---: | --- | --- |
| v2 | 26.06 | Pass 15/15 | [导入基线](cann-platform-evidence-20261004/v2-baseline/report.json) |
| cache8192 | 26.64 | Pass 15/15 | [扩大权重缓存阈值](cann-platform-evidence-20261004/iter1-cache8192-20261004/report.json) |
| native16k-r01 | 26.89 | Pass 15/15 | [原 dtype 权重缓存](cann-platform-evidence-20261004/adaptive-r01-nativecache-20261004/report.json) |
| reciprocal-r02 | 25.94 | Pass 15/15 | [性能回归，保留 r01](cann-platform-evidence-20261004/adaptive-r02-reciprocal-20261004/report.json) |
| input-prefetch-r03 | **28.87** | **Pass 15/15** | [输入预取，替换 incumbent](cann-platform-evidence-20261004/adaptive-r03-input-prefetch-20261004/report.json) |

r03 相对 v2 增加 2.81 分，相对 r01 增加 1.98 分。历史各时刻的最优参考耗时可能变化；这些分差不等于相同百分比的耗时下降，也不能证明稳定加速或 Agent 效率提高。完整比较和归因限制见 [基线审计](cann-baseline-audit.md)与[九条历史运行索引](cann-runs.jsonl)。v2 的生成模型未知，不使用事后图表名称证明模型身份。

可直接下载[五版本机器摘要](cann-platform-evidence-20261004/summary.json)和[完整 15 点耗时 CSV](cann-platform-evidence-20261004/case-times.csv)。每个版本目录保存精确复制的正式报告、9 文件快照、自身平台 submission 响应、时间单位证据，以及按 submission ID 精确匹配的排行榜行摘录。8 个平台源码文件均逐字节核对快照；第 9 个文件是本地 `.cannjudge-project.json` 元数据。

当前 r03 源码：[kernel.asc](cann-platform-evidence-20261004/adaptive-r03-input-prefetch-20261004/snapshot/kernel.asc)。其 SHA256 为 `5a21645996e97e351c91aa66cb7169893a1c5401a52ea61ffc6923c7ae1f8d53`，submission ID 为 `6ac2635c694b590c3cebe1d8`。选择记录见 [incumbent.json](cann-platform-evidence-20261004/incumbent.json)，实验停止状态见 [search-state.json](cann-platform-evidence-20261004/search-state.json)。历史剩余额度记录不构成新的提交授权。

## 交付证据 A/B 与收尾

[实验报告](cann-delivery-ab-report.md)、[固定条件](cann-delivery-ab-conditions.json)、[八次尝试索引](cann-delivery-ab-results.jsonl)和[收尾审计](cann-delivery-ab-closeout.md)分别保存原始观察、预算规则与故障归属。

四个正式会话的首次冻结输出，经同一个修正版确定性评分器重算均为 18/18。该小样本不支持采用额外的 delivery-evidence Skill；当前决定为“未采用，默认 Codex 加确定性检查器”。正式第四次运行的补交内容合格，但累计 token 超限且原宿主交付未完成，不能补算为合规成功。

配套[输出保存修复](../../src/worker-pool.ts)、[预算和交付状态判定](../../scripts/reviewer/cann-delivery-status.ts)、[离线行为回归](../../tests/cann-delivery-evidence.test.ts)一并发布。修复在完整终态已到达而 CLI 文件缺失时保存最后一条完整输出，保留 cancelled/timeout 和预算失败状态，不改写历史结果。结构化证据见 [closeout.json](cann-delivery-ab-closeout.json)。

## 原生双候选试点：2026-10-07

[试点报告](cann-native-pilot-report.md)记录两个不同机制的候选、资源模型、实际执行器与 hook 边界。两者状态均为 `source_checked_device_pending`，本轮平台提交数为 0；r03 继续作为 incumbent。

| 候选 | 本地探索 | 设备与性能状态 |
| --- | --- | --- |
| [weight-prefetch](cann-native-pilot-20261007/weight-prefetch/candidate/kernel.asc) | 未缓存权重的下一 tile 预取 | 待真机验证；历史建议优先级 1 |
| [output-double-buffer](cann-native-pilot-20261007/output-double-buffer/candidate/kernel.asc) | UB 预算内增加第二个物理输出缓冲 | 待真机验证；历史建议优先级 2 |

[冻结清单](cann-native-pilot-20261007/freeze.json)、[本地检查结果](cann-native-pilot-20261007/checker-regression.json)和[运行索引](cann-native-pilot-20261007/runs.jsonl)保留原始字节。源码资源/队列模型不执行 kernel，也不替代 CANN 编译、设备精度或性能验证。

## 归档范围与复核

[发布哈希清单](cann-platform-evidence-20261004/publication-manifest.json)记录 131 个复制或摘录产物的 SHA256、源路径及复制方式；发布前核对五个版本的 15 点、候选/快照/平台源码身份，并核对原生试点冻结清单。

[发布验证记录](cann-publication-verification-20261007.json)保存 Git 暂存内容的哈希复核、JSON/JSONL 解析、入口链接检查，以及 44/44 离线行为回归、类型检查结果。冻结档案保持原始字节，现有 TypeScript 源码沿用 Git 的换行规范化，并在哈希清单中单独标明。

历史报告和 JSON 中的 Windows 绝对路径是原始来源位置，保留以避免改变冻结证据。在 GitHub 阅读时使用本页的相对链接。完整排行榜页、重复 HTTP 响应、CLI 会话、凭据、虚拟环境和外部 SDK 仍保存在本机；本仓库的排行摘录只含相应 submission 的行及完整源文件 SHA256。

候选和工具以实验档案形式收录在此，不安装 CANN 或改变 Legion 的领域接入方式。原生 hook 配置位于冻结实验子目录，不作为仓库根配置启用。配套检查器沿用原实验的外部项目路径，复跑前需提供对应项目与工具；本次没有重跑正式 A/B 或 NPU 评测。
