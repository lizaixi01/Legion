# ProgramBench 单题执行

本轮入口为 CLI，复用团队调度器；尚未加入 Electron 的任务创建菜单。

## 准备

- Windows + WSL2 Ubuntu，WSL 中 Docker 可运行 Linux amd64 容器。
- 官方仓库固定到 `b08d8621031f5f5abc4d3ffc2950256c83fbfe42`，本地放在 `.local/programbench`。
- WSL Python 环境安装该版本 ProgramBench。本次环境：`/home/zaixi/.cache/proactive-programbench-venv/bin/python`。
- Linux Codex 使用 `@openai/codex@0.157.1-linux-x64` npm 包，保留 `codex` 和同目录的 `codex-code-mode-host`。
- 拉取首题 cleanroom 镜像：`programbench/tomnomnom_1776_gron.88a6234:task_cleanroom_v6`。
- 本地配置指定现有 Codex 登录文件路径。真实凭证只由宿主模型代理读取，不复制进 Worker。

在项目目录执行：

```powershell
npm run benchmark -- run .local/programbench-gron.json
```

配置示例见 `examples/programbench-gron.json`；替换其中 WSL 路径及登录文件路径。可选 `egressProxy` 用于宿主模型连接及官方评分器安装测试依赖，不提供给 Worker。WSL 默认网关在重启后可能改变，不能永久依赖示例 IP。

Ctrl+C 会取消本次运行并清理带本次运行标签的容器。进程被强行杀死或机器重启的自动接管尚未实现；保留证据，不能直接宣称恢复完成。

## 当前范围

仅 gron 一题。默认两条候选路线，每条最多两次 Worker 调用（8 分钟/次），推理阶段最多 30 分钟。每个候选 2 CPU / 4 GiB，断网，以普通 agent 用户运行。最终评分另有 30 分钟上限。

开发检查包含四个预先固定的参考程序差分案例，验证构建、JSON 展开与反向转换。它们不是官方隐藏测试，也不代表完整覆盖。检查在全新断网容器中重建源码执行；已知参考输出在编译候选前获取。

管理组（candidates=2）暂用已有 evidencePolicy 规则：明确失败允许同会话修复，错误停止。该首题试跑不包含 LLM Manager 的效果比较。

普通 Codex 基线设 candidates=1：只运行一次完整 Worker 会话，关闭内嵌子 Agent，不由管理器续跑或换路线。沿用相同任务、第一条路线提示、模型、推理强度、公开案例和单次时限。正常完成的源码即使公开检查失败也会冻结并评分；该行为仅允许单任务、单次调用的基线，且不会把公开失败标为验收通过。基础设施错误与无提交仍单独记录。当前本机配置为 `.local/programbench-gron-baseline.json`。

超时基线会先暂停容器，保存到时的源码及原始会话记录，再关闭 Worker 并评分源码快照；execution.json 保留 workerTimedOut=true，team 状态仍为 timeout，不冒充正常完成。超时 token 来自会话里最后一条 token_count 的累计用量，尚未被 CLI 记录的在途请求可能未计入。首次基线因旧执行器在超时后直接清理容器而缺失源码和用量，保留为证据不完整的尝试，不作为零分样本，也不能忽略其成本。

## 证据和隔离

- `execution.json`：准备、执行、评分、结束状态。
- `provenance.json`：上游提交、镜像 ID、Codex 版本、模型和公开案例哈希。
- `adapter/`：本次固定的适配器脚本。
- `team/`：候选会话、检查、决策、入选复查与产物。
- `selection.json`：评分前冻结的交付路径和 SHA256。
- `scoring/<instance>/`：选定源码包与官方评估输出。
- `grade.json`：按官方 active/ignored 过滤规则算出的单题分数。

Worker 只挂载模型传输 socket、工具二进制和适配脚本，不挂载宿主项目、评分仓库、Docker socket 或真实登录凭证。模型代理仅允许固定的模型端点，阻止服务器端搜索等工具。没有给候选通用网络连接。

先冻结候选选择，再关闭 Worker/模型代理，之后运行上游评分器。最终分数不会传回 Worker，不用于挑选候选或继续修复。源码归档、原始日志均保留。评分异常与题目测试失败分开记录。

这是一题开发试跑，不是全量 benchmark 结果；后续冻结策略再选 3–5 题。

## 只重评冻结提交

`npx tsx scripts/regrade-programbench.ts <原运行目录> [另一个原运行目录]` 会验证 selection.json 的源码 SHA256，将相同字节复制到独立的 programbench-regrade 目录，使用当前评分桥接重新评分。不会启动 prepare、模型代理或 Worker，也不会覆盖历史分数；新 provenance.json 记录原运行目录及哈希。

评分容器仅使用 PIP_PROXY 下载依赖，不能注入通用 HTTP_PROXY/HTTPS_PROXY：后者会改变被测程序的网络行为。修正已通过两份原始提交的本地 HTTP 回归验证，不使用 NO_PROXY=* 去覆盖程序本身可能需要测试的代理设置。
