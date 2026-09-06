# 2026-09-06 源码观察基线与使用方式

本任务包生成前通过 GitHub 连接读取了以下资源；只核验列出的内容，不声称做过全库代码审计或执行过测试。执行时由 W00 刷新最新状态，记录选择，不盲锁旧 main，也不自动合并 Draft PR。

## S01 / S02：主线和 T5

- S01：`main` 为 `565e52705bb7656d4623a04655001325ca61acd0`，提交说明为合并 PR #13，涉及 grounding recovery/idempotency/deadline。来源：https://api.github.com/repos/zhouwen-giser/world-semantic-grounding-service/branches/main
- S02：PR #14 为 open、Draft、未合并；head 为 `0db24edf8490766346904c5ab71fd78fbf3afb5d`。PR 自述基于最新 main 和历史轨迹分支；必须用提交包含关系验证，不能只信 PR 文字。来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/14

PR 中列出的测试结果和 live NOT_RUN 是 PR 自述，不是本任务包生成时重跑所得，不转录为本次完成结果。

## 已读取的具体源码

### S03 — `services/grounding-api/src/contract-negotiation.ts`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`6555ec35bb927e94782cd6fe96038f7296a5b715`。

精确 Header 配对；旧 1.1 服务端 allowlist；缺省 1.0。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/services/grounding-api/src/contract-negotiation.ts

### S04 — `packages/grounding-pipeline/src/contract-selection.ts`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`976c9a3f63b158f61e059fc995f0c4e91bc8c6dc`。

服务端持久化 selection 判别联合，目前 1.0/1.1。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/packages/grounding-pipeline/src/contract-selection.ts

### S05 — `contracts/wsgs-v0.1/contracts/grounding-request.schema.json`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`2eed553f29bfd3cfc9b5a7f8b7e5dc58b7b8b4db`。

封闭 request；readOnly=true；请求限额；不可直接塞新字段。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/contracts/wsgs-v0.1/contracts/grounding-request.schema.json

### S06 — `contracts/wsgs-v0.1/contracts/prior-grounding-reference.schema.json`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`cea26c06ea902ea2e9027c6d23cace0717933d42`。

groundingId/resultHash 与 selectedProductIds；未含 choice/candidate selection。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/contracts/wsgs-v0.1/contracts/prior-grounding-reference.schema.json

### S07 — `contracts/wsgs-v0.1/contracts/grounding-result.schema.json`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`971a9236a8e3cd6c23fc635587c61c51d9b3a0c1`。

封闭 result 与现有终态；不能新增 PENDING 终态。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/contracts/wsgs-v0.1/contracts/grounding-result.schema.json

### S08 — `services/grounding-api/src/server.ts`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`255dbef8fe4242331e562faa161e708155081453`。

已核验 80–285 行：单一 request validator；200 result / 202 job；GET 返回 Job。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/services/grounding-api/src/server.ts

### S09 — `packages/historical-trace-consumer/src/advanced-types.ts`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`ebd7646febb3ec283cdb5df7cc1aa9ec9b26f808`。

内部 status 与 findings: Record<string, unknown>[]，尚需公共类型闭合。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/packages/historical-trace-consumer/src/advanced-types.ts

### S10 — `packages/historical-trace-consumer/src/advanced-normalizer.ts`

观察 ref：`0db24edf8490766346904c5ab71fd78fbf3afb5d`；Git blob SHA：`8aa7132269306506a8482ac6d1eec0388e776e4a`。

HISTORICAL_* 内部类型；visited position；rankingBasis；bounded safePayload。

来源：https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/0db24edf8490766346904c5ab71fd78fbf3afb5d/packages/historical-trace-consumer/src/advanced-normalizer.ts

## O01：Codex 启动说明

官方命令文档用于核对 `/goal` 启动方式，不作为 WSGS 架构设计依据：
https://learn.chatgpt.com/docs/reference/commands
https://learn.chatgpt.com/fr-FR/use-cases/follow-goals

## 本包的结论边界

本包交付任务规范和可验证的包结构。真正的协议 Schema、冻结 lock、运行时实现、组件测试和交接验证由 Codex 在 W00–W07 中生成/执行。`TASK_SPEC_READY` 不得解读成 `CONTRACT_FROZEN` 或 `DEV_READY`。
