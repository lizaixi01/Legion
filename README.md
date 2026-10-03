# Legion

本地 Agent 管理系统：驱动 Codex 执行任务，管理多个 sub agent 分工协作，外部检查验收，全程留证据。

## 安装（Windows）

从 [Releases](https://github.com/lizaixi01/Legion/releases/latest) 下载 `Legion-Setup-*.exe` 并运行。

- 安装时可勾选**是否创建桌面快捷方式**，完成后可勾选**是否立即运行**。
- 卸载不会删除 `%APPDATA%\Legion`，会话与运行记录保留。

也可以从源码运行：

```sh
npm ci
npm link      # 让 legion 命令可用
legion        # 打开桌面应用
```

## 启动

双击桌面 **Legion** 图标，或在命令行输入 `legion`。

```
legion                打开桌面应用
legion run <config>   运行受管理的任务
legion status <run>   查看运行状态
legion demo           端到端演示（不调用模型）
legion --help         全部用法
```

## 它是怎么工作的

1. **你给目标** —— 在桌面应用里直接说要做的事，或选一个工程目录交给它。
2. **Manager 拆解** —— 一个 Manager 负责规划，把任务分给多个 Worker（子 Agent），可并行执行。
3. **外部检查验收** —— 结果由独立检查器判定，不采信模型自评；失败就恢复原会话修复、换路线或停止。
4. **证据留痕** —— 每次执行的 prompt、日志、产物哈希与决策都写入 `.runs/`，可回放复查。

## 环境要求

- Node.js 22+（安装电脑默认使用系统 Node；未安装时回退到应用内置运行时）
- 真实执行需要本机可用的 Codex CLI 登录；沿用现有登录，不额外配置 API Key。

## 实验结果

[HWE 实验总结与图表（2026-10-03）](docs/hwe-experiment-summary-20261003.md)：深度搜索最终达到 baseline 的 2.99×，历史配对的并行验证加速 1.59×；管理策略 A 的中断恢复结果仅用于探索，A/B 尚不能公平判胜。报告附关键数据和比较限制。

## 开发

```sh
npm ci
npm run desktop     # 开发态启动
npm test            # 行为测试
npm run dist        # 构建 Windows 安装包到 dist-release/
```

### 可恢复工程任务

桌面新聊天中选择项目并开启“工程任务”，审核 Manager 提出的需求与测试后执行。安全暂停后可在原任务恢复；旧版本记录仅供查看历史。运行离线恢复演示：`npm run demo:resume`（不调用模型）。CLI、预算、验收与恢复限制见 [恢复设计说明](docs/resumable-engineering.md)。

### Codex runtime for local Legion

Run `npm run runtime:install` before starting a fresh development or experiment checkout. This installs the pinned Codex CLI **0.159.2** under `.local/codex-runtime`. Primary sessions, engineering tasks, workers and capacity probes use that project runtime, not the CLI found on PATH. Include the runtime in an experiment snapshot and record its version; do not upgrade a frozen experiment in place. The separate legacy Linux benchmark harness has its own runtime configuration.
