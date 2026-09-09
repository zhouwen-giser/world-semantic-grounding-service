# STOP / RANK 消费侧修复（2026-09-08）

## 已确认的原因

分析任务回传并由本仓核对的 STOP 时间线：`grounding-4993e0e1-3b04-47f8-b896-36d41606e9b7` 在 09:38:03.871Z 创建，截止 09:39:36.666Z；创建前约 27.2 秒已计入原 120 秒总预算。语义模型阶段耗时 91999ms（成功回执 91995ms），随后 REFERENCE_VALIDATE 约 524ms 后到期。未执行历史查询或 GSAP STOP 算法。旧公开阶段 PERSISTENCE 来自 Worker 超时清理的通用错误，不是数据库耗时证据。随后已安全读取并校验加密检查点，模型回执为 attempts=1、elapsedMs=91995、status=SUCCEEDED，无 failureCode（见 model-receipt.json）。这证明适配器记录一次模型尝试，未证明模型服务内部排队与计算耗时细分。

受理实现确实先 readiness、再 captureAdmissionSnapshot，并将这些耗时计入原截止时间。readiness 缓存此前从探测开始计时；慢模型探测完成时缓存可能已经过期，使紧接着的捕获再次探测。这是已确认的代码缺陷，但未把创建前 27.2 秒全部归因于某一次具体重试。

RANK `grounding-e10d4f1c-bfeb-4827-8e22-4486f3f4abe7` 的目录仍包含历史轨迹、执行区间及 T4；T4 AVAILABLE，只有 history.get-trajectory 为 UNAVAILABLE / CIRCUIT_OPEN。WSGS 却从 capturedLock.previewOperations 删除暂不可用的历史操作，编译器因此报告 NOT_REGISTERED。不是排名操作或 GSAP Schema 缺失。原始能力筛选证据和独立分析报告位于分析仓 `output/site-validation/wsgs-stop-rank-20260908/capabilities.jsonl`、`reports/WSGS_STOP_RANK_DIAGNOSIS_2026-09-08.md`。

## 修复行为

- 模型使用本次剩余时间，给后续引用校验和执行保留 `min(30000ms, 剩余时间的一半)`。预算耗尽返回不可重试 MODEL_BUDGET_EXCEEDED；必需模型不会用伪造结果继续，MODEL_OPTIONAL 保持原有显式降级规则。取消原因原样传播，迟到模型结果不会被接受，已中止调用不会再启动 HTTP 请求。
- 原 120 秒总截止时间及其起算位置不变。预算控制避免模型耗尽后续时间，不保证任意慢模型均能在期限内完成；需要现场复测实际延迟。
- readiness 缓存有效期从成功完成时起算。调用方授权快照仍强制单独捕获，不复用其他主体权限。
- Worker 超时清理使用已持久化的 pipeline_stage 映射公开阶段。REFERENCE_VALIDATE 映射 REFERENCE_GROUNDING；未启动任务映射 CONTEXT_LOADING。过期结果仍受原租约/截止时间栅栏拒绝，不放宽结算条件。
- 暂不可用操作保留契约注册信息，冻结 availability 继续由编译器检查。OPERATION_UNAVAILABLE / OPERATION_DEGRADED 在历史基础查询投影为 HISTORICAL_UPSTREAM_UNAVAILABLE，并公开 PARTIAL + BLOCKING UPSTREAM_FAILURE。没有静默刷新冻结快照、扩大调用授权或执行不可用能力。
- 不改写旧任务结果或旧受理快照，不修改迁移或新建表。

## 验证

- npm run check：1021 通过，49 项数据库测试默认跳过。
- 一次性真实 PostgreSQL 16.9：49/49 通过，无跳过；覆盖新超时阶段投影、旧租约、清理、恢复、幂等及升级。容器已清理。
- 针对模型预算、调用方取消、禁止迟到结果、过期不调用、CIRCUIT_OPEN 与未注册区分等回归通过。具体输出见 check.txt 和 postgres.txt。

## 部署交接

本次仅完成本地代码修复和验证，未部署、未启动服务器 API/Worker，未宣称 STOP 或 T2/T3/T4 业务验收通过。GOWM 任务先完成 Provider 修复及正式包部署交接，分析任务随后使用本仓最新代码统一联调。原 PROVIDER_NOT_READY 是独立上游阻塞，不能以本地回归代替现场成功回执。
