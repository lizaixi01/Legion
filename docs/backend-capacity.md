# 双后端容量测试（2026-09-29）

## 结果

测试为独立随机字符串回复，严格核对答案，禁用工具及嵌套代理；每档计划三轮，1/2/4/8/16/32/64，混合从2开始、两后端各半。任一失败停止该模式升档，不自动重试任务。

| 模式 | 完整通过三轮的最高档 | 64档结果 | 64档p50/p95 |
|---|---:|---|---|
| Codex Sol/medium | 64 | 192/192正确 | 28.5/38.5秒 |
| Command Code DeepSeek-v4.1-flash/high | 32 | 第一轮64/64，第二轮63/64，停止 | 20.0/21.4秒 |
| 混合：各32 | 合计64 | 192/192正确 | 17.8/22.1秒 |

这是短请求客户端会话容量，不能宣称长工程任务稳定性或服务端同时生成数量。未测得模型服务的真正上限。默认GUI并发仍为2，可配置至64。

## 所有批次与失败

- `.capacity/probe-1790675477228`：Codex共381次成功。Command Code初始及mixed单请求因medium不受支持失败。Codex较低档位曾与下一诊断批次重叠；64档没有该重叠。
- `.capacity/probe-1790675580630`：仅诊断，与早期Codex测试重叠，不作独立容量证据。Command Code的`--effort`并发写全局config.json，4档发生EPERM rename。已改为启动前核对保存的effort，运行时省略写配置的参数。初始CLI调用将DeepSeek保存的effort设为high。
- `.capacity/probe-1790675924984`：Command Code在2档出现一次空输出退出，未保存退出码，原因未知；停止该模式。随后混合共378次正确，完整通过至64。
- `.capacity/probe-1790676315413`：增加execution.json后进行一次诊断复测，共317次、316成功。64第二轮一个进程exitCode=3221226505，无stdout/stderr和terminal result。32档三轮通过。无429证据，不能把异常解释为服务并发限制。

失败记录全部保留，不只选择成功批次。单次日志、用量和时长在各批次子目录。未报告token为未知，不按0计算；账户前后快照可能含其他使用，不等于精确实验账单。

## 实现边界

- worker-pool：统一总并发及分后端限额、排队、取消、认证/配额阻断、限流后减半及30秒冷却，无隐式重试。
- pool-service：独立只读子Agent队列，最多1000排队任务、64同时运行；独立目录和记录。尚未替换已有工程Master的实现Worker，HWE未改动。
- account-capacity：复用现有登录读取真实额度，GUI再次点击关闭。未知容量不会标成无限。
- Command Code使用附带CLI 1.69.0和`deepseek/deepseek-v4.1-flash`/high；不支持medium。Codex为`gpt-6-sol`/medium。
- 同一个Command Code模型目前要求使用一致的已保存effort；不支持各任务并发修改。配置不一致拒绝启动。Command Code独立工作目录不等于OS沙箱。
- 下一步先定位客户端异常，再测工具循环、长上下文和持续负载。短请求测试不能证明长期稳定上限。

## 使用及验证

在 `D:/Projects/Proactive Agent` 运行 `npm run desktop`，或使用桌面快捷方式。侧栏「账户容量」查看真实用量。目标输入旁的「子 Agent」提供关闭、LLM 动态决定、启用（默认 10 个名额）三种模式；任务与后端由 Manager 分配。手动队列入口仅保留为内部调试接口。

复现：`npx tsx src/capacity-cli.ts 64 commandcode,mixed`；汇总：`node scripts/capacity/report.mjs`。会消耗账户额度。

105项测试通过、typecheck/build通过。真实Electron账户面板已显示并截图；队列后端选择、64输入、再次点击关闭已验证；真实GUI混合提交2次均成功，证据在.pool/154d4ac9-bbb3-4643-85b4-fecbe99efef8。后台窗口的第一次点击检查因页面不可见超时，使用CDP焦点模拟后验证完成。

全部更改位于GUI副本，未合并或改动原实验目录`D:/Projects/Proactive Agent`。


## 记录到的用量（含诊断失败批次）

容量脚本共1100次调用尝试：Codex570次，reported input 8,553,783 / output 15,166 / cached 7,355,392；Command Code530次，reported input 4,009,576 / output 23,161 / cached 3,036,928，其中5次未返回用量。字段为后端原始报告口径，cached不再叠加到input；不换算账单。GUI端到端验证额外2次，独立保存在.pool目录。汇总见.capacity/usage-totals.json。
