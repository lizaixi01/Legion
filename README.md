# Proactive Agent

本地 Agent 管理系统：驱动 Codex 执行任务，管理多个 sub agent 分工协作，用外部检查决定继续、修复还是停止，并保留全部证据。

## 快速开始

```sh
npm ci
npm run desktop
```

桌面应用是主入口（独立窗口，无需浏览器）。只用命令行也可以：

```sh
npm start -- --help     # CLI
npm run demo            # 端到端演示，不调用模型，不花额度
npm test                # 行为测试
```

## 它做什么

- **管理多个 Agent**：一个 Manager 负责规划与决策，按需分配多个 Worker 并行执行；失败时恢复原会话修复、切换路线或停止，全部受调用次数与时间上限约束。
- **外部验收**：结果由独立检查器判定，不采信模型自评；通过检查的产物才被接受，未覆盖的检查项如实标为 not_checked。
- **证据完整**：每次执行的 prompt、日志、产物哈希与管理决策都写入 `.runs/`，可回放、可复查。
- **两个界面**：Electron 桌面应用（聊天 / 任务计划 / 运行记录）与 CLI，共用同一套管理器。

## 环境要求

- Node.js 22+
- 真实执行需要本机可用的 Codex CLI 登录；沿用现有登录，不额外配置 API Key。

## 文档

- [当前开发状态](docs/implementation-status.md)
- [对照协议](docs/hwe-comparison-protocol.md)
- [ProgramBench 单题执行](docs/programbench.md)
