# ALE 管理层实验：证据与待决策项

状态：前两轮十项决定已确认；最终规格整理中，尚未实现或运行实验。
检索日期：2026-09-28。当前网页和 main 分支只用于发现事实；正式实验仍需固定提交和镜像。

## 已有授权和范围

- 首个开发任务：engineering/aerospace_low_thrust_trajectory。
- 一个 Codex worker；不实现桌面感知、多 worker 或产品 UI。
- 先质疑方案，完成讨论后收敛最小规格，再实现。
- 技能 grill-with-docs 要求同时使用 grilling 和 domain-modeling；本轮只记录已查事实、术语及建议，不将建议写成已接受决策。

## 官方证据

1. [ALE 执行模型](https://agents-last-exam.org/docs/ale/index.html)：先建立环境、放入输入、运行 agent，随后评分并收集日志。
2. [任务与数据](https://agents-last-exam.org/docs/ale/pages/tasks.html)：load/start/evaluate 分别声明任务、设置初态、最终评分。reference 在 agent 完成后才开放；预置镜像中的 reference 是加密归档。公共任务目前只提供 base 变体。
3. [Agent 接口](https://agents-last-exam.org/docs/ale/pages/agents.html)：被测对象是完整 harness，支持沙箱内或沙箱外运行。管理层应作为被测系统的一部分。
4. [接入接口](https://agents-last-exam.org/docs/ale/pages/add-agent.html)：Python deployer 提供 install、launch、parse_artifacts；launch 返回完整系统的结果。TypeScript 管理器仍需这一薄接入层，不能假定 ALE 原生加载 TypeScript adapter。
5. [轨迹与产物](https://agents-last-exam.org/docs/ale/pages/trajectories.html)：已有 events.jsonl、run.json、trajectory.json、eval_result.json、origin_log 和可选 output。复用这些记录，仅补充管理决策和多次尝试之间的关联；计费完整性仍需检查具体 parser。
6. [环境选择](https://agents-last-exam.org/docs/ale/pages/providers.html)：Docker 仅覆盖部分 Linux 任务；静态环境需自行保证初态。公开的接口能力不等于已获得特定排行榜协议批准。

## 必须纠正的推论

- 不能把正式 evaluate 放进 retry 循环。管理器仅根据可见检查决定继续或停止；停止后才获得最终成绩。
- Manager 可以是新的 harness，但此时 B1 是一个不同的被测系统。需要固定 worker 与环境，不能宣称是原封不动的官方 Codex 系统。
- 历史榜单成绩不能代替同期本地 B0。即使模型名称相同，镜像、CLI、prompt、时间上限和数据版本也可能不同。
- 在同一任务内多次尝试必须共享一个总预算和截止时间；重新启动不能重置预算。正式评分后不得继续使用该环境进行未污染的尝试。
- 单任务的重复运行能估计该任务上的变化，不能估计跨任务泛化；已用于调试的任务属于开发集。
- 不存在通过一次失败即可证伪整个管理层研究方向的合理设计；应预注册一个具体策略在具体任务分布和资源约束下的收益要求。

## 第一轮决策树（历史提案，已由下文确认记录取代）

- 研究主张
  - 是否采用同期配对 B0，并将历史结果仅作外部参考？
  - 是否将该航天任务限定为开发案例，另留未调优任务评估泛化？
- 资源约束
  - 主比较是否使用相同系统总推理成本上限与相同时间上限？Manager 推理与检查耗时计入 B1。
  - 若优先追求更高成功率，是否改用成功率—成本曲线并增加等预算对照？
- 首个处理变量
  - 确定性检查失败后续跑，还是 LLM 根据可见证据选择续跑方向？
  - 前者识别检查与续跑包装的价值；后者仍需固定续跑对照，才足以进一步归因于动态管理判断。
- 信息边界
  - Manager 与 worker 是否仅接触相同 agent-visible 信息？建议是。
  - 针对该任务手写的领域检查若仅给 B1，会同时引入专家知识；建议两组均可访问同一检查。

后续依赖以上回答：干预时机、恢复与新会话语义、可见检查清单、预算数值、重复次数与停止规则、统计分析、最小目录和实施里程碑。

## 尚待核实

- 目标任务的实际输入、产物契约、环境支持和公开检查信号。
- Codex 官方部署配置、原始日志 parser、版本及补丁。
- 已发布 GPT-6 Astra 成绩的具体配置与可复现材料。
- worker 退出、超时后子进程清理与多次调用的可靠性；静态代码可支持设计推断，但运行可用性必须实测。

## 本轮源码核查补充

研究子任务报告核对的上游提交为 `d10fb61a14f9719774c3520c5763068b28ef5546`。

- [目标任务目录](https://github.com/rdi-berkeley/agents-last-exam/tree/d10fb61a14f9719774c3520c5763068b28ef5546/tasks/engineering/aerospace_low_thrust_trajectory)：任务包括解析 Hohmann 计算、连续切向低推力数值轨迹、带倾角变化的固定时间最优控制。要求 results.json、tier2_trajectory.npy、tier3_trajectory.npy、tier3_control.npy。公开任务卡指定 Linux、Python/uv/NumPy/SciPy，cpu-free-ubuntu；卡片超时为 28800 秒，不能直接等同于论文运行上限。二元最终成绩对中间进展不敏感，需记录来源于公开要求的诊断检查。数值求解失败不自动等于管理失败。
- [Codex preset](https://github.com/rdi-berkeley/agents-last-exam/blob/d10fb61a14f9719774c3520c5763068b28ef5546/configs/agents/codex.yaml)：固定 Codex 0.114.0，并使用 cua-verse 的 v0.114.0-agenthle 补丁二进制；示例模型 openai/gpt-5.4、provider openrouter、effort high、OTEL 开启。不能用当前 stock CLI 直接声称复现该 preset。
- [论文 v2](https://arxiv.org/html/2606.05405v2)：本轮查到的是 Codex GPT-5.4 / GPT-5.5 结果和五小时运行上限，尚未核实 GPT-6 Astra 的已发布结果。未检索到不等于不存在，继续将该前提标为待证据支持。

上述核查不包括实际执行、隐藏参考内容或针对隐藏阈值设计检查。

进一步核查发现 preset 与默认配置不一致：[config.py](https://github.com/rdi-berkeley/agents-last-exam/blob/d10fb61a14f9719774c3520c5763068b28ef5546/ale_run/agents/codex/config.py) 默认 fork_version 为 `0.0.0-agenthle-20260614` 并指向对应新版本，而 YAML 指向旧补丁 URL。正式实验必须保存合并后的配置和实际二进制版本/哈希；仅记录 YAML 或 npm 版本不足以确定 worker 身份。

目标任务已在 [docker_support.txt](https://github.com/rdi-berkeley/agents-last-exam/blob/d10fb61a14f9719774c3520c5763068b28ef5546/selected_tasks/docker_support.txt) 中确认。公开输入列为 problem_spec.md、task_prompt.md、output_contract.json 和 runtime_env/pyproject.toml，但本轮尚未取得这些输入文件的实际内容，因此具体 schema 与物理检查仍待核验。任务评分接口可能对缺失产物、缺失 reference 和执行异常均返回零；必须另行区分基础设施错误与有效解题失败。

## 第一轮已确认决定

用户明确接受以下五项：

1. 同期本地运行 B0/B1；历史成绩只作为外部参考。
2. 首个里程碑为可信的单任务比较。目标航天任务作为开发案例；后续冻结策略，再用未参与调优的任务检验泛化。
3. 主比较允许增加成本以提高成功率。等预算不是主比较约束；仍记录完整成本、耗时和成功率。此比较识别整个干预方案的收益，不足以单独证明计算分配效率更高。
4. 先用确定性检查与续跑策略 A 打通链路；以后将 A 作为 LLM 管理策略 B 的简单策略对照。
5. B0/B1 均可访问同一套公开检查；manager/worker 均不接触隐藏参考或最终评分反馈。干预变量为检查调用时机与对检查证据的响应。

本轮结束时，worker 接入、干预细节和资源边界尚未决定；现已由第二轮确认记录取代。用户最新授权优先于此处历史状态。

## 第二轮已知实现约束（源码审查，未实测）

- [Codex deployer](https://github.com/rdi-berkeley/agents-last-exam/blob/d10fb61a14f9719774c3520c5763068b28ef5546/ale_run/agents/codex/deployer.py) 默认调用 codex exec，并未使用 resume。同目录重复 launch 会覆盖 transcript.jsonl、stderr.log、prompt.txt 等证据；需要按尝试分开保存并汇总。
- [Lifecycle](https://github.com/rdi-berkeley/agents-last-exam/blob/d10fb61a14f9719774c3520c5763068b28ef5546/ale_run/orchestration/lifecycle.py) 优先使用实验 wall_time_s，其次任务 timeout_s，否则 7200 秒。必须显式记录上限，并区分系统执行耗时与 worker 进程耗时。
- 管理器应在同一次 ALE agent 执行阶段内完成所有尝试；评分之后不再调用 worker。对照与处理组使用各自的新环境，不能复用已经放入参考数据的环境。

## 第二轮事实核查

### 公开检查契约

已读取官方 Hugging Face 数据集中该任务的四个公开输入，无需下载完整归档。以本节取代上文“尚未取得实际内容”的状态：

- [problem_spec.md](https://huggingface.co/datasets/agents-last-exam/agents-last-exam-data/resolve/main/tasks/engineering/aerospace_low_thrust_trajectory/base/input/problem_spec.md)
- [task_prompt.md](https://huggingface.co/datasets/agents-last-exam/agents-last-exam-data/resolve/main/tasks/engineering/aerospace_low_thrust_trajectory/base/input/task_prompt.md)
- [output_contract.json](https://huggingface.co/datasets/agents-last-exam/agents-last-exam-data/resolve/main/tasks/engineering/aerospace_low_thrust_trajectory/base/input/output_contract.json)
- [runtime manifest](https://huggingface.co/datasets/agents-last-exam/agents-last-exam-data/resolve/main/tasks/engineering/aerospace_low_thrust_trajectory/base/input/runtime_env/pyproject.toml)

当前输入版本为 full_mee_j2_minimum_fuel_v2。Tier 2 数组有 8 列，Tier 3 trajectory 有 15 列（含全部 7 个协态），control 有 4 列；Tier 3 使用非平均 MEE/J2 动力学和可变推力，不能套用旧模型。依赖 NumPy 1.26.4、SciPy 1.11.4，禁止使用 astrodynamics 和 trajectory-optimization packages。以上链接指向可变 main；运行前必须固定数据 revision 和文件哈希，并验证与固定 ALE 代码版本兼容。

可见规则覆盖结构、有限数、时间网格、质量与控制约束、边界条件、动力学与最优性缺陷，以及独立全时段 replay。可以仅从公开规范构建检查，但检查复杂度与耗时显著不同，尚未确定首版覆盖面。

公开规范另声明最终燃料质量门槛依赖 reference incumbent；该参考值未公开。因此即使所有公开检查通过，也不能确定最终通过。不能为了解决这一不确定性读取隐藏参考。

### 会话与计量

固定 Codex 子模块的 [CLI 定义](https://github.com/cua-verse/codex/blob/41018ee763bf3bbe1630ae87234ee4dac293cd3c/codex-rs/exec/src/cli.rs) 包含 exec resume，可显式恢复会话；ALE 接口仍需扩展。建议同会话续跑，避免同时改变上下文；该建议尚未由用户确认。

现有 parser 读取 turn.completed.usage，但多轮恢复后是否是增量计数尚未实测。需要小规模对账，防止累计量重复求和。feature_overrides 默认为空不证明子代理关闭；单 worker 约束需要显式配置并核验。

### 本地运行条件

只读检查发现 WSL2 Ubuntu-24.04 已有可用 Docker 29.1.3、Linux amd64、Python 3.12.3、uv 0.12.19；ALE 镜像未缓存。WSL 存储位于 D 盘，物理剩余约 484 GiB；C 盘仅约 39 GiB。WSL 内存上限约 15.4 GiB，Docker 中已有两个运行容器，未更改或停止。

[官方 Docker 指南](https://agents-last-exam.org/docs/ale/pages/local-docker.html)推荐 Linux amd64 rootless Docker；当前 WSL daemon 看起来是 rootful，兼容性仍需验证。官方镜像约 42 GB 压缩、105 GB 解压；完整评估默认通过约 48.9 GB gated archive 分发数据，未下载，也未检查凭据。公开小输入可用于规格审查，但不代表官方最终评估的数据已经就绪。

## 第二轮决策前沿（历史提案，已由下文确认记录取代）

1. 干预边界：建议 worker 正常结束后运行可见检查，仅对明确失败恢复原会话一次；无周期打断。最多两次调用，所有可见检查通过即停止，不宣称基准成功。
2. 检查范围：建议结构与公开物理/边界检查作为首版，完整最优性与全时段 replay 后续增加；遗漏检查必须标为未覆盖，不能记作通过。
3. 环境路线：建议现有 WSL Docker 单并发试运行；明确这是自建配对基线，记录与官方支持宿主的差异。另一选择是独立 Linux 宿主。
4. 模型接入：保持用户原先的 GPT-6 Astra 意图，但需确定可在实验 worker 使用的 API/provider 或 CLI 登录路径，并核验实际模型 ID 和计量能力；桌面 app 模型名称不直接证明该部署路径可用。
5. 资源边界：允许 B1 增加成本不等于无限续跑。需要用户给出试跑总费用上限和时间容忍度；正式重复次数与统计停止规则在可执行配置与试跑成本确定后收敛。

## 第二轮已确认决定

6. Worker 正常结束后外部运行公开检查；明确失败时恢复同一会话修复一次，最多两次调用。检查全过直接停止。基础设施错误单独记录。
7. 首版仅检查结构、有限数、时间一致性、公开物理约束和边界条件；最优性和完整重放记为未检查。两组得到相同工具和说明。
8. 优先使用现有 WSL Docker，单并发、同资源配置；先验证兼容性，再下载完整环境。结论限定于本地运行条件。
9. 使用 Codex CLI，模型改为优先 GPT-6 Sol。实际登录路径、CLI 版本与模型可用性由预检核验，不再沿用 Astra 假设。
10. 先跑一对验证链路，不作为成功率证据；B1 最多增加一个修复阶段。用户暂不设总费用上限，并授权助手决定时间上限。用户愿意探索显著增加 token 换取工作价值的方向；首轮不人为增加调用次数或把 token 消耗当作成果。

本轮按 OpenAI Docs 技能打开了 [GPT-6 Sol 模型页](https://developers.openai.com/api/docs/models/gpt-6-sol)、[Codex 配置文档](https://learn.chatgpt.com/docs/config-file/config-basic)及[更新日志](https://learn.chatgpt.com/docs/changelog)，确认当前官方模型标识 gpt-6-sol。文档存在不等于当前登录账号已成功执行该模型；仍需预检。

## 最终规格状态

见 [experiment-v0.1.md](../experiment-v0.1.md)。已将用户授权助手决定的时间预算具体化：两组首轮各 5 小时、B1 追加修复最多 2 小时、每次外部检查 10 分钟、每组评分 30 分钟；环境就绪后一对总期限 14 小时，不要求耗尽。

WSL Codex 0.157.1 已通过 ChatGPT 账号登录，模型缓存列出 gpt-6-sol；未执行推理。两端 feature 查询发现 multi_agent 默认 true，因此实验中显式关闭 multi_agent 和 multi_agent_v2。

单任务 reference 可按目录获取约 190 MB，无须完整 49 GB archive，但需要 gated 数据访问权限；本轮仅列目录。公开输入、reference 与 evaluator 的版本兼容性尚未证明，已列为运行前阻断检查。最终共同理解确认后方进入实现；不再对用户已授权的费用、时间选择重复询问。
