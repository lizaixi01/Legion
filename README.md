# Legion

本地 Agent 管理系统：驱动 Codex 执行任务，管理多个 sub agent 分工协作，外部检查验收，全程留证据。

## 快速开始

```sh
npm ci
npm link      # 让 legion 命令可用，只需一次
legion        # 打开桌面应用
```

没有全局命令时用 `npm run desktop`。

## 它是怎么工作的

1. **你给目标** —— 在桌面应用里直接说要做的事，或选一个工程目录交给它。
2. **Manager 拆解** —— 一个 Manager 负责规划，把任务分给多个 Worker（子 Agent），可并行执行。
3. **外部检查验收** —— 结果由独立检查器判定，不采信模型自评；失败就恢复原会话修复、换路线或停止。
4. **证据留痕** —— 每次执行的 prompt、日志、产物哈希与决策都写入 `.runs/`，可回放复查。

## 命令行

```
legion                打开桌面应用
legion run <config>   运行受管理的任务
legion status <run>   查看运行状态
legion demo           端到端演示（不调用模型）
legion --help         全部用法
```

## 环境要求

- Node.js 22+
- 真实执行需要本机可用的 Codex CLI 登录；沿用现有登录，不额外配置 API Key。
