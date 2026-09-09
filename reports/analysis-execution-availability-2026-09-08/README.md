# 执行前可用性观测修复与剩余问题（2026-09-08）

## 最新结论

历史有效快照缺失的 422 已修复。旧 PROVIDER_NOT_READY、STOP 截止时间、RANK 计划不可用的详细原始任务、证据和责任划分见 [原始问题清单](../history-effective-snapshot-2026-09-08/ISSUES-AND-HANDOFF.md)。该清单描述原诊断轮次，不能作为当前服务器故障状态。

本轮修复新的 STOP 阻塞：受理时冻结的 availability 仅有效 5 秒，模型和历史基础查询结束后，分析编译以当前时刻检查旧观测，误把已经具备轨迹的任务阻塞为 CAPABILITY_UNAVAILABLE。任务 grounding-44c0632e-aa1b-4a80-8ba5-4222ba68380d 已有成功 history.get-trajectory 回执，但未执行 T3；观测 checkedAt=2026-09-08T11:33:36.127Z、validUntil=11:33:41.127Z。现场证据由“检查功能实现与项目遗漏”提供，本任务读取 stop-availability.jsonl 核对了 5 秒有效期、状态和契约绑定。

## 修复

- 在历史基础准备完成后，用原调用方身份和限定操作的签名委托重新读取 operation-availability。
- 新观测必须匹配原冻结 catalogRevision、bindingRevision、操作版本、成熟度和授权权限。拒绝缺失/重复操作、未来观测、过期观测和契约漂移。
- 只以新观测判断执行健康状态；不修改受理快照、原截止时间、权限、业务有效快照或契约指纹，不延长旧 TTL。
- 编译使用新观测；CROSS 第一节点执行后，如第二节点的观测已到期，再次查询其状态。无可用新观测时仍拒绝执行。
- 观测包含原 authorityHash、principalHash、签名委托 jti 哈希、请求标识和 observationHash，随现有加密流水线检查点保存。结构化日志只记录标识、哈希、时间和状态，不输出凭证或原文。
- 不新增数据表、公开字段或业务接口。沿用现有检查点落盘时机；不声称新增独立中途事务持久化。

## 测试

- npm run check：1037 项通过，49 项 PostgreSQL 用例因该命令未配置数据库而跳过，见 check.txt。
- 独立 PostgreSQL 16.9 临时实例：49/49 通过，无跳过，涵盖 Worker、API、任务存储、正式迁移，见 postgres.txt。临时容器已移除。
- 专项覆盖：受理观测过期后使用新观测；旧观测不变；过期/不可用观测拒绝；权限、契约、版本、时间异常拒绝；CROSS 超过 TTL 后第二次探测；观测哈希；实际 HTTP 签名探测；内部检查点保存与公开 Schema 隔离。
- 开发闭包仍 productionQualified=false，生产验收台账的 blocked/not_run 不因单元测试通过而消除。没有处理生产延期事项。

## 尚未完成的现场验收与分工

1. GOWM 历史 Provider：原 PROVIDER_NOT_READY 已由 GOWM 任务定位至投影依赖/正式迁移等问题并推进 080/081/082 修复。最新 MAP 的 PENDING，据 GOWM 只读核对，是捕获时刻 11:33:15.717Z 早于首次 finalization 11:33:19.500864Z，约差 3.784 秒；队列 COMPLETED 无 last_error。此为正常冻结资格等待，不能将后到数据用于改写旧结果，也不应改成业务成功。
2. STOP：先前单次模型解析约 92 秒导致原截止时间耗尽，已增加模型分阶段预算及真实失败阶段，见 stop-rank-consumer-fix-2026-09-08。本轮新问题是上述 availability 过期，代码和本地回归已完成，需新任务现场证明 T3 实际执行。
3. RANK：旧 HISTORICAL_QUERY_NOT_REGISTERED 是历史能力 CIRCUIT_OPEN 被消费者过滤掉锁，误报未注册；已修复保留契约锁并准确分类。最新 082 轮 CROSS/RANK 为 MODEL_BUDGET_EXCEEDED，约 90.3 秒，未执行历史/GSAP；不能归咎排名算法，也不能靠延长原截止时间掩盖。
4. T2/T3/T4：尚无本轮完整正向业务验收。继续分别验证 MAP 道路证据、STOP/CROSS 时空事件、RANK 指标排名。无数据、PENDING、PARTIAL、PROVISIONAL 均按实记录；GDPS 无数据传播通过不等于有数据业务通过。
5. “执行 GOWM 完整迁移 Goal”负责 GOWM 冻结资格、Provider 和正式交付链一致性；“检查功能实现与项目遗漏”负责串行诊断部署、分析 Provider 及 T2/T3/T4 复测；本任务负责 WSGS 消费端补丁。

本轮未操作服务器部署。分析任务报告候选 2eb8a7a031f528ada556 的 API/Worker 已停止、未激活；这是其报告状态，不代替部署前实时核对。复测应先核对最新正式交付链，仅部署诊断候选，结束后停止 API/Worker；不得自动激活失败候选。

## 后续现场反馈与 HTTP 预算修复

分析任务新 STOP grounding-38796e89-0656-4ca5-b79e-63d48ac4a6a3 已记录 execution_availability_observed（观测哈希前缀 735db043、authority 前缀 ef08dd1f）并实际调用 temporal-spatial.find-events；新观测已存检查点。可用性过期阻塞已在该任务越过，T3 未成功。

模型 29.807 秒；GOWM_EXECUTE 10.780 秒返回 UPSTREAM_TIMEOUT，总时长 58.187 秒。WSGS 给操作批准约 30 秒，而客户端默认 10 秒先退出。另一方面，Gateway 幂等记录 11:56:50.887 至 11:57:20.880 约 30 秒后仍 FAILED、无结果/回执，说明还有独立上游失败，并非仅客户端等待问题。

已修复 Gateway 客户端 executeOperation：HTTP 等待取已验证请求 executionPolicy.deadlineAt 与调用方 deadlineAt 的较早值，整个重试共用绝对截止时间。普通发现/轮询仍保持原 transport timeout；不提高全局超时，不增加总任务预算，不绕过取消。新增四项测试覆盖超过发现短超时仍成功、操作截止时间、调用方截止时间和取消拒绝，专项 20/20 通过。

更新后 npm run check 为 **1041 passed / 49 PostgreSQL skipped**。前述真实 PostgreSQL 49/49 为本次观测修复验证；后续 HTTP 预算改动不涉及持久化，未重复数据库测试。上述现场数据来自分析任务反馈，本任务未自行部署或将超时计为业务通过。分析任务继续定位 GSAP 约 30 秒的读取/计算失败。

### GSAP 后续交接（待 WSGS 全链路复测）

分析任务反馈已修复读取瓶颈，定向部署三分析服务及主 Gateway，其余 52 个容器和数据库身份保持不变。组合根前缀 3248e5bc333df1ca，历史 Provider/082 Worker 未替换。同一真实轨迹 wrf_349f838c72fb4a25adbb6862dfc5ee1a@2 经主 Gateway 在原 30 秒内返回 HTTP 200/PARTIAL：5806 原始样本、23 个 STOP，rows=5820、candidates=5806。这是分析任务提供的真实上游执行证据，尚不代表本次 WSGS API→Worker→Gateway 全链路已通过。该任务正在构建含最新 HTTP 预算补丁的 WSGS 诊断候选；本任务不并发操作现场，仍待新任务回执、PARTIAL 原因及最终停机状态。

### 最新 WSGS STOP：模型性能边界，未进入分析

候选 f628e707bfcf45fecc4c，任务 grounding-3a726139-381d-4209-86f7-4bf13b258439，91.043 秒 FAILED / MODEL_BUDGET_EXCEEDED，stage=SEMANTIC_MODEL，retryable=false，幂等重放一致，无高级执行、新可用性观测或 T3 回执。已读取分析任务 fixed-wsgs-stop.txt 核对。API/Worker 已停止，未激活。不以主 Gateway 的 23 个 STOP 替代该轮 WSGS 业务验收，不重复发请求凑通过。

本地代码核查：parseWithModelBudget 从原截止时间剩余额度中保留 min(30 秒, ceil(remaining/2))，模型预算约为 remaining-30 秒；Promise.race 与 AbortController 在预算耗尽时立即结束等待。适配器各次传输、响应读取、校验修复和退避共用同一控制器，没有为每次重试重新分配 120 秒。MODEL_REQUIRED 不允许静默跳过模型。

因此本轮可确认的性能边界是：模型阶段在约 90 秒内未产出通过校验的语义结果。不能由此确认是单次推理、服务排队、网络/响应读取，还是输出校验后重试。此前另一个任务 29.807 秒成功及旧任务单次 91.995 秒成功显示耗时变化，但不能替代最新失败的尝试级证据。当前模型调用为非流式；没有请求侧首 token、服务端排队和推理分段计时。预算先结束时，外层错误也可能先于适配器失败回执返回，因此不能以缺少成功 model_receipt 推断未发请求或只有一次尝试。

下一步精确归因需要同一请求的脱敏尝试级耗时、HTTP 状态/校验错误码及模型服务端请求关联与排队/生成指标；不需要原文、模型输出正文或 API key。当前没有足够证据指定模型服务内部根因，保留外部服务延迟/输出质量待区分的限制，不更换模型、不延长 deadline、不关闭必需模型策略。WSGS 全链路验收继续未通过，诊断实例保持停机。
