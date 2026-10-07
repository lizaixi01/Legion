已完成一个候选，状态为 **pending device validation**。仅修改 [kernel.asc](/D:/Projects/Legion-reviewer-fix/docs/experiments/cann-native-pilot-20261007/weight-prefetch/candidate/kernel.asc:281)。

已应用 `cann-single-hypothesis` Skill，并读取指定基线、历史报告及 r02/r03 review。没有重做 r02 reciprocal-Muls。

单一假设：未缓存 gamma/bias 的同步加载可能造成等待。在 `WriteRow` 中使用 `prefetchInput_ && !cacheWeights_ && !cacheNativeWeights_` 门槛，先装入第一对权重；每次取出当前 tile 后，在转换和计算前排入下一 tile。复用 r03 已分配的两个物理输入缓冲，没有增加 UB。

适用范围由本地源码模型确认：

| 元素类型／每核行数 | 权重预取范围 |
|---|---|
| FP32，至少一行 | `8193 ≤ D ≤ 28672` |
| FP16/BF16，每核一行 | `8193 ≤ D ≤ 32768` |
| FP16/BF16，每核至少两行 | `16385 ≤ D ≤ 32768` |

已执行检查：

- 初始候选与 r03 SHA、字节完全一致。
- 修改后仅 `WriteRow` 改变；缓存分支、权重转换和释放后的完整算术／NaN／Inf／输出后缀逐字节一致。
- `InitBuffer`、`ComputeRowSum`、缓存门槛、ABI、launch 分配及其余源码逐字节一致；8 个 scaffold 文件不变。
- 穷举 `D=1..32768`、元素宽度 2/4 字节、每核行数 1/2，共 **131,072 配置、196,608 行、3,248,128 次成对加载**。
- 模型确认：最多两个活跃输入缓冲、一个入队条目；当前张量转换及原有 `PIPE_V` barrier 后才释放；下一次分配不复用当前张量；各阶段和每行结束时队列为空。
- 所有有效读取、尾块 `ValidCount`、32 字节填充均在模型边界内；源码分配峰值仍为 **180,576 字节**。

这些是源码与队列事件模型检查，不是 Ascend 编译、设备正确性或性能证明。未调用平台、网络或 evaluator precheck。实际同步、编译兼容性、搬运计算重叠和收益仍未知；180,576 字节并非实测设备容量。

回退规则：继续保留 r03；未来仅当此精确 SHA 的完整设备结果达到 **15/15 Pass 且官方分数高于 28.87** 才考虑替换。编译或正确性失败淘汰；分数不升不替换；基础设施失败记 inconclusive。

候选 SHA256：`5e14d05892324619412bf50352b851cf5cea8a0d9e09a7e3a94b944f0de8e01b`  
大小：19,729 bytes。模型运行 15.488 秒；从首次基线读取完成至最终检查为 248.455 秒，结束时间 `2026-10-07T06:55:03.127660Z`。未生成报告或其他文件。
