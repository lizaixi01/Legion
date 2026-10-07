# CANN 原生双候选试点 · 2026-10-07

已完成两个原生 Codex 子 Agent 的并行探索及本地检查。两个候选均冻结为 `source_checked_device_pending`，本轮 CANN 提交数为 **0**。下一次获准的真机验证优先选择 **weight-prefetch**，其次为 **output-double-buffer**。没有候选获得新的正确性或性能结论，r03 继续作为 incumbent。

固定输入、源码清单和运行索引分别见 [conditions.json](cann-native-pilot-20261007/conditions.json)、[baseline-inventory.json](cann-native-pilot-20261007/baseline-inventory.json)、[runs.jsonl](cann-native-pilot-20261007/runs.jsonl)。原始 CANN 历史文件、上一轮 A/B 记录和未采用的“交付证据清单”Skill 均未修改。

**起点与选择依据。** 起点为 `input-prefetch-r03`，kernel SHA256 为 `5a21645996e97e351c91aa66cb7169893a1c5401a52ea61ffc6923c7ae1f8d53`，submission ID 为 `6ac2635c694b590c3cebe1d8`，既有结果为 15/15 Pass、官方分数 28.87（越高越好）。本轮重新将本地源码与保存的原始 submission 的 UTF-8 源码逐字节核对，结果见 [baseline-source-check.json](cann-native-pilot-20261007/baseline-source-check.json)。该成绩只属于 r03。

已读取历史实验报告及 r02/r03 manager review。r02 的 reciprocal/Muls 在 14/15 个点退化，未重试；r03 的有效变化只在 `ComputeRowSum` 输入预取，`WriteRow` 仍逐块同步加载未缓存权重、使用单个物理输出缓冲。本轮分别探索这两个尚未被上述记录否定的成本。历史隐藏测试点的 shape 未知，不能把某个慢点直接归因于这两个分支。

| 候选 | 唯一主要假设及实际改动 | 本地检查与边界 | 下次验证优先级 |
|---|---|---|---|
| [weight-prefetch/kernel.asc](cann-native-pilot-20261007/weight-prefetch/candidate/kernel.asc) | 在 `WriteRow` 未缓存 gamma/bias 的路径，先装第一块，再于当前块转换前排入下一块；复用 r03 的两个物理输入缓冲 | 仅 `WriteRow` 调度变化；分配、缓存分支、运算/NaN/Inf/输出后缀不变。131,072 个配置、196,608 行、3,248,128 次成对加载的源码模型检查通过；最多 2 个活跃槽、1 个排队条目，各阶段结束为空 | **1**：提前加载的机制明确，不增加 UB，也不增加队列物理槽。仍需验证设备事件、实际重叠和编译兼容性 |
| [output-double-buffer/kernel.asc](cann-native-pilot-20261007/output-double-buffer/candidate/kernel.asc) | 在保留 r03 输入预取决策后，完整 UB 申请量容得下时增加第二个物理 VECOUT 缓冲，尝试减少输出转换等待 | 仅初始化的预算计算及输出槽数变化；17 个计算/入口函数逐字节一致。294,912 个配置的分配模型和 48 组抽象队列检查通过 | **2**：覆盖范围较广、改动小，但原调度已可能让部分运算与输出搬运重叠；只增加物理槽的边际收益、事件资源影响更不确定 |

两份 [kernel.diff](cann-native-pilot-20261007/output-double-buffer/kernel.diff) / [kernel.diff](cann-native-pilot-20261007/weight-prefetch/kernel.diff) 已由主 Codex 检查，改动位置和机制不同，不是同一代码换名。最终 SHA256：

- output-double-buffer：`3e045351d864b301183ab896cd53b91108e44fc795e70246f5b036928050312e`
- weight-prefetch：`5e14d05892324619412bf50352b851cf5cea8a0d9e09a7e3a94b944f0de8e01b`

源码模型中的 180,576 bytes 是沿用的历史申请量上界，不是实测硬件 UB 容量。输出双缓冲适用于 16-bit 的 D=2049…32768，以及 FP32 的 D=2049…26624、28673…30720。权重预取适用于 FP32 的 D=8193…28672；16-bit 每核一行时 D=8193…32768、至少两行时 D=16385…32768。均保留不满足门槛时的原路径。这些枚举是源码资源/队列模型，不执行 kernel，也不模拟设备 DMA 同步。

**实际使用的原生入口。** 两名执行器通过本会话 `collaboration.spawn_agent` 启动，使用独立的 9 文件候选目录；各自只写自己的 `kernel.asc`。隔离依靠明确的文件权限范围、独立目录和事后文件/轨迹检查，没有声称建立了 OS 写入沙箱。原生 session metadata 确认运行时为 **0.162.0-alpha.2、multi-agent v2、gpt-6-astra、effort=max**，不是依据本机配置猜测模型。

另行核对的仓库固定 CLI 为 0.159.2（`multi_agent`、`hooks`、`skill_search` 启用），PATH CLI 为 0.154.0；它们不等于实际子 Agent 的桌面运行时。版本、命令路径和环境探测见 [capabilities.json](cann-native-pilot-20261007/capabilities.json)。官方入口参考：[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)、[Skills](https://learn.chatgpt.com/docs/build-skills)、[Hooks](https://learn.chatgpt.com/docs/hooks)。

本轮创建并调用了简短的 [cann-single-hypothesis Skill](../../.agents/skills/cann-single-hypothesis/SKILL.md)：只约束单一假设、历史反证、新理由、可执行检查及未验证事项。两条原生轨迹均实际执行了 `Get-Content .../SKILL.md`，调用 ordinal 均为 14；具体时间见 runs.jsonl。Skill 的读取已包含在 token 用量中。两人都保持一个假设并报告未知事项；这不是 Skill 效果的 A/B 证据，不能把该行为归因于 Skill 而排除任务提示的影响。

**检查器与 Hook。** 新增 [cann-candidate-check.py](../../scripts/reviewer/cann-candidate-check.py) 仅作离线适配，复用现有 `evaluate.py::project_inventory` 检查路径、文件与 SHA，另核对固定基线、额外文件、脚手架和候选差异；不实例化 Evaluator/OfficialAdapter，不调用带联网行为的 precheck。Skill 负责假设、历史联系和边界说明。

主 Codex 显式执行同一脚本，结果为通过：基线未变，两候选均只改 kernel，其余 8 文件不变，候选 SHA 互异。正常候选、故障注入的脚手架改动、故障注入的 kernel 缺失三条适配器检查均符合预期；失败路径会保存已有检查结果或错误。故障注入只发生在临时副本，见 [checker-regression.json](cann-native-pilot-20261007/checker-regression.json)。

已准备 `PostToolUse`（Bash/apply_patch/Edit/Write）[Hook 配置](cann-native-pilot-20261007/.codex/hooks.json)，指向同一脚本。0.159.2 原生 `hooks/list` 在试点和仓库目录均返回空列表；`config/read` 能看到项目层且 `disabledReason=null`。因此未证实配置装载或自动触发，准确原因尚未确定，不能写成已观察到 trust 拒绝，也不能由此断言桌面版本不支持 Hooks。保留 [Hook 探测和回退记录](cann-native-pilot-20261007/hook-status.json)，按用户允许的回退显式调用。临时仓库根 Hook 文件已撤下，保留试点范围的配置草稿，未改全局配置；探测没有模型 turn。

**结果与实际消耗。** 两个原生会话均发出了 `task_complete`；代码、原始输出、解析后的检查结果和 usage 已落盘。子 Agent 自报的局部工作计时不包括完整会话，以下使用原生 session 起点至 terminal 事件：

| 执行器 | 输入 token（含缓存） | 缓存输入 | 输出 token | 合计 | 会话耗时 |
|---|---:|---:|---:|---:|---:|
| output-double-buffer | 400,879 | 332,160 | 9,047 | 409,926 | 312.169 s |
| weight-prefetch | 473,913 | 447,360 | 9,640 | 483,553 | 328.438 s |
| 两执行器合计 | 874,792 | 779,520 | 18,687 | **893,479** | 并行窗口 **344.854 s** |

缓存输入是输入的子集，reasoning token 是输出的子集，未重复相加。没有给本轮新增模型硬 token 上限；停止条件是每人一个候选、本地检查后冻结，不进行优化重试循环。主 Codex 的读取、协调及收尾消耗单列在 [usage.json](cann-native-pilot-20261007/usage.json)，其明确标注检查点及尚未计入的后续输出；上表不是整轮总成本，也不据此宣称并行比单 Agent 省 token 或省时。

截至 2026-10-07T07:08:40.041Z，主 Codex 本轮已记录 3,534,844 token（缓存输入 3,321,472），连同两执行器合计至少 **4,428,323 token**。后续收尾和最终回复尚未计入。主控读取、能力探测和归档成本较大；本试点只证明能交付两份候选，不证明该组织方式更高效。

可复核材料：两个目录各有 `executor-report.md`、`trace.jsonl`、`local-check-results.json` 和 `kernel.diff`；runs.jsonl 记录原生原始轨迹路径、独立归档路径及 SHA。候选文件设为 Git 不转换文本，保护后续 checkout 的源码及脚手架字节身份。

本机未找到 Ascend 编译器、CMake 或 npu-smi；CANN 编译、设备正确性和性能均未执行。平台旧累计额度为 5，已用 4，剩余 1；旧 ledger deadline 已过，本轮未建立候选绑定的新请求及有限截止时间，详见 [platform-budget.json](cann-native-pilot-20261007/platform-budget.json)。没有放宽或消耗该额度。

下一次真机验证只先测 weight-prefetch 的上述精确 SHA；编译或正确性失败则淘汰，基础设施失败记为不确定。替换 r03 至少要求源码绑定、完整 15/15 Pass 且官方分数高于 28.87，并检查全部逐点时间；小幅单次分数差不能证明稳定提速。若未满足，保留 r03，再决定是否使用后续获准预算验证输出双缓冲。本轮在两个候选及本地检查完成后停止。
