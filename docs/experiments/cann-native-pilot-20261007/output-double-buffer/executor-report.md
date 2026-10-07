候选已完成，状态为 **source_checked_device_pending**。已应用 [cann-single-hypothesis 技能](D:/Projects/Legion-reviewer-fix/.agents/skills/cann-single-hypothesis/SKILL.md)，只写入指定的 [kernel.asc](D:/Projects/Legion-reviewer-fix/docs/experiments/cann-native-pilot-20261007/output-double-buffer/candidate/kernel.asc:105)，未创建报告或其他文件。

- **候选 SHA256：**`3e045351d864b301183ab896cd53b91108e44fc795e70246f5b036928050312e`
- **文件大小：**19,582 bytes，保留 LF。
- **基线：**r03 SHA256 `5a21645996e97e351c91aa66cb7169893a1c5401a52ea61ffc6923c7ae1f8d53`，已与分配目录初始文件核对一致。历史 r02 reciprocal/Muls 14/15 点退化，未重复该方案。

唯一假设是：第二个物理 VECOUT 缓冲可能让下一 tile 的输出转换减少等待前一 tile GM 输出拷贝的时间。第 105–110 行加入当前完整 UB 申请量和启用条件，第 112 行仅将输出 `InitBuffer` 的物理缓冲数从 `1` 改为条件式 `2 : 1`。`TQue<VECOUT,1>` 保持不变，`WriteRow` 全函数未修改。

预算计算为：

```text
currentUbBytes = singleUbBytes
               + (prefetchInput_ ? 2 * tile_ * sizeof(T) : 0)

doubleBufferOutput = tileCount_ > 1
                  && currentUbBytes + tile_ * sizeof(T) <= 180576
```

180,576 bytes 是历史源码申请量上界，未当作实测设备容量。r03 输入预取条件完整保留。源码模型得到的输出双缓冲范围：

| 类型 | 启用维度 D |
|---|---|
| FP32 | 2049–26624，以及 28673–30720 |
| FP16、BF16 | 2049–32768 |
| 所有类型 D≤2048 | 禁用 |

FP32 中间空档来自保留输入双缓冲后的剩余预算；D>28672 时 r03 已关闭输入预取，部分维度重新容得下第二输出缓冲。

实际执行并通过的检查：

- 撤销这一个初始化改动后，整个候选与基线字节一致；8 个脚手架文件也逐字节一致。
- 17 个计算及入口函数的函数体逐字节一致，包括转换、`ComputeRowSum`、`ComputeRms`、`WriteRow`、`Process`、设备入口和 `run_kernel`。ABI、FP32 运算顺序、NaN/Inf 分支、行分配及输入预取调度未改动。
- Python `-B` 标准库检查枚举全部 D=1…32768、三种 dtype、每核行数 0/1/2，合计 **294,912** 组；从实际 `InitBuffer` 参数重算全部申请，均与预算公式一致、均为 32-byte 对齐，最大总申请 **180,576 bytes**。行数≥2具有相同缓存判定。
- 检查原输出顺序仍为分配、转换、入队、出队、GM 拷贝、释放；48 组抽象队列检查的最大排队深度为 1，句柄无遗漏。该模型只检查 API 句柄顺序，不模拟设备 DMA 事件。

未执行 CANN 编译、NPU 测试、平台调用、网络调用或优化循环。物理缓冲轮换、DMA 同步、实际重叠、额外事件资源及性能影响仍未知；不能从源码检查或基线 28.87 分推断提速。

回滚规则：编译、设备正确性或同步检查失败时恢复 r03；未来获准的源码绑定完整评测若未满足 15/15 且官方分数高于 28.87，则不替换基线。基础设施失败记为 inconclusive。

可测量工作区间为 **2026-10-07 06:50:36.199–06:54:24.109 UTC，227.91 秒**，不含首次技能读取及本报告生成。
