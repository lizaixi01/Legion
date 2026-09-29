# gron 冻结提交重评

完成日期：2026-09-29。修正评分容器的代理配置后，只重新评分原有 A/B 提交，没有调用模型、修改源码或重新选择候选。

| 指标 | A：普通 Codex | B：规则管理＋双 Worker |
|---|---:|---:|
| 历史受污染评分 | 166/224（74.11%） | 159/224（70.98%） |
| 修正后官方评分 | 177/224（79.02%） | 170/224（75.89%） |
| 增加通过项 | 11 | 11 |
| 原执行输入＋输出 token | 324,207 | 565,595 |
| 原执行墙钟时间（含公开检查） | 365.1 秒 | 505.3 秒 |
| 本次重评新增模型调用/token | 0 / 0 | 0 / 0 |

B 仍低 3.125 个百分点，所列有效运行的 token 为 A 的 1.74 倍。两份提交均未完整解决任务。这次修正提高了两组绝对分数，没有改变排名。

## 修正与验证

评分桥接此前把 HTTP_PROXY/HTTPS_PROXY 注入整个评分容器，候选程序继承后将 localhost 请求发往宿主代理，产生 502。现在只传 PIP_PROXY 供依赖安装使用，不设置通用 HTTP 代理，也不使用 NO_PROXY=* 改写测试行为。上游评分器和测试内容未修改。

两份原始提交均通过本地 HTTP 回归检查；真实评分容器已检查代理环境。官方评分无 errorCode、branchErrors 或 warnings。按官方 active/ignored 规则统计 224 项，而非直接数原始测试结果。

新增 scripts/regrade-programbench.ts，直接对归档重评，评分前后核对 SHA256，独立保存适配脚本、来源、评分和清理记录。历史目录未覆盖。72 项自动化测试、TypeScript 构建及 Python 语法检查通过。

## 证据

- A 原运行：`.runs/programbench-b093a9f9-3b4c-4377-9550-a9c4ca51f062`
- A 重评：`.runs/programbench-regrade-90ed937e-f36c-4b41-beeb-5e87275a95ad`
- A 提交 SHA256：`a38278d36025ecc48f21746ba6ff81c94533d2c76fb15ed54996e1e313ed6145`
- B 原运行：`.runs/programbench-c23a07c8-6091-4c78-af69-37e19a5c646f`
- B 重评：`.runs/programbench-regrade-af40a6f0-f238-40fb-9f33-1ce9458fea54`
- B 提交 SHA256：`fc05e65337daaa532006cfab7f6566b48fe9c0d09afaffefaccded5ea205235b`

各重评目录保留 provenance.json、selection.json、execution.json、grade.json 和官方原始日志。已独立复核原件与重评副本哈希一致；两次重评的容器及评分/代理 PID 记录均已清理。核对结果保存在 `.local/gron-regrade-verification.json`。

## 解释边界

B 实际是规则管理的两个完整候选，按声明顺序选择首个通过公开检查者；本次没有 LLM Manager 自主分工，也没有评分 candidate-2。结果只能说明当前组合未获得收益，不能证明 Coding 不适合 Multi-Agent。

每组只有一份可评分提交。A 首次超时尝试未保存产物和完整用量，未计入表中；两组历史执行器存在基础设施版本差异，不能视为严格随机对照或完整实验成本比较。详见[原始比较](programbench-first-comparison.md)。gron 隐藏结果已经用于事后诊断，后续只能作开发题，策略泛化需用未调优任务检验。
