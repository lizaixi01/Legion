# SaaSBench 执行层（task_kmasmnil × Single）

对外入口：`npm run saasbench -- <action>`。

这一层只负责「基准环境 + 执行 + 冻结 + 官方评分」，不含任何管理策略。
策略通过 `runAdapter` 的 `policy` 参数注入，当前只实现 Single。

## 命令

```powershell
# judge 凭据：环境变量或 git-ignored 的 .env 任选其一（见下）
$env:LLM_API_KEY = "..."      # 本会话有效；不要写进仓库

# 20 分钟 Single smoke（本里程碑要跑的那一次）
npm run saasbench -- run --smoke

# 完整 Single run（默认 180 分钟）
npm run saasbench -- run --full

# 只准备环境，不调用模型（干跑 / 排障；结束时会停掉模型 transport）
npm run saasbench -- run --prepare-only

# 查看将发送给 worker 的完整 prompt 与输入哈希（无副作用）
npm run saasbench -- prompt

# 对已冻结的运行重跑官方评分（不会再次启动模型）
npm run saasbench -- evaluate experiments/saasbench/task_kmasmnil/<run-id>

# 查看某次运行的 lifecycle / worker / 分数
npm run saasbench -- status experiments/saasbench/task_kmasmnil/<run-id>
```

`--minutes N` 可显式指定 worker 墙钟预算；`--config <file>` 覆盖机器相关路径。

### judge 凭据

评测进程继承固定的实验配置：`LLM_API_BASE=https://api.deepseek.com`、
`LLM_MODEL=deepseek-flash`，密钥按以下顺序解析：

1. 进程环境变量 `LLM_API_KEY`；
2. 项目根目录的 `.env`（已在 `.gitignore`，只在本地读取，不会被写入任何产物）。

两者都没有时，`run` 会在**消耗 worker 预算之前**直接失败。密钥从不写入
manifest、日志、JSON 证据或落盘的命令字符串；评测进程通过 stdin 接收它。

DeepSeek 端点在 WSL 中可直连（返回 401 即表示可达），无需走出口代理。


## 机器相关配置

默认值写在 `defaultSaasBenchConfig()`，均可在 config 文件中覆盖：

| 字段 | 本机值 |
|---|---|
| `repository` | `/home/zaixi/benchmarks/SaaSBench`（WSL 路径） |
| `codex` | `~/.cache/proactive-pb-tools/package/vendor/x86_64-unknown-linux-musl/bin/codex` |
| `auth` | `~/.codex/auth.json`（**只被宿主 transport 读取**） |
| `python` | `~/benchmarks/SaaSBench/eval/.venv/bin/python`（含 requests/playwright/openai/psycopg2） |
| `egressProxy` | `http://172.21.112.1:7897`（WSL 直连模型服务不可用，仅 transport 使用） |

Legion 本体跑在 Windows（Node），所有 Linux 侧动作经 `wsl.exe -d Ubuntu-24.04`。

## 执行模型

worker 就是 Legion 原有的 Codex CLI 与登录，只是在**任务容器内**执行：

```
宿主 WSL ── setsid model_proxy.py（监听 docker 网关 :8099，持有真实凭证）
                ▲
                │ 仅放行 /backend-api/codex/*，其余路径 403
   xm_app 容器 ─┴─ /opt/agent-bin/codex exec（占位 auth.json，无真实 key）
                    └ /app = docker/workspace（bind mount，模型写的一切都落在宿主工作区）
```

- `prepare()` 调用官方 `prepare_workspace.sh`，随后**失败即停**地校验：容器在运行、
  `/app` 为空、任务端口无监听、基准仓库**没有**被挂进容器。
- 容器内只额外放入 Codex 二进制、`stop.sh`（冻结助手）与占位 `auth.json`。
- worker 只收到一份冻结的 prompt，通过 stdin 传入，全程不接收任何评测反馈。
- Single：`maxAttempts=1`、`concurrency=1`、无 Manager、无 subagent、无第二次调用。
  决策函数固定返回 `stop`，验收只看冻结后的官方评测。

## 污染边界

| 可能泄漏的东西 | 处理 |
|---|---|
| 评测器（`check/task_kmasmnil_e/`、`dag.json`、`scoring_config.json`） | 不在容器挂载内，worker 结构上不可达 |
| 官方 prompt 的 operator 部分（Tester Workflow） | 构建 prompt 时只取 `## Prompt` 段 |
| 隐藏分数回流 | 评分只在 `FROZEN` 之后、worker 进程已终止时进行 |
| 联网抓取参考实现 | Codex 内置 `web_search`/`browser_use` 等全部禁用；prompt 保留官方 anti-cheat 声明 |
| 上一轮/其他 arm 的轨迹 | 每次运行独立目录，只读公开输入 |

`assertNoEvaluatorLeak()` 会在发送前拒绝任何包含评测器字样的 prompt。

## 谜与密钥

- `LLM_API_KEY` 由 `runEvaluation()` 从宿主环境读取，**经 stdin** 传给评测进程，
  因此不会出现在任何落盘的命令字符串里。
- 评测进程的 stdout/stderr 与 `evaluation.json` 在写入后统一用 `redact()` 清洗；
  日志中不会留下真实 key。
- 容器内只有占位凭证，真实 ChatGPT 登录只被宿主 `model_proxy.py` 读取。
- 不要提交 `experiments/`（已在 `.gitignore`）。

## 冻结不变式

```
RUNNING → FROZEN → EVALUATING → COMPLETE
```

- 状态机在 `lifecycle.json`，非法跳转（如 `RUNNING → EVALUATING`）被拒绝。
- 进入 `FROZEN` 之前必须完成：终止容器内 worker 进程树 → 确认没有残留 →
  重算工作区摘要（与 `submission.json` 一致）→ 写 `workspace-manifest.json` → 打包快照。
- `stop.sh` 杀掉 worker 进程树时会**保护**监听业务端口 8024 的进程，使被测应用继续服务。
- `grade()` 先断言状态为 `FROZEN`，再比较评测前后工作区摘要；评测期间工作区发生变化即判失败。
- 基础设施失败（Codex 崩溃等）不会被重试，也不会被评分，运行以 `incomplete` / `error` 结束。

## 用量

`usage.json` 优先取 Codex JSONL 的 `turn.completed`，缺失时回退到会话 trace 里
最后一条 `token_count` 累计值。两者都没有时记录为 `{"known": false, "total": null}`，
**不会**写成 0。

smoke 的 200k token 目标只是观测项：Codex CLI 没有可用的硬预算开关，
用法只能在回合结束时观测，因此**不宣称强制执行**。

## 产物

```
experiments/saasbench/task_kmasmnil/<run-id>/
  manifest.json            运行配置、git SHA、模型、预算、错误
  prompt.txt               发给 worker 的逐字节 prompt
  lifecycle.json           RUNNING → FROZEN → EVALUATING → COMPLETE
  execution.json           适配器状态（preparing/running/grading/evaluated）
  usage.json               token 用量（未知即 unknown）
  trajectory.jsonl         legion-team 事件 + codex 原始 JSONL
  submission.json          collect() 时的提交描述与摘要
  workspace-manifest.json  冻结时的工作区摘要/文件数/进程清理结果
  workspace-snapshot.tar.gz 源码快照（排除 node_modules/.next/.turbo 等）
  evaluation.json          官方评测原始产物（不加工）
  evaluation-summary.json  Legion 归一化摘要（分类、确定性/LLM 拆分）
  prepare.json / agent-transport.log
  logs/<nn>-<step>/        每个 WSL 步骤的 script.sh + stdout.jsonl + stderr.log
  logs/codex-home/sessions Codex 会话 trace
  adapter/                 本次固定的 stop.sh / model_proxy.py / 占位 auth
  team/                    调度器证据（route、attempt、check、事件）
```

`evaluation.json` 是官方结果，`evaluation-summary.json` 只是它的只读归纳，
不改变评分语义、不丢弃节点。

## 限制

- 只有 one task、one policy；Best-of-N、静态多 Agent、Legion 动态策略尚未实现。
- 容器内 `ss` 缺失，端口占用检测改用 `/proc/net/tcp`；官方脚本自身的 `ss` 检查会静默跳过。
- 工作区快照排除依赖与构建缓存，因此不是可独立运行的归档，只是证据。
- 20 分钟 smoke 的评测阶段不计入该 20 分钟预算，评测另有时限（默认 90 分钟）。
- worker 与评测共用宿主机网络；评测依赖 `localhost:8024` 等已发布端口。
