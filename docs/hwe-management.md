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
- Worker 回报不能成为共享“事实”。共享事实来自固定验证器，带快照哈希和来源。Manager 在隔离容器中按需读取 `/manager-context` 的只读资料：原始 baseline、当前最佳已验证候选、直接父版本 RTL、版本身份、既有外部结果与指标副本，以及直接父子 diff。`/work/cores/baseline/rtl` 始终代表原始 baseline；best 为 baseline 时明确说明尚无候选改动。未通过检查的父版本仅作为改动来源，不禁止失败路线修复，也不提升为已验证候选。
- 每轮只传入上述相关版本，不挂载宿主运行根或其他试跑。决策调用前核对候选身份、快照哈希、实际路径与安全归档；异常按基础设施错误停止并保存 `manager-context-error.json`。只读目录的 `manifest.json` 和轮次目录的 `manager-context-receipt.json` 记录资料及哈希。源码、diff、Worker 报告和资料清单均不能自行认证；验收仍只认既有独立验证器。父快照使用前及验证前后仍校验摘要。
- Manager 与 Worker 容器均断网，只允许通过 Unix socket 访问模型代理；真实登录凭据保留在宿主。工具链只读挂载。Worker 各 2 CPU/3 GiB，重验证串行，8 CPU/10 GiB。
- 取消后清理该运行的容器与模型代理。进程意外退出时保留锁和证据；核实旧进程停止并处理锁后，可用 CLI resume 继续后续轮次。已分配的调用仍计入预算，不悄悄重跑取最好结果。

## 参考机制

- [Codex 子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)：独立上下文处理噪声较多的工作，主 Agent 接收摘要并集中决策；对并行写入保持谨慎。
- [Claude Code 子 Agent](https://code.claude.com/docs/en/sub-agents)：独立上下文、模型/工具配置，以及按项目限定范围的持久记忆。本项目把可验证事实与 Worker 自述进一步分开。
- [HWE 源码](https://github.com/FeSens/auto-arch-tournament)：复用其验证与性能测量，不沿用固定顺序择一的旧 ProgramBench 策略。

这些是借鉴的公开机制，不声称复制其内部实现。Claude Code 尚未作为这轮执行后端接入。

提供当前候选源码与父子改动是一项上下文传递优化假设。离线回归只确认版本、隔离和证据边界，不证明其提高性能或优于其他管理策略。

## 运行

在项目目录运行：

```powershell
npx tsx src/research-cli.ts preflight  # 只核对 readiness，不调用模型或评分器
npx tsx src/research-cli.ts readiness  # 首次安装或真实环境变化时才运行
npx tsx src/research-cli.ts run
npx tsx src/research-cli.ts resume <运行目录>
npm run desktop
```

GUI 不再提供独立的「微架构实验」任务页。HWE 通过普通主会话进行：用宿主 `tar` 把 RTL 打成扁平 `.tar.gz`，再调用 `legion_hwe_check` 跑冻结验证器，用 `legion_strategy` 记录假设、选择与淘汰。两者都登记 evidence id，选择只认未失效的 host 证据。不会用演示数据冒充完成的实验。

本机路径配置目前集中在 `src/hwe.ts`；工具链安装属于这台 WSL 环境。readiness 要连续两次完整通过且周期数、fitness 相同，才写 ready.json。启动时检查源码/验证器指纹和 Docker 镜像 ID；环境变化需重新执行 readiness。

## 第三步的对照问题

主问题：在同一基线、模型、工具链和公开验证能力下，普通 Codex 完整执行与 Management＋Subagent 的最终正确性、性能、耗时和人工介入有什么差别？允许管理组使用更多 token，完整记录 Manager 与所有 Worker 的用量，不以成本相等代替用户目标。

HWE 官方调度策略作为独立参考组；如果使用了不同调用预算或上下文，必须明确列出。开发过程中调试所花成本与正式对照分开报告，不能用开发试跑代替冻结策略后的对照。单个 CPU 任务只提供机制与个案证据，不能宣称总体成功率提升。

对照协议见 [HWE 本机对照](hwe-comparison-protocol.md)。CLI `ordinary` 提供单会话 Codex 对照；`summary <运行目录>` 汇总模型用量与最终证据。缓存输入已经包含在总输入中，不能重复计费式相加。

## 实验快照中的 readiness 复用

先运行 `npx tsx src/research-cli.ts preflight`，输出 `matches: true`、`baselineMatches: true` 后再进行付费模型预检。新指纹使用 `repo:Makefile` 和 `repo:cores/baseline/core.yaml` 表示两个仓库输入，兼容旧 readiness 的绝对路径。只允许这两项随完整 checkout 迁移；内容 SHA-256、源码集合、提交、验证器、镜像与工具二进制必须保持一致，工具路径也仍严格比较。JSON 对象键顺序不影响结果。缺少输入、重复身份或混合仓库根均拒绝复用。

无需改写旧 ready.json。旧实验快照仍保留失败结果；从修复后的开发版创建新批次，先只读预检再启动 A/B/C。指纹或基线包出现真实变化时，仍须重新建立 readiness。
