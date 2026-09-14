# SACS 联调 MODEL_BUDGET_EXCEEDED 只读诊断

本次仅诊断；没有修改配置、源码、部署、重启、清理资源或重发模型业务请求。关联使用证据时间窗与 grounding_id 的 SHA-256，未将摘要作为 API ID，也未读取/输出原始业务 payload 或模型推理。

## 结论

直接失败原因是 WSGS 本地模型预算到期：SACS 请求规划器固定任务总截止时间 30000ms，进入模型阶段时剩余约 28 秒，WSGS 为后续阶段预留剩余时间的一半，因此模型实际仅获得约 14 秒。配置 MODEL_TIMEOUT_MS=120000 不是本次生效的最短限制，单独调大它无效。

## 现场关联

| 项目 | post-fix-check | attempt-4 |
| --- | --- | --- |
| Grounding ID SHA-256 | 45a514f776a52ff563f1d24c156c0ad8f0e851fba3d1e449394dd7709d10136c | bbfebe4ef920aa2d1ff73b33a24d78ff7b204dfc4bd3ed7d3ce6c1ec8f02a592 |
| 请求入库 UTC | 02:48:51.840 | 02:33:28.710 |
| 任务 deadline UTC | 02:49:20.258 | 02:33:57.007 |
| 模型阶段开始 UTC | 02:48:52.217 | 02:33:28.916 |
| 开始时剩余预算 | 28041ms | 28091ms |
| 按代码计算模型预算 | 14020ms | 14045ms |
| 模型阶段失败耗时 | 14025ms | 14047ms |
| 阶段失败 UTC | 02:49:06.242 | 02:33:42.963 |
| 任务终止 UTC | 02:49:06.251 | 02:33:42.970 |
| 任务 / 模型阶段尝试次数 | 1 / 1 | 1 / 1 |
| 模型回执 / GOWM 执行记录 | 0 / 0 | 0 / 0 |

两次错误码均为 MODEL_BUDGET_EXCEEDED；时间仅相差几毫秒，吻合本地预算计时器，而非 120 秒模型适配器超时。最新 Worker 日志对应 worker_job_failed / MODEL_BUDGET_EXCEEDED / attempt=1。模型阶段之前 LOAD_CONTEXT 和 DETERMINISTIC_PARSE 正常完成。

现场配置：模型 qwen3.8-27b，MODEL_TIMEOUT_MS=120000、MODEL_MAX_RETRIES=1、MODEL_OUTPUT_MODE=CHAT_COMPLETIONS_STRICT、WSGS_MODEL_POLICY=MODEL_REQUIRED；未设置全局或模型阶段超时覆盖，因此模型阶段策略沿用 120000ms。Worker concurrency=1、maxJobAttempts=3，但本次预算错误 retryable=false，实际未发生任务或阶段重试。

## 实现路径和可确定边界

- SACS `packages/grounding-request-planner/src/index.ts` 及 `frozen-request.ts` 都固定 deadlineMs=30000。
- WSGS `packages/grounding-pipeline/src/backend.ts` 在 readiness/admission 前记录 now，任务截止时间为 now+deadlineMs，所以入库前准入也消耗总预算。最新记录准入前起点推算 02:48:50.258，模型阶段开始前已消耗 1959ms。
- `services/grounding-worker/src/model-budget.ts` 使用 `remaining - min(30000, ceil(remaining/2))` 计算模型预算；计时器产生 `SemanticModelError(MODEL_BUDGET_EXCEEDED, false)`，通过 Promise.race 中止解析并传递错误。
- `packages/semantic-model/src/adapter.ts` 的 120 秒计时器覆盖一次 parse 内所有尝试，MODEL_MAX_RETRIES=1 表示最多两次模型 HTTP 尝试，不是每次额外赠送 120 秒。
- 本次有证据排除的是任务/流水线重试累计；不能从现有记录确认模型适配器内部 HTTP 尝试次数、首字节延迟、排队时间或是否曾触发结构修复重试。失败时 MODEL_REQUIRED 直接抛错，生产阶段在成功返回后才写 model_receipt；外层预算 Promise.race 也可能先于适配器失败回执完成。因此两次均无持久模型回执，不能把“无回执”解释为“未调用模型”，也不能断言完全由模型供应商故障造成。
- GET HTTP200 是成功读取 FAILED 任务，不表示业务执行成功；SACS 的错误保留和终态投影符合此语义。

## 为什么 capabilities ready 仍会失败

高级能力 available 来自 GOWM 能力发现。整体 readiness 的模型探测使用固定短输入，直接调用模型 parse，受适配器 120 秒限制，不使用业务任务的 30 秒截止时间及后续预留算法。现场此前冷启动就绪约 21 秒已成功，但这已超过本次业务实际 14 秒模型预算。能力发现/短输入探测通过不保证具体业务请求能在更短预算内完成。

## 建议的最小修复与验证（未执行）

1. 在 SACS 两个请求构造路径统一提供受限的 deadlineMs 配置。本开发环境可先用现有公开契约支持的 120000ms 验证；WSGS 后续预留至多 30000ms，若准入和排队约 2 秒，模型可用约 88 秒。同步核对 SACS HTTP、异步轮询及用户操作截止时间，避免客户端先于任务结束超时。
2. 不建议仅增加 MODEL_TIMEOUT_MS（当前已有 120 秒）、增加重试或移除 WSGS 截止时间/预留保护。若必须维持 30 秒整体 SLA，需要更快的模型/受控输出及预算策略评估，不能保证当前模型完成。
3. 增加脱敏失败观测：任务剩余时间、有效模型预算、已开始的 HTTP 尝试数、首响应/总耗时、失败码、上游请求 ID 摘要；保留失败回执，不记录原始输入、输出或隐含推理。
4. 先用假时钟测试 30 秒→约14秒、120秒→约88秒、取消和错误透传；然后在新增授权下仅重发一次相同基础请求，采用新 requestId/idempotencyKey，核对模型完成、公开 Schema、终态投影及幂等重放。若结果是合法 UNRESOLVED/AMBIGUOUS，单独评估上下文和语义，不将传输链路通过当作对象解析成功。

上游 SACS 脱敏证据位于 `reports/v0.6/real-integration-20260909/post-fix-check/INTEGRATION_EVIDENCE.json` 和 `attempt-4/INTEGRATION_EVIDENCE.json`。本地代码与当前现场镜像 d3efc51283cfc99c52c00604d10222430d97b79e733f09ce2df991d79b037550 对应能力时序修复部署。
