# WSGS 当前功能落实审计（2026-10-13）

已将 `codex/wsgs-v0.2.4-stable-world-analysis-service` 从 `00f6625` 快进到远程最新 `0c00de5c0f45f591c2986544e0902b84038a1537`，包含 `1ad2a02` 和 `0c00de5` 两次更新。本地统一部署打包改动及消费者快照已恢复；六份 N03 报告冲突采用最新分支内容，随后实际重跑对应 120 项测试，刷新至合并后的包清单输入。更新前全部本地修改保留在备份 stash `8ed91c714d600ca4f0192e8b37baa048dc6ad484`。

当前已有实际历史查询、道路/事件/指标分析、受信选择、计划持久化和数据库恢复实现；上一轮修复和复合分析确实已经进入代码。本次仍确认 **5 项实现或集成缺口**，另有明确未支持的能力及现场验收不足。以下缺口用当前真实函数、本地合成基础和受控 fetch 复现；未执行新的真实模型、服务器业务查询或 SACS 联调，不据历史报告断言远端当前仍有某个故障。

## 当前实现和集成缺口

| 编号 | 优先级 | 功能 | 当前复现和影响 |
| --- | --- | --- | --- |
| A01 | P1 | 高级追问的阶段范围与重新查询 | 先问“2号车经过哪些道路，排除暂停”，再问“包含暂停，重新查询经过哪些道路”，仍解析为 `ACTIVE_PHASES_ONLY`；旧式高级追问还返回 `reusableFoundation=true`、`compare=false`。不能落实用户切回包含暂停的明确条件。 |
| A02 | P1 | 多主体/多执行批次的完整拒绝 | “2号车、3号车经过哪些道路”被接受，只保留 2 号车；“第1次任务、第2次任务经过哪些道路”被接受，只保留第 1 次。当前本应拒绝这类跨范围请求，而不是截取其中一个范围。 |
| A03 | P2 | 复合请求中未支持子句的反馈 | “2号车经过哪些道路，以及行驶是否超速”被接受为单一道路分析，没有超速子句，也没有该子句的缺口。进入高级规划后直接返回该分析计划，普通语义需求规划不会补齐这一段。 |
| A04 | P2 | 目标名称中的分析关键词 | “2号车首次进入停车区是什么时候”被拒绝为 `MULTI_ANALYSIS_NOT_SUPPORTED`。“停车”来自区域名称，却被当作第二个 STOP 意图；支持的单一 ENTER 查询无法正常进入目标解析。 |
| A05 | P2 | 统一部署入口的高级能力自检 | 本地统一入口仍只检查 `/health/ready` 与默认 `/v1/capabilities` 的 HTTP 状态。受控状态下 CROSS 不可用，旧探针仍通过；最新 `verifyDevelopmentRuntime` 正确拒绝。单独的 `deploy-dev.py` 已接入新探针，统一入口尚未同步。 |

P1 优先处理查询范围正确性；P2 处理请求覆盖和交付自检。这些级别不替代生产资格判定。

### A01：普通历史已修复，高级追问的反向切换仍遗漏

[高级意图范围继承](/home/sz/code/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:53) 先合入旧 scope，只有“排除暂停”等表达会显式改为 ACTIVE；“包含暂停/整个执行时段”没有反向覆盖。普通历史 `resolveHistoricalFollowup` 已有 EXECUTION_ENVELOPE 的反向规则，高级路径没有复用。

[旧式高级追问](/home/sz/code/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-followup.ts:204) 的 compare 只识别“更新了吗/有更新”；同文件公开 Choice 分支则识别“重查/重新/refresh”。复现表明，重新查询表达在旧式分支也没有统一处理。[生产高级执行](/home/sz/code/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3946) 会消费通过复用校验的旧基础。公开 Choice 路径即使因“重新”触发重查，解析出的阶段仍错误保持 ACTIVE。

最小处理：普通与高级路径共用完整阶段切换和刷新语义；明确包含暂停时切回 EXECUTION_ENVELOPE，范围变化强制重新解析轨迹。补“ACTIVE → ENVELOPE”及普通 prior/公开 Choice 两条路径的回归。不得延长旧引用租期。

### A02：范围校验只在识别出多个分析时运行

[advanced-intent.ts](/home/sz/code/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:31) 仅在 `analyses.length > 1` 时检查多个主体、任务、批次。两个主体共用一个“道路”谓语时只生成一个 analysis，跳过该检查。全句主体和批次投影只取首次匹配，复现分别剩下首主体和第 1 次执行。

[生产主体绑定](/home/sz/code/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:1496) 按已经选出的单一 mention 过滤引用，不能依赖后续阶段自动恢复被丢弃的范围。此次证明的是实际解析结果和使用分支；没有伪称完成这两种请求的新公开 HTTP/现场复测。

最小处理：在任何单一高级分析被接纳前，独立检查完整请求中的主体、任务和执行批次数量。当前单执行能力应给出明确范围缺口；未来支持聚合时再增加多基础与对应预算/来源契约。

### A03/A04：复合分析已实现，子句与实体语义覆盖仍不足

[子句处理](/home/sz/code/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:24) 对未识别的子句直接忽略。该行为也用于正常的主体或修饰语，因此修复不能简单地把所有未匹配文本都当错误；应区分上下文修饰和独立未支持的问题。[高级规划](/home/sz/code/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3580) 接纳后返回 `graph=null`、空常规 recipe，不再运行普通需求规划。

[分析类型计数](/home/sz/code/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:69) 在原始子句全文上匹配停车、进入、离开等词，没有排除目标名称；“停车区”因此造成单意图误判。最小处理是结合已验证语义帧和实体 span，保留每个独立问题的执行结果或未支持原因，并避免从已绑定实体名称中再次推导分析动词。

此次正向控制成功解析了 ENTER A区、EXIT B区、DWELL C区、ROAD、RANK 五个分隔子句，不能把上述边界问题写成“复合分析全部没实现”。多指标独立分析也已支持，尚不等于联合评分排名。

### A05：统一入口未同步最新独立部署探针

[统一 smoke](/home/sz/code/world-semantic-grounding-service/deployment/deploy-unified.mjs:228) 的实际 JavaScript 探针已在受控 fetch 上运行。基础 HTTP 都为 200、普通 requiredCapabilitiesReady 为 true、1.2 CROSS 为 false 时，旧探针成功；同一输入经 [新验证器](/home/sz/code/world-semantic-grounding-service/validation/scripts/verify-development-runtime.mjs:14) 返回 `DEVELOPMENT_ANALYSIS_CAPABILITIES_UNAVAILABLE CROSS`。

最小处理：统一入口复用包内新验证器，协商 1.2、校验能力 Schema/租期/六项能力，并保留 `businessAcceptance=NOT_RUN`。这只补能力就绪判断，不能替代真实业务验收。

## 明确仍未支持的能力

| 能力 | 当前边界与原因 |
| --- | --- |
| 任意绝对/相对历史时间窗 | 返回 `HISTORICAL_TIME_WINDOW_UNSUPPORTED`。当前 GOWM 轨迹与执行区间 Schema 的 `additionalProperties=false`，字段只有执行选择、阶段和来源等，没有时间窗输入；需要上游版本化契约及引用范围语义。 |
| 跨执行批次/跨任务轨迹及聚合分析 | 普通轨迹与高级分析只消费一次执行；ALL 被明确拒绝。分隔的多个分析共享一个基础，不是多个任务或批次的分析。A02 是这个边界没有全面拒绝的独立缺陷。 |
| GNSS 质量、振动及多指标联合评分 | 默认目录只有 RSSI、丢包率、时延。定位质量/振动返回 `METRIC_CONCEPT_UNSUPPORTED`；同一指标解析里的“信号和丢包率最好”返回 AMBIGUOUS。独立生成两个排名已支持，但没有联合权重/交集评分排名。新的单指标可用性仍依赖权威上游 scalar 映射和有效目录。 |
| 普通 priorGrounding 的严格 PINNED 重放 | 当前锁中 `reference.validate`、`result.validate` 为 CONSISTENT_AT_START；[生产保护](/home/sz/code/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:1022) 要求 PINNED，因而返回 `PINNED_VALIDATION_OPERATION_UNAVAILABLE`。这不否定已经实现的 GET/幂等字节重放或受信分析 Choice 追问。 |

ACTION_TARGET_CANDIDATE 仍是历史位置候选，`executionAuthorized=false`；路线规划、设备执行、任务下发、直接读取 MQTT/XODR 不属于 WSGS 当前承诺。开发免用户访问的 STATIC_TRUSTED 也是既定部署方式，不作为账户系统遗漏。

## 已实现但尚未形成现场与交付闭环

- 当前复合分析、完整性保持、任务独立主体接纳、Choice 装配后起算且受源租期限制、纯编译计划持久化和隔离 PostgreSQL 测试均有实现及回归，不重复列为旧缺口。
- 最新代码的真实 SACS→WSGS→模型→GOWM/GSAP 整链、CROSS 正向事件、非空 RANK、GDPS 正向产品、真实慢模型后的即时选择追问没有新现场证据。[最新修复报告](/home/sz/code/world-semantic-grounding-service/reports/function-realization-round2-2026-10-11/README.md:3) 仍明确 NOT_RUN。2026-09 的 TRACE/MAP/STOP 证据应保留，但不能替代当前版本验收；也不能据旧的 HTTP 413/NO_DATA 推断服务器今天仍故障。
- 现场断言脚本已补非空候选、真实事件和 NO_DATA 与业务成功分离；缺口是尚未跑通当前版本的真实正例，而非断言脚本仍只有 HTTP 200。
- 当前 GDPS v0.2.1 台账为 9 PASS / 318 NOT_RUN，整体 BLOCKED；完整 v0.2 台账为 195 PASS / 17 NOT_RUN / 67 BLOCKED。台账数量说明证据覆盖边界，不能直接解释为有 318 个功能未实现。
- 现有 10 月 10 日统一部署包清单仍记录 WSGS 提交 `00f6625`，`siteAcceptance=NOT_RUN`；未包含 `1ad2a02` 和 `0c00de5` 的修复。需要同步 A05 后重新生成、核验并部署候选。本次任务没有重打包或上线。
- [14 项生产延期工作](/home/sz/code/world-semantic-grounding-service/acceptance/production-deferred.csv:2) 仍包括外部 IdP/密钥轮换、完整故障矩阵、HA、PITR/RPO/RTO、SLO/容量、大对象存储与压力验证。当前一次性 PG 集成测试不能把这些项目自动升级为已完成。

## 本次验证与建议顺序

实际执行 `npm run typecheck`、`npm run findings:provenance:write`、`npm run check`、`npm run test:postgres -- postgres:17-alpine` 及本目录 `probe.mjs`。完整检查 1177 项通过、49 项默认跳过；另外四套一次性 PostgreSQL 测试 12 + 3 + 32 + 2 = 49 项全部通过、无跳过。容器使用预先存在的 PostgreSQL 17 镜像、回环随机端口和 tmpfs，只删除脚本自己创建的容器；没有使用现有业务库或服务环境。

检查通过没有覆盖本次发现的边界输入。源代码定位和组件复现是缺陷证据；数据库测试通过证明其集成用例，不证明服务器故障恢复矩阵或真实业务数据分析。

复现入口：`node reports/function-realization-audit-2026-10-13/probe.mjs`。观察输出为 [probe-output.json](probe-output.json)，运行摘要为 [verification.json](verification.json)，完整检查与数据库日志分别为 [check-output.txt](check-output.txt) 和 [postgres-output.txt](postgres-output.txt)。

建议先修 A01/A02 的范围正确性，再补 A03/A04 的子句和实体语义；同时同步统一部署自检，重新打包后以授权的真实上下文完成 CROSS、非空 RANK、GDPS 和多轮选择正向验收。自由时间窗及多基础聚合另需上游契约协作，不在 WSGS 中伪造实现。
