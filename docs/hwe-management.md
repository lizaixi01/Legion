# HWE 微架构管理闭环

本阶段选择 FeSens/auto-arch-tournament 的 RV32IM baseline 优化任务。不是同名的硬件缺陷修复或电路原理图数据集。先在本机重复验证基线，再允许模型执行。

## 工作过程

1. Manager 根据目标、已验证基线、前轮测量和失败记录，返回结构化假设、父快照、实验方法、预期变化和执行时间。
2. 每个 Worker 获得单独 Docker 容器、独立 Codex 会话和父快照。只导出 RTL；REPORT.md 中的实验结论保留为未经独立确认的陈述。
3. 外部验证器从冻结参考环境重新创建容器，加载导出的 RTL，运行 lint、CoreMark 编译、Verilator 构建、ISS/CRC cosim、riscv-formal、综合和三种 seed 的 nextpnr。Worker 对检查脚本的修改不会进入这里。
4. 只有通过全部门槛且指标完整、有限的结果才可成为当前最佳。Manager 根据失败证据修复分支、提出新路线、淘汰分支、调整每个 Worker 的时间，或结束。程序限制总轮数、调用次数、并行度和总时间。

正确性范围是公开验证器的覆盖范围，不承诺“完美正确”。快速 formal 使用 ALTOPS，上游计数还可能包含 PREUNSAT，不能把数量直接当作非空证明覆盖；CoreMark CRC 不是任意程序的穷尽验证；Fmax 是 FPGA 布局布线时序估计，没有实物板卡测试。指标包括 CoreMark iter/s、Fmax、LUT4 和周期数，未通过者不参与排名。

## 隔离与记忆

- Manager 和 Worker 的模型/推理强度独立配置。当前运行后端为 Codex CLI，沿用本机登录；没有新增 API Key。
- 主会话保留目标和决策，Worker 保留独立上下文；候选之间不直接聊天。修复从指定源码快照开启新会话，附带相关外部证据，不把旧完整对话塞入新会话。
- `state.json` 保存结构化状态；`events.jsonl` 保留追加事件；每轮 `memory.json` 保存实际提供给 Manager 的精简记录。原始模型日志、REPORT.md 和验证日志单独留档。
- Worker 回报不能成为共享“事实”。共享事实来自固定验证器，带快照哈希和来源。Manager 在隔离容器中只能查看公开 baseline 和传入的证据，无法读取宿主上的其他试跑。父快照使用前及验证前后均校验摘要。
- Manager 与 Worker 容器均断网，只允许通过 Unix socket 访问模型代理；真实登录凭据保留在宿主。工具链只读挂载。Worker 各 2 CPU/3 GiB，重验证串行，8 CPU/10 GiB。
- 取消后清理该运行的容器与模型代理。进程意外退出时保留锁和证据；核实旧进程停止并处理锁后，可用 CLI resume 继续后续轮次。已分配的调用仍计入预算，不悄悄重跑取最好结果。

## 参考机制

- [Codex 子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)：独立上下文处理噪声较多的工作，主 Agent 接收摘要并集中决策；对并行写入保持谨慎。
- [Claude Code 子 Agent](https://code.claude.com/docs/en/sub-agents)：独立上下文、模型/工具配置，以及按项目限定范围的持久记忆。本项目把可验证事实与 Worker 自述进一步分开。
- [HWE 源码](https://github.com/FeSens/auto-arch-tournament)：复用其验证与性能测量，不沿用固定顺序择一的旧 ProgramBench 策略。

这些是借鉴的公开机制，不声称复制其内部实现。Claude Code 尚未作为这轮执行后端接入。

## 运行

在项目目录运行：

```powershell
npx tsx src/research-cli.ts readiness
npx tsx src/research-cli.ts run
npx tsx src/research-cli.ts resume <运行目录>
npm run desktop
```

GUI 左下「微架构实验」进入任务页，选择 Manager/Worker、轮数和并行度；实际状态、比较表、决策与证据来自同一运行记录。不会用演示数据冒充完成的实验。

本机路径配置目前集中在 `src/hwe.ts`；工具链安装属于这台 WSL 环境。readiness 要连续两次完整通过且周期数、fitness 相同，才写 ready.json。启动时检查源码/验证器指纹和 Docker 镜像 ID；环境变化需重新执行 readiness。

## 第三步的对照问题

主问题：在同一基线、模型、工具链和公开验证能力下，普通 Codex 完整执行与 Management＋Subagent 的最终正确性、性能、耗时和人工介入有什么差别？允许管理组使用更多 token，完整记录 Manager 与所有 Worker 的用量，不以成本相等代替用户目标。

HWE 官方调度策略作为独立参考组；如果使用了不同调用预算或上下文，必须明确列出。开发过程中调试所花成本与正式对照分开报告，不能用开发试跑代替冻结策略后的对照。单个 CPU 任务只提供机制与个案证据，不能宣称总体成功率提升。

对照协议见 [HWE 本机对照](hwe-comparison-protocol.md)。CLI `ordinary` 提供单会话 Codex 对照；`summary <运行目录>` 汇总模型用量与最终证据。缓存输入已经包含在总输入中，不能重复计费式相加。
