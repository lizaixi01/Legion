# CANN 历史运行与 Codex 策略实验审计

审计日期：2026-10-07。结论：现有材料可以比较五份已绑定源码的 AddRmsNormBias 平台结果，不能证明 GPT6-Pro、单 Codex 或 Legion 多 Agent 谁更优。五份结果均为 Pass、15/15；最高的已观测官方分数为 input-prefetch-r03 的 28.87。所谓“GPT-6Pro 基线”只找到了事后图表命名，原始生成模型仍为**未知**。

本轮只读取历史文件、核对原始响应和重新计算，新增本报告及 [cann-runs.jsonl](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-runs.jsonl)。没有启动优化、模型评审、CANN 平台查询或提交。官方 Codex 文档查询仅用于核实扩展能力。没有提交 Git commit。

**审计边界与证据入口**

定位时工作目录 `D:/新建文件夹` 为空；实际命中两个指定入口的活动 Legion checkout 是 `D:/Projects/Legion-reviewer-fix`，HEAD 为 `0eff3ac93888c7afb628d00b02bd1b4f8ad2b55e`。它与 `D:/Projects/Proactive Agent` 的历史运行目录是不同 checkout，不能把前者的修复追认到后者的旧运行。

| 证据 | 路径与用途 |
| --- | --- |
| 指定入口 | [cann-capture.json](D:/Projects/Legion-reviewer-fix/scripts/reviewer/cann-capture.json)、[delivery-capture-regression.md](D:/Projects/Legion-reviewer-fix/docs/delivery-capture-regression.md)：定位 CANN 项目、旧交付失败和修复后的捕获记录 |
| 原始基线 | [v2-baseline](D:/Projects/CANN-AddRmsNormBias/results/evaluator/runs/v2-baseline)：baseline/report、源码快照、平台原始响应 |
| 第一轮 | [实验记录](D:/Projects/CANN-AddRmsNormBias/results/experiments/iter1-cache8192)、[评测归档](D:/Projects/CANN-AddRmsNormBias/results/evaluator/runs/iter1-cache8192-20261004) |
| 后续三轮 | [sequential-adaptive-20261004](D:/Projects/CANN-AddRmsNormBias/results/experiments/sequential-adaptive-20261004)、[evaluator/runs](D:/Projects/CANN-AddRmsNormBias/results/evaluator/runs) |
| 计数与授权 | [ledger.json](D:/Projects/CANN-AddRmsNormBias/results/evaluator/ledger.json)、[预算扩展 000001](D:/Projects/CANN-AddRmsNormBias/results/evaluator/budget-extensions/000001.json)、[evaluation_queue](D:/Projects/CANN-AddRmsNormBias/evaluation_queue) |
| 平台规则缓存 | [problem.json](D:/Projects/CANN-AddRmsNormBias/results/baseline/sdk-inspection-20261004/problem.json)：题目 ID、CANN 9.0.0、计分公式；各 run 的 time-unit 文件说明 μs 单位 |
| 原始 Codex | [单 Codex session](C:/Users/HUAWEI/.codex/sessions/2026/10/04/rollout-2026-10-04T12-23-37-01a10527-33ff-7fc3-8eee-682e27b1cae1.jsonl)、[早期 Legion session](C:/Users/HUAWEI/.codex/sessions/2026/10/04/rollout-2026-10-04T12-25-26-01a10528-d83a-7563-af47-aa2db7616d0d.jsonl) |
| GPT-6Pro 标签来源 | [图表生成 session](C:/Users/HUAWEI/.codex/sessions/2026/10/04/rollout-2026-10-04T21-32-57-01a1071e-20f9-79b3-8210-1a4318d12bb2.jsonl)，第 167 行用户指定名称，第 187 行绘图代码将名称绑定到 v2 |
| 外部对话 | ChatGPT [CANN](https://chatgpt.com/c/6ac1ec10-20b8-83a4-acb9-dc26802f4302)、[继续优化算子](https://chatgpt.com/c/6ac258d7-94fc-83a9-b6c9-80b808809d85)：可见片段证明存在人工转交报告与策略建议；接口未返回模型元数据 |

搜索覆盖上述项目的实验、评测、队列、相关 `.chats`、2026-10-04 的本机 Codex session 和 archived session，关键词包括 `GPT6-Pro`、`GPT-6-Pro`、`GPT-6Pro`、`Codex`、`CANN`、`AddRmsNormBias`。未将无关模型评审、工具开发或绘图任务算作 kernel 生成运行。

JSONL 共九条记录：一个导入平台基线、四次优化、两次早期单 Agent 实现、两次交付回归。逻辑运行可以跨多个 turn；登录恢复和同一次提交的多次轮询不是新优化运行。仅配置失败、未生成候选的 turn 附在相应运行的 `execution.preparation_turns` 中。未知字段使用字符串“未知”；确实不适用的角色明确写“不适用”。各条含原始路径；核心证据还保存了本轮读取时的 SHA256 与字节数。交付检查确认 JSONL 可逐行解析、九个 run ID 唯一、30 个本地 Markdown 引用存在，170 个读取并登记 hash 的源文件在检查前后未变；本轮没有运行旧报告中记载的构建、测试或平台评测。

**真实模型与初始条件**

模型取自原始 `invocation.json`、session `turn_context` 和 worker 结果的关联，而不是目录名、图表名或 reviewer 配置。表中名称为原始 model ID，不把它们换算成未经证明的商业模型名称。

| 逻辑记录 | 管理模型 / effort | 实际 kernel 执行模型 / effort | 执行器 | 起点、历史与人工参与 |
| --- | --- | --- | --- | --- |
| v2-baseline | 未知 | 未知 | 未知 | 已生成的 v2 被导入；生成前 SHA、可用历史、提示、人工改动均未知 |
| iter1-cache8192 | 无独立 manager；主 Agent 自己执行 | `gpt-6.1-sol` / xhigh | Legion Codex CLI 0.159.2 | v2 已 Pass 的源码与逐点结果；修改缓存阈值 4096→8192。人工登录、启动 watcher、恢复授权与 deadline |
| adaptive-r01-nativecache | `gpt-6.1-sol` / xhigh | `gpt-6.1-sol` / high，1 worker | 0.159.2 | cache8192、此前失败/恢复历史；已有原生 16 位 gamma/bias 缓存假设；人工追加预算并把 UI 容量设为 1 |
| adaptive-r02-reciprocal | `gpt-6.1-sol` / xhigh | `gpt-6-sol` / high，1 worker | 0.159.2 | r01 incumbent 及全部既有结果；用户转交 reciprocal 单变量方向，存在外部 ChatGPT 策略辅助 |
| adaptive-r03-input-prefetch | `gpt-6.1-sol` / xhigh | `gpt-6-sol` / high，1 worker | 0.159.2 | 仍从 r01 出发，同时已知 r02 回归；用户转交输入预取方向，存在外部 ChatGPT 策略辅助 |
| single-codex-cann | 无独立 manager | `gpt-6.1-sol` / xhigh，0 worker | Codex Desktop session 记录 0.160.0 | `D:/Projects/CANN` 原始实现；用户三次后续消息说明复制范围并反馈平台错误；起始 SHA 未知 |
| single-legion-playground | 无独立 manager | `gpt-6-sol` / xhigh，0 worker | Legion 0.159.2 | `D:/Playground` 原始实现；起始 SHA 未知，无可关联平台结果 |

两个容易混淆的“单 Agent”必须分开：`single-codex-cann` 是独立 Codex 从题目实现的历史记录；`iter1-cache8192` 是 Legion 在已通过 v2 上进行的一次小改动。两者任务难度、起始成果、执行器、历史反馈和提交方式都不同。

原始 Legion 对话定位如下。目录下的 `options.json` 说明配置，`invocation.json` 与 `stdout.jsonl` 说明实际执行，worker 的 `attempt-1` 保存独立回执：

| 记录 | 原始对话与关键 turn / task |
| --- | --- |
| iter1 | [chat 6ba08e2f](<D:/Projects/Proactive Agent/.chats/6ba08e2f-ca0e-4ec1-a1db-4eaee3c97e62>)；turn `06553907-37c5-4c85-a99b-b2f54eede320`、`152c5fc2-19db-46e1-8113-1f5b761844d2` |
| r01 | [chat 7321162f](<D:/Projects/Proactive Agent/.chats/7321162f-7e85-4e9f-81e9-018808ec1e14>)；turn `4a4154a0-4f7a-4537-be38-b80edbb1c03b`；worker `2ce101d0-833e-4952-8629-449ed73dc568` |
| r02 | [chat a5579ca6](D:/Projects/Legion-reviewer-fix/.chats/a5579ca6-4b99-4780-8882-3416d369db93)；turn `01841ea2-6c58-453d-af72-8d784ca5b602`；worker `a319948a-3fd7-49a0-990c-a6bf7e2557d5` |
| r03 | 同一 chat；turn `5b5af5e2-a700-4a7e-9a3a-8567b3098ee1`；worker `2207fa5a-3d3d-45f7-bf91-54761cb2a70f` |
| 早期 Legion | [chat b36e2011](<D:/Projects/Proactive Agent/.chats/b36e2011-c0a6-440d-be5c-b49adf8c0523>)；turn `04622651-e665-4598-a14d-0b86fa163c7c` |

外部 `CANN` 对话可见的转交上下文消息为用户 `78bb8ce9-eac0-47aa-b4f3-debf600121e3`、助手 `acc94b91-0dd4-4bb0-90a7-53a7c05889df`；后续对话从 `c1685747-f699-4f37-9ff9-6ff0fbc2084c` 可见先 reciprocal、再利用失败结果规划 pipeline 的过程。它们证明“有人工及外部上下文辅助”，不证明外部模型为 Pro。

**源码身份、时间和有效候选**

以下均为完整 SHA256，专指 `kernel.asc` 的字节。平台详情内八个 `files[].content` 的 UTF-8 hash 均与对应快照一致；第九个快照文件是本地 `.cannjudge-project.json` 元数据，不冒充第九个上传源码文件。

| 简称 / evaluator run ID | kernel SHA256 | 初始 kernel | 平台 submission ID / 数字 ID | 平台创建时间（UTC，2026-10-04） |
| --- | --- | --- | --- | --- |
| v2 / `v2-baseline` | `b53ee76504400d3f23f9205c182b217117b0960319538efcb8322a5ec49f2b5c` | 未知 | `6ac20d72694b590c3cb6f68f` / 586018 | 08:25:22.046 |
| cache8192 / `iter1-cache8192-20261004` | `c32ba10c924fd622ca60369a278cfbb4ae68857551c5ee1042a34aed7882b467` | v2 | `6ac234bf694b590c3cce5152` / 588547 | 11:13:03.745 |
| native16k-r01 / `adaptive-r01-nativecache-20261004` | `6864d67889f37b845a76e8b4ae066a595384ce213a9ba1a5675051db4bb939dc` | cache8192 | `6ac24360694b590c3cd7abee` / 589509 | 12:15:28.458 |
| reciprocal-r02 / `adaptive-r02-reciprocal-20261004` | `873f99517edbe3832707fde8253aa7b3b9d2256f56e2ab16e0917bd0e8f2faac` | native16k-r01 | `6ac25b2d694b590c3ce66b3c` / 591332 | 13:57:01.513 |
| input-prefetch-r03 / `adaptive-r03-input-prefetch-20261004` | `5a21645996e97e351c91aa66cb7169893a1c5401a52ea61ffc6923c7ae1f8d53` | native16k-r01 | `6ac2635c694b590c3cebe1d8` / 592055 | 14:31:56.236 |

r02 虽然正确性通过，但被判为性能回归；其**最终选留有效候选是 r01 的 SHA / submission ID**，不是 r02 的最后一次尝试。r03 也确实从 r01 而非 r02 出发。现存 [incumbent.json](D:/Projects/CANN-AddRmsNormBias/results/experiments/incumbent.json) 最终为 r03；轨迹没有支持“最佳候选丢失”的证据。

v2 的 evaluator 于 08:49:21 UTC 才创建，是导入已有提交，不能把这个时间当作 kernel 开始生成时间。后四轮的主执行时间依次为 09:19:19–09:30:53 与 10:40:41–10:48:42、12:02:06–12:32:49、13:38:06–14:08:11、14:10:46–14:41:59 UTC。第一轮生成结束之后仍经历跨 chat 的提交恢复；模型 turn 时间不等于端到端实验时间。JSONL 另外记录 receipt、evaluator、query 时间；平台与客户端时钟之间的小差异不用于推断严格先后。

两个早期实现不能补成有效基线：

- 单 Codex 从 04:23:38 至 05:23:37 UTC，四个有终态的 turn 合计 1,637,478 ms。平台[截图回执](C:/Users/HUAWEI/AppData/Local/Temp/codex-clipboard-f7dd21dc-3dd0-483f-833a-d14f485306b7.png)显示 AddRmsNormBias、数字 ID **583064**、`2026/10/04 13:19:39`、Compile Error、0/15。截图时区未标示，保留原样，不擅自转换。错误是 device 代码中运行时整数到 float 的转换；最后改到 host 侧后，没有找到账实对应的新平台回执。之前的[禁调试弹窗](C:/Users/HUAWEI/AppData/Local/Temp/codex-clipboard-62cf8eac-80cf-42f3-a533-1d1350cdee77.png)没有 ID，不能直接记为另一次平台接收。
- 早期 Legion 从 04:25:26 至 04:38:11 UTC，765,129 ms。本机缺 CANN 环境，另有 Python `ml_dtypes` 缺失，无 NPU 有效结果。当前 `D:/Playground/kernel.asc` 的 hash 为 `1f15f5931a2db0dcf1c306adc024bbb4bd15b39d960cde309b6b7e64cc1e9b09`；当前 `D:/Projects/CANN/kernel.asc` 为 `9b2aa67222b2cb9b384400424295fc5e66748b26725358b28a07a6a6253076ba`。这些是当前文件身份，不是已证实的起始版本、583064 上传版本或通过版本。

**逐点数据与重新计分**

题目固定为 `6a9a9a99bf41025d6013eb85`。以下五列每个点均为 Pass、`precision_ratio=1`；耗时单位 μs，越低越好。点号仅用于展示，连接始终使用完整 testcase ID（JSONL 保存全部）。除表内四位后缀外，ID 的共同前缀为 `6a9a9a99bf41025d6013`。

| 点 | ID 后缀 | v2 | cache8192 | native16k-r01 | reciprocal-r02 | input-prefetch-r03 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | eb8a | 5.30 | 5.46 | 4.99 | 5.73 | 6.09 |
| 2 | eb8e | 11.58 | 11.74 | 11.93 | 12.43 | 12.56 |
| 3 | eb92 | 6.67 | 6.70 | 6.43 | 7.00 | 6.47 |
| 4 | eb96 | 32.21 | 31.78 | 31.46 | 33.66 | 31.94 |
| 5 | eb9a | 21.74 | 20.52 | 20.23 | 21.57 | 15.24 |
| 6 | eb9e | 49.17 | 48.89 | 48.07 | 51.32 | 48.46 |
| 7 | eba2 | 74.94 | 75.40 | 73.47 | 78.31 | 75.13 |
| 8 | eba6 | 216.96 | 216.42 | 217.41 | 229.94 | 219.58 |
| 9 | ebaa | 119.44 | 116.40 | 114.21 | 125.95 | 117.67 |
| 10 | ebae | 192.91 | 189.04 | 194.52 | 206.81 | 195.80 |
| 11 | ebb2 | 235.32 | 228.50 | 228.18 | 231.85 | 192.20 |
| 12 | ebb6 | 179.06 | 175.31 | 175.85 | 185.64 | 144.82 |
| 13 | ebba | 721.80 | 721.16 | 714.80 | 735.25 | 617.12 |
| 14 | ebbe | 56316.68 | 56444.70 | 55942.06 | 63391.36 | 56601.08 |
| 15 | ebc2 | 14443.92 | 12842.92 | 12737.04 | 12574.07 | 11077.56 |

缓存题目规则规定全部 15 点精度通过才计分：`mean_i(100 / (1 + log_1.5(t_i / T_i)))`，其中 T 是最优性能，分数越高越好。官方总分必须从 `ranking.rows[]` 以 **submission_id 精确匹配**取得；详情中的 `theory_score=0` 和各点 `score=0` 不是官方总分。

各时刻的 T 有变化，例如第 6 点从 9.62→9.49→9.48，第 4 点后续到 4.12、4.05，第 14 点从 3596.01 到 3593.10、3588.84。因此直接对历史官方分数求百分比不等同于固定参照的性能改善。用每份原始响应自身的 T 重算，四舍五入均复现其官方总分。再统一使用 08:50:26.138801 UTC 的 `v2-baseline/baseline.json` 中 T，得到下表审计分数；它不是新官方分数。

固定 T（μs）为 `[1.26, 1.85, 2.47, 4.13, 5.2, 9.62, 11.02, 30.16, 67.79, 46.63, 126.8, 75.93, 392.72, 3596.01, 7948.23]`。

| 结果 | 官方总分 | 用当时 T 重算 | 用共同 T 重算 | 对实际父版本：更快 / 更慢点数 | 共同 T 分数变化 |
| --- | ---: | ---: | ---: | --- | ---: |
| v2 | 26.06 | 26.064652 | 26.064872 | 不适用 | 不适用 |
| cache8192 | 26.64 | 26.641057 | 26.650131 | 10 / 5 | +0.585259 |
| native16k-r01 | 26.89 | 26.890210 | 26.900127 | 11 / 4 | +0.249995 |
| reciprocal-r02 | 25.94 | 25.937681 | 25.949641 | 1 / 14 | −0.950486 |
| input-prefetch-r03 | 28.87 | 28.870796 | 28.891955 | 5 / 10 | +1.991829 |

r03 相对 r01 的第 5、11、12、13、15 点分别快 24.67%、15.77%、17.65%、13.67%、13.03%；其余十点均慢，第 1 点慢 22.04%。所以它是“本次计分目标更好”，不是“所有输入更快”。r02 第 14 点慢 13.32%，只有第 15 点快 1.28%，保留 r01 有数据依据。各点实际 shape、平台设备型号、频率/负载和重复测量分布未知；不能把点号擅自解释为某个确定形状，也不能给出稳定提速或显著性结论。

复核过程对每条完成了：report/state/receipt ID 关联、八个上传文件与快照字节 hash、15 点身份/精度/耗时、唯一排名行、单位文件 hash、两种 T 的公式重算。单位 JS 的 SHA256 为 `67be1324f8a86ee6aacb09ed656839aaebe512c5e2bdaf39adbc87e372476792`。保存的 evaluator hash 分别为 v2 的 `c5c4028c…`、iter1 的 `889b7f52…`、后三轮的 `cf5aa654…`；完整值在 JSONL。评测工具版本也不是五轮完全固定的。

**预算、实际提交与消耗**

提交按平台 ID 去重，不按 run 目录、等待次数或客户端返回码统计。目前可确认：五个绑定源码的成功平台 ID，其中 v2 是导入的历史提交，后四个是 evaluator 新提交。`ledger.attempted_submissions=4`，初始授权 1 次，11:46:45.790887 UTC 的预算扩展另加 4 次，累计授权 5、已用 4、剩余 1。`ledger.max_submissions=1` 是初始字段，不能忽略授权链而误报超预算。

`iter1-cache8192-realpost-20261004` 是 `iter1-cache8192-20261004` 的恢复别名，不是第六个成功提交。早期 `login_expired` 和 `submission_disabled` 确实记录了当时 0 次；后续授权明确映射到原 archive，receipt 与 ledger 均落在同一个 `6ac234bf…`。初始 deadline 是 09:55:18.684056 UTC，恢复授权改为 11:36:23.248687 UTC。两个时段必须一并保存，不能拿旧 failure summary 盖掉新成功回执。

加上单 Codex 的数字 ID 583064，至少观察到 **六个不同的平台接收记录**，其中一个编译失败。v2 形成之前还有多少尝试、583064 修复后是否再次提交，均未知；六个是现有证据下限，不能宣传为全历史总数。客户端超时本身也不能证明未提交，必须结合 receipt、ledger、原始平台记录对账。

| 记录 / 计量范围 | 主执行 token | 独立 worker token | 已确认主 turn 时长 | reviewer 另计 |
| --- | ---: | ---: | --- | --- |
| v2 原始生成 | 未知 | 未知 | 未知 | 未知 |
| iter1 两个主 turn | 3,092,829 | 0 | 694,219 + 480,375 ms | 生成时关闭独立审查；后续回归另列 |
| r01 生成 turn | 3,945,884 | 479,960 | 1,842,125 ms | 两次超时，见下表 |
| r02 生成 turn | 5,744,116 | 505,793 | 1,805,208 ms | 一次超时 |
| r03 生成 turn | 3,761,426 | 421,120 | 1,873,555 ms | 一次超时 |
| 单 Codex 四个 turn | 4,327,689 | 0 | 1,637,478 ms | 无 Legion reviewer |
| 早期 Legion 一个 turn | 4,218,044 | 0 | 765,129 ms | 未运行 |
| 目录捕获回归的主 turn | 1,170,134 | 0 | 535,513 ms；其中 check 为 70 ms | 捕获失败，reviewer 未启动 |

token 是原始累计 input + output，包含 cached input；不是唯一上下文长度或可直接计费的美元成本。JSONL 保留 input/cached/output/reasoning 分项，reasoning 是 output 的子集，不能再相加。r02/r03 共用 session，已按 turn 增量扣除前值：r02 `6,610,799−866,683=5,744,116`；r03 `10,372,225−6,610,799=3,761,426`。不把 session 累计误算成每轮消耗。worker 时间嵌在主 turn 中，不能直接再加成墙钟时间。

r01 前另有两个容量关闭的 turn，分别耗 886,537 / 995,545 token，545,204 / 418,376 ms，均未生成或提交。预算扩展工具建设 turn 耗 2,390,793 token、1,054,301 ms；它是基础设施工作，不是 kernel 优化 token。iter1 的 bridge 建设/恢复、外部 ChatGPT、绘图与本审计同样不混入上表。原始生成 token 预算、完整跨 chat 端到端 token 与人工耗时均未知，不能据此算出各模式总成本排名。

**平台结果与 Legion 宿主完成状态分开**

| 记录 | 平台证据 | Legion / 执行宿主 |
| --- | --- | --- |
| v2 | Pass 15/15，26.06 | 导入前生成宿主未知；evaluator 查询 complete |
| iter1 | Pass 15/15，26.64 | 主 turn completed；历史交付 unverified，独立审查关闭 |
| r01 | Pass 15/15，26.89 | 主 turn completed；旧运行的 delivery **blocked**，两次 reviewer timeout |
| r02 | Pass 15/15，25.94；未选留 | 主 turn completed；delivery **unverified**，review **infrastructure_failure** |
| r03 | Pass 15/15，28.87；选留 | 主 turn completed；delivery **unverified**，review **infrastructure_failure** |
| 单 Codex | 583064 Compile Error；修复后未知 | 本地 task_complete；CPU 回归不能替代真实平台编译 |
| 早期 Legion | 未知 | 主 turn completed，delivery unverified，无 NPU 验证 |
| 目录捕获回归 | 保留 iter1 Pass，不是新结果 | **blocked_before_reviewer**；check 70 ms，没测试到 timeout 分支 |
| 显式文件捕获回归 | 保留同一 iter1 Pass | capture completed；delivery unverified，review infrastructure_failure |

旧目录回归在 [summary.json](D:/Projects/CANN-AddRmsNormBias/results/reviewer-infrastructure-regression-20261004-130703032/summary.json)；修复回归在 [cann-capture-20261004](<C:/Users/HUAWEI/.codex/worktrees/reviewer-infrastructure/Proactive Agent/.runs/cann-capture-20261004>)。前者三个输出实际是目录，命中 [challenge.ts](D:/Projects/Legion-reviewer-fix/src/challenge.ts:26) 的普通文件限制。后者选取 30 个具体文件，最大 2,031,481 字节，成功捕获。历史保存的 421 个源文件前后 hash 一致，未新提交。

修复回归的 `artifactHash=69aebfa1bba6cd94a9b56acf879b59e92009d4819b3f684a8e75f2f6ee75444c` 是交付包 hash，不是 iter1 kernel hash。r03 的交付包 hash `547014cba146ee347af0f0fc20578530e827ae8f628052423a47110a2109f1a6` 同理。当前 runtime 没有可信 CANN functional verifier；即便捕获成功、reviewer 完成，也不能自行把平台保留结果升级为宿主 accepted。

**哪些可以比较，哪些需要补证**

| 分类 | 对象与可支持的用途 | 不能推出的结论 |
| --- | --- | --- |
| 条件足够一致，可用于比较 | 五份源码绑定的平台结果：同题、同 15 个点、单位可核对、八个上传文件均可校验。可比较本次逐点耗时与共同 T 分数；候选演进链可用于判断当次 keep/replace | 不包含同输入、同历史、同预算的端到端策略对照；没有任何一对完整运行满足模型/策略因果比较条件 |
| 条件不一致，但可用于失败分析或流程回归 | iter1、r01、r02、r03 的完整运行；早期单 Codex 与早期 Legion；两次捕获回归。可分析容量、登录、人工接力、证据捕获、失败候选保留和 reviewer 超时 | 不可用 26.06→26.64→26.89 的顺序增长证明 Pro→单 Agent→多 Agent 的优劣；r01 与 r02 的 worker 模型都不同 |
| 证据不足，需要补找原始材料 | v2 原始生成身份、起点与成本；583064 的上传源码和修复后结果；原始平台总尝试次数 | 不能把缺失记为 0、失败或默认 Pro，也不能把当前文件补作历史版本 |

JSONL 的主 `classification.bucket` 按完整运行分类；`kernel_result_bucket` 单独表示其中平台结果可用，避免把“结果可比较”误读成“策略实验可比较”。两次交付回归也有不同 runtime/输出清单，只支持捕获修复的有限结论，不是纯 reviewer 性能 A/B。

已通过现有文件补齐的问题包括：realpost 别名、全部五个原始 score 来源、单位、逐点时间、source identity、轮次父版本、预算扩展链、实际 worker 模型、r02/r03 累计 token 的去重。旧实验综述及三柱图只到 r01，不能代替最新 r02/r03 原始记录。

还需找的原始材料及当前缺口：

- v2：最初生成对话的早期消息、消息级实际模型/effort、生成前后文件和提交关联。当前 ChatGPT `read_thread` 对 CANN 只返回最新五段；请求十段仍只有五段并报无下一页，未给模型字段。浏览器尝试未能取得早期内容。因此本轮可访问材料不能补齐 Pro 身份。后来的 evaluator 建设 session `01a1060b-2403-75c0-9661-f5b63201f3e4` 只是导入用户提供的 SHA/ID，不是 v2 作者。
- 单 Codex：583064 对应的完整上传源码/opaque submission ID、host-cast 修复后的平台回执，以及如有保存的初始文件快照。现有日志证明修改及人工反馈，当前文件不能证明这些缺失身份。
- 公平成本或稳定性能：需要原运行完整跨 chat 计量和重复测量/平台环境记录。现有点值能重新计分，不能从单点值重建方差或人工耗时。

优先补原始导出/回执，不建议为了“补历史”重跑：重跑无法恢复旧模型身份、旧人工参与或旧 token。只有将来另立“稳定提速/策略因果”目标，才需要新的受控实验。本报告下一条实验仅检验可复现的流程损失。

**当前仍存在的可度量损失**

选中的损失是：**在冻结交付清单前没有检查验收所需的原始证据是否都被纳入，已有证据留在项目里，却无法被只读 reviewer 使用。**

原目录捕获已修复，但该问题在最新 r03 仍出现：[manifest.json](D:/Projects/Legion-reviewer-fix/.chats/a5579ca6-4b99-4780-8882-3416d369db93/turns/5b5af5e2-a700-4a7e-9a3a-8567b3098ee1/delivery/version-1/snapshot/manifest.json) 只有 `pipeline-analysis.json`、`hypothesis.json`、`experiment.json`、`report.md`、`incumbent.json` 五个摘要文件。缺少实际 kernel、父 kernel、diff、worker/manager 回执、官方 report/raw submission/ranking、单位证据与 bridge/ledger 记录。这些文件本机已经存在。r02 也只冻结八个文件，其中虽有 candidate kernel，但缺少官方原始结果与父版本证据。

r03 reviewer 明确指出上述缺失，但最终仍超时；这证明检查被缺证阻塞并消耗时间，**不证明缺证是超时的唯一原因**。完整显式文件回归也曾超时，故不能承诺补齐就解决 reviewer 终态问题。

| reviewer 实例 | 时长 ms | 超时前可确认累计 token 下限 |
| --- | ---: | ---: |
| r01 version-1 | 180,896 | 400,546 |
| r01 version-2 | 181,706 | 458,957 |
| r02 version-1 | 181,053 | 109,575 |
| r03 version-1 | 181,212 | 138,695 |
| 显式文件捕获回归 | 182,205 | 129,964 |
| 合计 | 907,072 | 1,237,737 |

这些 reviewer 均为 `gpt-6.1-sol` / xhigh、CLI 0.159.2，独立于 kernel 执行模型。`usage.json` 的终态 usage 是 null，但原始 rollout 有 token_count，所以只能记为“完整用量未知、至少以上数值”，不能算 0。当前 [reviewerPrompt](D:/Projects/Legion-reviewer-fix/src/primary-delivery.ts:23) 已要求 manifest-first、限定读取范围和及时返回 JSON；仅再次增加这句泛化提示不是新的有效干预。

**最轻实现方式与当前 Codex 能力**

先核实本机，而不是根据最新产品名称推测：审计时 PATH 的 `C:/Users/HUAWEI/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe --version` 为 **0.154.0**；Legion 实际调用的 `D:/Projects/Legion-reviewer-fix/.local/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe --version` 为 **0.159.2**。两者 `features list` 均显示 hooks、plugins stable/true。历史 Desktop session 的 0.160.0 是另一条证据，不能当作当前 PATH 版本；缓存的 `version.json` latest 字段也不能当作已安装版本。

| 依次判断 | 核实与适配结果 | 本轮选择 |
| --- | --- | --- |
| Hook | 本地 feature 已启用；官方文档有 SessionStart、PreToolUse/PostToolUse、上下文注入和阻断机制，但部分工具路径可能不覆盖。[Hooks](https://learn.chatgpt.com/docs/hooks)。Legion 在 [codex-app-server.ts](D:/Projects/Legion-reviewer-fix/src/codex-app-server.ts:113) 注册 `dynamicTools`；尚未验证它的自定义调用是否进入这些 hook。`prepare` 时文件可能尚未生成，`check` 不携带输出清单，届时 contract 已冻结 | 不选作第一步；不是说 Codex 不支持 Hook，而是本问题需要先规划语义证据清单，直接拦截还依赖未核实的路由 |
| Skill | 本地存在可读取的 SKILL.md，历史执行也实际读取过技能；指令与资源可以指导工作流。[Skills](https://developers.openai.com/plugins/concepts/skills)。不需要额外外部系统 | **选择：显式调用一个“交付证据清单”Skill，在 prepare 前规划，在 check 前只读核对** |
| MCP | CLI help 暴露 mcp 管理能力；现有原始材料均在本机，shell/文件读取已足够 | 暂不增加服务器、认证或工具接口 |
| Plugin | CLI 已支持且 feature 启用；插件可以打包技能/工具。[Plugin architecture](https://developers.openai.com/plugins/concepts/plugins) | 暂无分发需求，打包比单个 Skill 更重 |
| Mode | 原始 session 有 default/plan 的 collaboration mode 元数据；本地 help 有 profile/model/config，但未核实可任意注册新产品 Mode | 不把配置 profile 宣称为新 Mode；此问题不需增加全局工作模式 |
| Harness / 产品 | [primary-delivery.ts](D:/Projects/Legion-reviewer-fix/src/primary-delivery.ts:18) 已有不可变 prepare、最多三次 check；[challenge.ts](D:/Projects/Legion-reviewer-fix/src/challenge.ts:26) 要求 1–30 个具体文件、每个≤4 MiB。产品级预检可更强，但需改协议/测试 | 等 Skill 的离线结果证明价值后再考虑，不先改宿主验收或接管提交 |

该 Skill 的范围只有：按验收条目列出证据依赖，选择现有原始文件与必要的父版本，记录 SHA/ID/引用关系，保留未知，检查普通文件/数量/大小，复核通过才请求冻结。缺证时列明具体缺口，不生成替代回执、不改验收要求、不发起平台提交。它施加在交付主 Agent 上；不依赖 reviewer 去加载技能，也不改变可信 verifier 边界。本轮没有安装或实施该 Skill。

**唯一下一轮实验定义：离线配对的交付清单实验**

> 由于观察到 r03 交付只冻结五个摘要文件、遗漏本机已有的原始证据，修改主 Codex 在 `prepare` 前的工作流，显式调用“交付证据清单”Skill，预计减少首次交付缺证和人工补交次数；固定 r03 历史材料、验收条件、模型/effort/执行器及预算，用首次证据覆盖率、修复次数和 token/耗时判断，出现虚假核验、证据变更或无收益的成本上升时回退。

这是下一轮的方案，尚未执行。最小单位是**同一个历史 r03 交付任务的一对新会话 A/B**，不包含 kernel 生成、真实平台评测或 reviewer 模型运行：

- **输入与对照固定：** 从 r03 的归档构建同一份只读 fixture，固定上述 SHA 与 submission ID、r01 父版本、r02 已否决结果、原验收文字、worker/manager 记录、提交时的 ledger-before/after 和 budget-before/after。恢复到“新的历史交付任务尚未 prepare”状态，而不是试图修改已冻结 contract。两组获得相同材料与路径索引，均可读取全部原始证据，不向 B 单独提供答案或新事实。
- **唯一变量：** A 使用当前交付提示；B 增加一个显式调用的 Skill，要求在冻结前建立“验收条目→文件→SHA/ID”清单并预检。Skill 不写死本次提交 ID 或正确输出文件列表。两组均只输出拟定 contract、证据索引和预检结果到各自空目录，不能调用真实 `legion_delivery`、evaluator、bridge 或网络。
- **执行条件：** 两个全新、互不共享上下文的单 Codex 会话，0 worker；固定 Legion 的 CLI 0.159.2、`gpt-6.1-sol`、xhigh、相同权限与工具；每组最多 10 分钟和 500,000 个报告 input+output token，达到任一上限终止并记未完成。用外部驱动记录消耗并停止，不假设 Codex 有尚未核实的原生 token-budget 开关。A/B 顺序在开始前随机确定并记录；模型采样仍可能变化，一对只用于可行性，不提供统计显著性。
- **同一个离线判据：** 由确定性文件/JSON/hash 检查核对五类原始证据是否闭合：①候选源码与实际 submission 源码/receipt 绑定；②完整 15 点正确性和耗时；③按 ID 匹配的官方分数、T 和单位；④父版本源码、历史结果与 keep/replace 依据；⑤本轮实际提交计数、授权以及执行回执。只看文件名或摘要里的自述不得算覆盖。另检查无目录输出、≤30 文件、单文件≤4 MiB、无路径逃逸/失效引用，fixture 字节不变。两组使用完全相同的判据。
- **指标与通过标准：** 主指标为首次输出已闭合类别数/5、缺失原始证据条目数和人工补交轮数。B 必须首次达到 5/5、零虚假验证、零人工补交；相对 A 的缺证数必须下降，否则记“未证明收益”。记录主模型 input/cached/output/reasoning、墙钟时长、工具调用数；B 的总 token 不得比 A 高超过 20%。A 因预算用尽未完成时，同时报告这一事实，不把截断成本当成完整成功成本。
- **回退：** B 改写任何 fixture、伪造 SHA/receipt、把 missing 或 retained 说成 host accepted、越过文件限制、需要人工补事实，或 token 增长超过 20%，则不推广并移除 Skill 干预，保留全部 A/B 输出分析失败。两组都满覆盖则保持现状，不据此建设 MCP/Plugin/Harness。reviewer 的 181 秒是历史背景，不是这一实验的预期节省量；若将来检验 reviewer 终态改善，必须另行做固定 reviewer 的实验。

本机所有需要的 r03 原始文件已经存在，因此这一实验不需要重跑平台，也不依赖补齐 Pro 身份。历史“目录捕获失败”和“当前未纳入关键证据”是不同阶段的问题，此实验只检验后者。

**最终回答**

现有证据支持：五份已通过源码的当次性能比较；r03 在固定参考时间下分数最高，但十个点较 r01 更慢；r02 回归后正确保留 r01；四次新 evaluator 提交及其授权可对账；平台通过和宿主未完成可以同时成立。

现有证据不支持：v2 确由 GPT6-Pro 生成、Pro 与单 Codex 的公平胜负、多 Agent 的因果收益、全历史总成本/总提交次数，或稳定提速幅度。

下一步最值得改的一件事：**让交付主 Codex 在冻结 contract 前检查并纳入已有原始证据。先做上述一对离线 Skill 实验，以首次证据完整度决定是否推广。**
