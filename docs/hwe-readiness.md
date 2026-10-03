# HWE 本机环境验证

2026-09-29，本机 WSL Ubuntu 24.04 / Docker 下完成两次独立容器的完整 baseline 验证。选择 FeSens `auto-arch-tournament` 的微架构优化任务，暂不切换 FrontierSWE。

## 重复结果

| 指标 | 第一次 | 第二次 |
|---|---:|---:|
| CoreMark iter/s | 30.79 | 30.79 |
| Fmax MHz | 13.83 | 13.83 |
| LUT4 | 13,964 | 13,964 |
| CoreMark 周期 | 4,491,485 | 4,491,485 |
| 三种 seed MHz | 13.83 / 13.99 / 13.57 | 13.83 / 13.99 / 13.57 |
| bounded formal 原始状态 | 53 PASS / 52 PREUNSAT | 53 PASS / 52 PREUNSAT |

两次均通过 lint、公开测试程序编译、Verilator 构建、ISS/CRC cosim、formal、综合及 FPGA 测量。这里的数值与仓库历史记录不同，不与官网成绩直接比较。后续实验固定同一套本机工具链。

原始证据：

- `.local/hwe-readiness/check-f83cd50a-9374-401a-a439-35fd5cd183d9/`
- `.local/hwe-readiness/check-4c68dad9-ba63-4352-affa-717104348658/`
- `.local/hwe-readiness/ready.json`：基线快照 SHA、镜像 ID、源码/检查器/工具摘要和两次结果。

验证期间补充了 Makefile、core.yaml 和主要工具二进制的指纹字段。新增指纹在第二次运行前后保持一致，旧指纹字段也一致；原始记录保存在 `ready-original.json`。未改动检查逻辑或任务文件。Windows checkout 的部分文本有 CRLF 差异；Makefile 与 core.yaml 对上游忽略行尾后的 diff 为空。

## 负例与运行控制

- RTL 导入、导出：13 个文件的内容 SHA 全部一致，证据在 `.local/hwe-controls/probe.json`。
- 损坏语法：lint 拒绝，证据在 `.local/hwe-controls/negative/`。
- 把 ALU XOR 改成 OR：lint 和构建通过，CoreMark CRC 检查拒绝，证据在 `.local/hwe-controls/xor/`。验证器能够拒绝可编译但行为错误的实现。
- 取消实际验证：终止执行并清理该 owner 的容器，证据在 `.local/hwe-cancel-control/`。
- 官方调度器依赖及 `--help` 入口：隔离容器内成功启动，证据在 `.local/hwe-native-probe/`。此检查没有调用模型，不算官方策略成绩。

## 工具链与修复

版本与下载 SHA 见 `scripts/hwe/toolchain-lock.json`。主镜像为 `proactive-hwe:local`，外部验证使用 8 CPU / 10 GiB；模型容器每个 2 CPU / 3 GiB，模型容器结束后再串行运行重验证。

OSS CAD Suite 20260928 在这个任务的 baseline 上留下 `$buf` 单元，nextpnr 无法布局。换为固定的 20260716 工具链后完整通过。该失败属于环境兼容性，未算成 Agent 解题失败。准备过程还修复了 shell 行尾、容器目录 ownership 和 generated 目录创建问题。

快速 formal 使用 ALTOPS，不能证明真实乘除法在所有输入上的正确性；公开 cosim/CRC 也不是穷尽程序验证；Fmax 来自布局布线估计，没有实物板卡验证。这些限制随候选证据保存。

## 补充的公开单元测试探测

上游 `cores/baseline/test/test_alu.py` 在另一独立容器中通过（`.local/hwe-unit-probe.log`）。使用固定 OSS 自带的 `tabbypy3`、pytest 和 cocotb，无额外安装；必须设置 `MAKEFLAGS=PYTHON3=/opt/oss/bin/tabbypy3`，否则 Verilator 子进程会混用系统 Python 3.12 与 OSS Python 3.11 库，出现 SRE module mismatch。这是测试环境错误。

该探测未改变正在运行的管理实验，也不属于本轮冻结的验收门槛。当前模型容器提供上文列出的完整基准检查，但没有打包该可选 cocotb 单元测试目录；不能声称 `make test` 可直接运行。ALU 单元测试还依赖当前内部组合接口，后续接入时需区分 CPU 的公开接口约束和可改变的内部结构。

## 形式化计数说明

两次 baseline 和第一轮两个候选的原始日志均为 53 项 DONE (PASS)、52 项 PREUNSAT。上游将两者合计为 checks_passed=105。第二 RVFI 退休通道固定不发出有效退休事件，因此相关前提不可满足；这 52 项不提供额外的有效行为证明。不能将 105 描述为 105 项非空证明。计数证据保存在 `.local/hwe-formal-coverage.json`，完整日志随各次验证留档。

## 2026-10-01：当前 adapter 的新 readiness

修复 SBY 单字段/三字段状态兼容后，在独立快照 `.local/hwe-adapter-readiness-20261001-c74b9a20/` 完成两次完整 baseline 验证及 preflight。两次均为 pass，所有上表质量指标和三个 seed 均与 2026-09-29 记录完全一致；每次仍为 53 个非空 PASS、52 个合法 `_ch1` PREUNSAT，没有放宽规则。旧 readiness、batch-3 和失败快照 `.local/hwe-adapter-readiness-20261001-e5d6f63c/` 全部保留。

当前认证在新快照的 `.local/hwe-readiness/ready.json`，verifierSha256 为 `dac5ae3a1093bb54bc7b84565260fb686647f0823aee5de3d5d5fe5f5706b0e3`；快照内 preflight 为 matches=true、baselineMatches=true、differences=[]。原始检查目录为 `check-c0a731dc-f051-451d-b9de-42330e3d09c1` 和 `check-6fc354a0-4f55-483f-9029-dfc011f17b61`，汇总、日志、哈希与清理审计在快照 `.local/readiness-record/`。基线源码和整个解压 tar 字节不变，新包哈希仅因 gzip 时间戳改变。环境未升级，本次进程/容器已清理，其他任务不受影响。

源项目旧 `.local/hwe-readiness/ready.json` 没有覆盖，且不匹配当前 helper 指纹；后续实验使用上述新快照的认证与对应 baseline 包。离线重放及回归记录在 `.local/hwe-status-format-20261001-a9c1/`，不能替代这两次完整验证。覆盖限制仍按前文保留；本次未启动任何模型实验。
