# qwen3.8-flash / 120 秒请求只读诊断

目标任务 SHA-256：d548902b4a6c4e4976a94cb6dcdf7c3def357aaec513dc59cc470dcbbeee58ac。
源证据：SACS reports/v0.6/real-integration-20260909/flash-http120-observation270/INTEGRATION_EVIDENCE.json；实际 POST deadlineMs=120000，最终 FAILED/MODEL_BUDGET_EXCEEDED。本报告不沿用先前 30 秒请求结论。

## 直接原因和精确时间

WSGS 模型阶段未在本地约 88.150 秒有效预算内返回可接受结果，本地计时器触发 MODEL_BUDGET_EXCEEDED。不是客户端提前停止观察，也不是适配器 120 秒计时器先到期。

| 事件 | UTC / 数值 |
| --- | --- |
| 准入计时起点（deadline 减实际请求 120000ms，推算） | 04:54:30.021 |
| request 入库 | 04:54:31.668 |
| job 入库 / available_at | 04:54:31.685 |
| Worker started_at | 04:54:31.782 |
| 入库至领取 | 97ms |
| LOAD_CONTEXT | 04:54:31.807–31.852，45ms |
| DETERMINISTIC_PARSE | 04:54:31.857–31.866，9ms |
| SEMANTIC_MODEL_PARSE 开始 | 04:54:31.871 |
| job deadline | 04:56:30.021 |
| 模型阶段开始时剩余 | 118150ms |
| 后续阶段预留 min(30000, ceil(remaining/2)) | 30000ms |
| 计算模型预算 | 88150ms |
| 模型阶段 FAILED | 04:56:00.022，elapsed_ms=88151 |
| 精确关联 Worker 日志 | 04:56:00.028111766，worker_job_failed / MODEL_BUDGET_EXCEEDED / attempt=1 |
| job finished_at | 04:56:00.029 |
| 任务尝试 / 各阶段尝试 | 1 / 1 |
| model_receipt / gowm_execution 行数 | 0 / 0 |

准入起点至模型阶段共 1850ms；两次较慢的能力 GET 在业务 POST 之前，不计入此任务 deadline。当前业务既没有花掉 83–92 秒在准入，也没有明显 Worker 排队。模型预算数值按持久阶段开始时间推算，计时器在处理函数内的实际起点存在毫秒级误差，但失败时间与预算边界吻合。

## 配置和实现依据

现场 API/Worker 镜像均为 sha256:d3efc51283cfc99c52c00604d10222430d97b79e733f09ce2df991d79b037550，启动时间约 03:30:50Z，均 healthy。Worker 配置：MODEL_NAME=qwen3.8-flash，MODEL_TIMEOUT_MS=120000，MODEL_MAX_RETRIES=1，MODEL_OUTPUT_MODE=CHAT_COMPLETIONS_STRICT，WSGS_MODEL_POLICY=MODEL_REQUIRED，WSGS_WORKER_CONCURRENCY=1，WSGS_WORKER_MAX_JOB_ATTEMPTS=3。无 WSGS_PIPELINE_* 超时覆盖。

- packages/grounding-pipeline/src/backend.ts:268：readiness/admission 前记录 now，deadline=now+deadlineMs；当前最大公开 deadline 为120000ms。
- services/grounding-worker/src/pipeline-policy.ts:63：模型阶段默认继承 MODEL_TIMEOUT_MS=120000；流水线还受任务剩余截止时间约束。
- services/grounding-worker/src/model-budget.ts:9：模型外层使用 remaining-min(30000,ceil(remaining/2))，Promise.race 触发不可重试 MODEL_BUDGET_EXCEEDED；本次最先到期的是此限制。
- packages/semantic-model/src/adapter.ts:427：120 秒适配器计时器覆盖整个 parse 和内部重试。maxRetries=1 允许最多两次 HTTP 尝试，不是每次120秒。网络错误、部分HTTP状态和结构/语义校验失败可导致重试。
- services/grounding-worker/src/production-module.ts:3352：只有 parseWithModelBudget 正常返回后才持久化 receipt；MODEL_REQUIRED 抛错路径不写回执，外层 abort race 还可能早于适配器失败回执产生。

因此有证据确认没有任务/阶段重试；没有证据确认模型内部到底进行了一次还是两次 HTTP 尝试、每次等待多久、供应商是否返回过错误或结构不合规结果。零回执不能解释为未调用模型。现有日志也不能证明额度问题、限流、供应商故障或推理耗时是根因。请求体构造未显式设置 thinking/reasoning 或输出 token 上限；这只是代码事实，不据此推断供应商默认行为。

## capabilities 为何很慢

services/grounding-api/src/production.ts:241 先 await readiness，再捕获调用者 GOWM discovery。readiness 调用 production-module.ts:833 的 checkReadiness，进而调用 liveAuthority。

liveAuthority 在缓存未命中时获取 GOWM 元数据/可用性，再同步调用真实模型 parse（固定短输入），同样使用严格结构输出和最多一次内部重试。其 WSGS_READINESS_TIMEOUT_MS=15000 只构造 GOWM 调用 context deadline，并未包住模型 parse；模型仍可以耗时接近120秒。WSGS_READINESS_CACHE_MS=5000 从成功探测完成后起算，且是进程内结果缓存，无进行中 Promise 合并；过期后下一次 GET 会重新阻塞探测，并发未命中也可能重复调用。失败不写新成功缓存。

SACS 已观察到两次能力 GET 分别91662ms和83668ms，前序记录还有46749ms和118146ms。代码解释了同步模型探测为什么可以使能力接口耗时接近120秒；但缺少每次探测的分段计时，不能把每毫秒都归于供应商或断言精确重试次数。GOWM高级能力的AVAILABLE与具体业务模型请求成功是不同条件。

POST admission 也调用同一 readiness 缓存，若失效，模型探测会消耗业务 deadline；captureAdmissionSnapshot 随后先查缓存，再强制获取调用者 GOWM authority，probeModel=false。本次 POST 仅1695ms、服务端模型前总耗时1850ms，说明长时间模型探测未在本次准入重演。能力 GET 不直接扣减本次业务预算；可能的供应商限流/资源竞争没有记录可以证实。

## 最小修复建议（未执行）

1. 优先补脱敏失败观测，而不是继续加长客户端等待：在模型请求开始和结束时记录尝试序号、状态码/受控错误码、headers/body耗时、有效预算、最后内部失败码、上游请求ID摘要；外层预算超时也保留已观测元数据。不要保存输入、输出或隐含推理。当前公开请求已达120秒上限，单改 MODEL_TIMEOUT_MS 或重试次数不能突破88秒外层预算。
2. 能力接口对模型就绪探测做独立缓存与进行中请求合并；模型就绪缓存有效期应独立于 GOWM 5秒能力快照，并保留有界新鲜度和失败关闭语义。短期把现有 READINESS_CACHE_MS 调到允许范围内更长值（最高60000）只能减轻重复探测，无法解决冷探测慢或业务模型超预算。维持 readiness 完成后再捕获高级能力快照的时序修复。
3. 拿到尝试级耗时后才选择业务修复：若主要是结构修复重试，修正适配兼容性；若主要为等待/生成耗时，验证并显式配置供应商支持的输出/推理控制或采用满足有效预算的模型方案。不能声称 qwen3.8-flash 名称本身保证低延迟。若计划降低后续预留或扩大契约截止时间，需要同时验证剩余执行阶段预算，不宜直接取消保护。
4. 修复后先用假时钟覆盖120秒任务、排队扣减、30秒预留、内部重试与取消、失败回执、能力并发缓存和快照新鲜度，再单独授权真实业务复测。HTTP200/AVAILABLE/RUN_FINISHED 都不能替代成功业务结果。

本轮仅查询数据库元数据（BEGIN READ ONLY + statement_timeout）、容器非敏感配置和既有日志，并读取本地代码/证据。没有修改或重启共享服务、没有重发模型请求、没有读取原始轨迹/请求密文或输出凭据。本地新增本报告。
