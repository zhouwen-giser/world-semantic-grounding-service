# 新历史请求只读诊断

本次仅检查既有请求检查点、配置、数据库队列及代码，没有重提请求、调用 Provider、改变部署或运行投影。业务标识、密钥及轨迹内容未输出。

## 后续关联更新

后续只读核对已将时间窗候选提升为冻结请求关联：由历史节点 LITERAL 参数绑定和上游区间节点已保存输出，按 GOWM historicalSemanticRequestIdentity 算法计算 semanticRequestHash=sha256:4d478177325b690f18158ca33dede96b50b2addc3f4d3d79efbf2e09a95a2b27，与队列相同。完整 subjectReferenceKey 和 intervalReferenceKey 摘要也匹配。

WSGS 自身 canonicalSha256 校验检查点通过。GOWM_EXECUTE.outcomes[0].encryptedCheckpointEvidenceMaterial.terminal.result.nodes[1].effectiveSnapshotBeforeHash=sha256:8f5958c5e6992493c94ab44d5947ae11aae7615e390d5dd2e585d276e0216801，与队列 requested_snapshot.manifestHash / snapshot_hash 相同，节点 capturedAt=2026-09-09T08:30:19.436Z 也一致。节点执行后哈希为 sha256:6fdd76b283c8b38fc8085ac77fe41c0eca6b97e9342f89f878a1dae81a887ba1，不能用终态汇总快照替代执行前冻结快照。

GOWM 任务反馈该队列于08:46:21.796956Z正常 COMPLETED，attempts=1、generation=1，没有人工恢复队列；真实产物为 PROVISIONAL，9806个样本、2段、1个缺口。此前为消费延迟，下面的 QUEUED 为早先检查时状态。产物生成不改变原 WSGS 请求已返回 PARTIAL 的事实，也不代表端到端业务验收通过。GOWM 正单独处理消费者调度延迟，WSGS 公开等待原因缺失仍需修复。

请求时间：2026-09-09T08:29:21.586Z–08:30:22.227Z。
groundingId SHA-256：db91c4f43f2fc06676bf03fc924c0e07355617674987bc3c79cc9edc37183c5f。
resultHash：sha256:e7d293a9edb3fd7aa737bfb98c769d941aaa28d0dd65e62be07e7f5070e98677。

## 本次执行证据

- 检查点按 groundingId 摘要关联，解密后的状态哈希校验通过。REFERENCE_VALIDATE 为 VALID，revalidationRequired=false。
- REQUIREMENT_PLAN 为 PLANNED，selectedRecipeIds=[HISTORICAL_TRAJECTORY]，capabilityGaps=[]；能力匹配通过。本次不能沿用前一条引用查询的 CAPABILITY_GAP 结论。
- historicalIntent 选择 LATEST、EXECUTION_ENVELOPE。计划不包含显式起止时间；现有 intent 投影也没有将自然语言起止时间转成历史请求参数。因此不能声称严格按用户给定时间窗执行。
- operational-task.get-execution-intervals 于 08:30:20.179Z–08:30:20.259Z COMPLETED。
- history.get-trajectory 于 08:30:20.273Z–08:30:20.393Z PARTIAL。historicalExecution 与其 finding 均为 PENDING / PROJECTION_PENDING，未获得 trajectoryReferenceKey。
- EVIDENCE_NORMALIZE 与 PRODUCT_ASSEMBLE 均 PARTIAL、capabilityGaps=[]。不是模型超时或引用未解析。
- 在 default 范围、本次调用时间窗内仅查得一条历史投影队列记录，created_at=08:30:20.363928Z；检查时仍 QUEUED，attempts=0，generation=0，无 processed_at、trajectory_revision_id、outcome_id 或 last_error。该记录按范围和窄时间窗关联；未从检查点取得 semanticRequestHash，不能将其表述为已完成请求哈希级关联。

## 原因和最小修复方向

1. **GOWM 尚未提供此次查询所需的轨迹投影。** Repository 按范围、对象、执行区间修订、语义请求及快照查找；无匹配轨迹时排队并返回 PROJECTION_PENDING。其他既有轨迹不必然匹配此次查询。上述队列尚未被尝试消费，但本次证据不足以断言消费者缺失、停机或水位未齐。下一步应只读确认消费者部署、运行和领取条件，再确定是否需要恢复既有消费者。不得通过重建历史轨迹或改任务事实绕过问题。
2. **WSGS 丢失了公开等待原因。** production-module.ts 约 2105–2134 行仅在 projectHistoricalReference 返回引用时构建 foundation；normalizer.ts 约 160 行对 PENDING 不产生轨迹引用。同时 failureReasonCode 只接收历史 CAPABILITY_GAP，不接收 PENDING。于是 public-world-analysis.ts 已有的 HISTORICAL_PROJECTION_PENDING 映射得不到输入，产生 PARTIAL 且 gapKinds=[]。最小修复应独立传递历史 pending 状态，使用既有公开 gap，不伪造轨迹引用或有几何内容的 Finding，并补充实际生产装配链回归测试。
3. **时间语义需明确。** 当前任务历史路径使用最新执行区间及其 envelope，而非自由起止时间。应先核对这一行为是否符合本次请求验收口径；在未支持显式时间窗的情况下，不得静默宣称时间窗已被采纳。

WSGS 当前 historical/advanced history/preview 开关均启用，模型 kimi-k3。pendingRetryMs 为 0；现有重试只作用于执行区间等待，本次区间已完成，因此单纯增大它不能解决轨迹投影等待。

## 验收边界

任务唯一引用前置验收仍成立；本次历史分析仍 INCOMPLETE，不是业务 PASS。保留 PARTIAL 与真实 pending 语义，暂停扩大排名、道路及时间分析测试。本次没有实施以上修复。
