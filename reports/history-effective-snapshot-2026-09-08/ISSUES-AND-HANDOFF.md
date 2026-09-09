# 剩余问题与修复分工（2026-09-08）

本清单基于本次真实现场验收，不代表通知发出后服务器状态。详细证据见同目录 README.md、acceptance.jsonl、acceptance-classification.jsonl、world-queries.jsonl、gateway-nodes.jsonl 和 worker-*.jsonl。

## 1. 历史轨迹 Provider 执行失败（GOWM 主责）

- 操作：history.get-trajectory；Provider：gowm.historical-trace；Gateway 返回 PROVIDER_NOT_READY，详情阶段 PROVIDER_EXECUTION、retryable=true。
- TRACE：grounding-f94dc570-0a5e-4a82-8886-b7ff2d19334a，对应 query_job_954c38557ac64edb85cf4a8347ac0eb7。
- MAP：grounding-7dd1ba11-adba-4d57-b6ad-de7659725c83，对应 query_job_19e2813e58d34d22a17c0350be2e6a3e。
- CROSS：grounding-6c852453-6325-4283-8c7c-9a757d28d8b0，对应 query_job_c7416712ce9140369a6c0fc473b102b2。
- 三个任务的区间节点均 PARTIAL / OPEN_EXECUTION，快照 MATCHED，检查资源数 5；轨迹无成功回执。容器 healthy 不等于业务执行可用。
- 最后分类复测 MAP：grounding-3686575b-fddc-4c10-9f4f-dd01c7dfa5b9，59.1 秒返回 PARTIAL + BLOCKING UPSTREAM_FAILURE，Schema 与幂等字节重放通过。内部为 HISTORICAL_UPSTREAM_UNAVAILABLE；旧的 SNAPSHOT_ADHERENCE_FAILED 汇总不再是最新分类。
- 已修复的 WSGS 问题：直接操作缺有效快照的 422、轨迹参数误绑定整个请求 Schema、Provider 不可用误分类。不得回退直接操作或放宽 GOWM 快照校验。
- 待定位：Provider 原始受控异常/SQLSTATE、读连接池、as-of 查询、正式迁移及角色授权、冻结投影入队依赖和运行镜像/正式包一致性。上述是排查方向，尚未证实具体数据库原因。
- 验收：用真实 Gateway→Provider→PostgreSQL 链路证明区间和轨迹均收到有效快照；有数据时提供轨迹回执/哈希/引用，无数据时准确返回域状态，不能把 healthy 或 PARTIAL 当业务成功。

## 2. STOP 达到截止时间（分析 Provider 任务主责定位）

- grounding-4993e0e1-3b04-47f8-b896-36d41606e9b7：120605ms，FAILED / WORKER_DEADLINE_EXCEEDED；公开 stage=PERSISTENCE；幂等重放一致，没有历史 World Query 执行记录。
- 公开 PERSISTENCE 是错误信封中的阶段，不能直接证明数据库耗时；也没有证据证明 GSAP STOP 算法或模型单独占用了全部时间。
- 需关联阶段事件/检查点、模型请求与回执、Gateway 提交和 Provider 调用，给出耗时分解；定位后修复对应等待、重试或执行问题。禁止用延长原 120 秒截止时间掩盖原因。

## 3. RANK 基础计划不可用（分析 Provider 任务主责，GOWM 配合）

- grounding-e10d4f1c-bfeb-4827-8e22-4486f3f4abe7：74076ms，PARTIAL；FOUNDATION / HISTORICAL_QUERY_NOT_REGISTERED；未生成 World Query，T4 未执行。
- 错误发生在历史基础计划，而不是已执行的排名算法。不能直接断言 spatiotemporal-metric.rank-locations 未注册。
- 核对当次受理能力快照、operation lock、签名授权、maturity、availability、Schema/端口匹配及编译候选过滤。区分真实缺操作、版本/来源不一致、健康/熔断导致过滤及消费者选择问题。
- GOWM 提供能力发现/注册/健康的真实状态；分析任务核对 GSAP 正式注册表、排名与指标依赖闭包。跨仓问题明确回传责任边界，不并发修改对方仓库或部署同一实例。

## 4. T2/T3/T4 正向业务验收未完成（分析任务统筹复测）

- T2 MAP：被轨迹基础依赖阻塞，未获得道路匹配证据。
- T3 STOP：截止时间失败；CROSS：轨迹依赖失败，未取得时空事件证据。
- T4 RANK：基础计划未生成，未取得排名证据。
- BASIC 完成；取消成功；GDPS NO_DATA 传播及回执通过，但没有地表数据，不算正向有数据通过。
- GOWM 修复并提供正式包/镜像摘要后，再串行重跑 TRACE/MAP/STOP/CROSS/RANK，并回归 BASIC/GDPS/取消及可用情况下的追问。记录新任务、节点、快照哈希、回执和结果；保持 PARTIAL/PROVISIONAL/NO_DATA 的实际语义。

## 分工与交接

- 执行 GOWM 完整迁移 Goal：历史 Provider 根因和 GOWM 仓库内修复；核对部署现场正式迁移/权限/注册，交付可重复升级流程与来源摘要，向分析任务交接。
- 检查功能实现与项目遗漏：STOP/RANK 证据定位、分析仓库内修复及 T2/T3/T4 联调闭环；发现 WSGS 消费侧问题时回传本任务具体定位和证据。
- 两方先独立进行只读诊断及本仓修复；共享 sz-gowm 的部署由 GOWM 先完成并交接，再由分析任务联调，避免互相替换容器。
- 已验证基线：WSGS check 1015 项通过；一次性真实 PostgreSQL 48 项通过；真实 Gateway/Provider 受控边界 13 项通过。不能替代现场正向验收。
- 上次诊断候选 3b383bd92d792b38fb93，API/Worker Exited(0)，未激活。核对实时状态后再操作。保持原截止时间、主体身份刷新、快照/签名/授权校验、生产资格和延期清单；不重建业务数据、不伪造样本、不自动激活失败候选。
