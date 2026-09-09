# 剩余功能问题：原因与修复方案

日期：2026-09-08。范围仅功能问题；本轮复核代码及已保存现场证据，没有重新启动实例或调用模型，没有执行认证相关测试。车辆按 GOWM 稳定设备引用 namespace/kind/id 识别，版本不参与同设备判定；该修复已通过新 MAP/STOP 任务，不再列为阻塞。

## 1. CROSS：中间节点输出预算不足，高可信原因尚缺失败响应闭环

现场任务 grounding-44c04744-8f85-4fed-8bf5-80ba587a089e 在 map-match 返回 HTTP 413，后续 CROSS 节点未执行。

代码链路明确：生产模块把请求 maxResultBytes=1048576 作为查询 maximumOutputBytes；query-compiler 的 weightedAllocation/boundedAllocations 按权重分配。CROSS 的 MAP、CROSS 两节点权重相同，MAP 只分得 524288 字节。executeOperation 再取调用方、节点和能力限制的最小值。map-matching Provider 在 analyzed.outputBytes 超过该预算时抛出 BUDGET_EXCEEDED。

同轮独立 MAP 的输出为 967772 字节，超过 CROSS 首节点的 512 KiB。这支持预算不足判断，但不是 CROSS 失败响应的实测大小。失败记录没有保存稳定上游错误码及实际超限维度，不能仅凭 HTTP 413 排除其他预算拒绝。

修复顺序：

1. 先保存分析计划、每节点预算、阶段、操作名、任务 ID、HTTP 状态及白名单错误码。不得保存原始错误正文或改写上游输出/哈希。
2. 明确公开结果大小与内部分析证据预算的契约含义。若现有契约允许内部独立预算，增加有上限的内部总预算及单节点预算，编译和执行共同使用；公开结果仍遵守调用方 maxResultBytes。若契约要求所有节点累计输出受调用方预算约束，则保持该约束，通过正式 Provider 契约提供精简的中间结果或减少合法查询范围，不能私自扩大预算。
3. 不以修改两节点权重或把 1 MiB 直接复制给每个节点作为最终修复：前者仍可能挤占后续节点，后者可能超出累计约束。
4. 用真实有效快照执行 MAP→CROSS，记录两节点回执、预算和输出大小；检查 CROSS 事件内容。新增大中间结果、小公开结果及真正超限的功能回归。

责任边界：WSGS 编译器、执行器及诊断；如需精简上游中间结果，则涉及 GOWM/GSAP 正式契约。

## 2. RANK：已到指标筛选阶段，尚未证明物理缺数据

新任务 grounding-e2660ccf-8453-4bb9-8ac6-f6d82659386a 已正常输出 METRIC_RANKING/NO_DATA，Provider 原因 NO_METRIC_SAMPLES，候选数 0。不是车辆版本问题，也不再是 RANK 计划不可用。

GSAP metric-series 的 NO_METRIC_SAMPLES 表示筛选后没有序列。真实读取路径同时限制：数据域、设备稳定引用映射、capturedAt 可见性、轨迹 requestedPeriods、observedProperty、measurementStage（默认 NORMALIZED）、可选单位与明确指定的序列，以及 NUMERIC/非空数值。设备关联使用 subject_id 或截至快照时有效的 DECLARED/CONFIRMED binding，不比较车辆版本。

因此只能确认“当前请求与快照下无合格指标序列”，不能推断整个数据库没有通信指标。

修复/诊断顺序：

1. 从仍有效且哈希验证通过的检查点提取实际指标选择器、时间窗和快照时间；若已按保留策略清理，使用新任务，不恢复或伪造旧检查点。
2. 对同一冻结条件做只读分层计数，定位在哪一步从非零变零：设备与时间窗 → 快照可见性 → 属性 → 阶段 → 单位/序列 → 数值有效性。只输出计数和稳定原因，不导出测量内容。
3. 若 WSGS 指标概念映射错误，按正式指标目录修复映射；若 GOWM 标准化/设备绑定遗漏，修复其数据处理路径；若该窗口实际无样本，保留 NO_DATA，并选择已有真实数据窗口做正向验收。不得混用 RAW/NORMALIZED、跨快照取新数据或人为造数。
4. 正向验收要求非空候选、指标序列证据和时间位置对齐可核对；另保留无数据功能用例。

## 3. GDPS：NO_DATA 的具体分支尚未记录，验收脚本只验证无数据传播

任务 grounding-e6a33976-5d97-4675-b51f-0ca410619c61 中 world.get-current-state 成功，landcover.get-class 有真实 NO_DATA 回执，公开 unknowns 正确传播。此前维度/Schema 适配问题不能继续作为当前失败原因。

GDPS 代码至少存在不同的无数据来源：无可选 current 产品、指定产品覆盖不足、像元 NO_DATA_AT_LOCATION。当前报告只保留统一状态，尚不能区分这些分支，也不能断言全部地表产品缺失。

方案：记录稳定领域原因码；只读核对当前实际查询点的坐标参考系、产品类型/profile、产品覆盖范围和像元有效性，再按证据修复 WSGS 选择器或 GDPS 产品发布/覆盖配置。若实际点确无覆盖，保留 NO_DATA，并从既有产品覆盖范围中选择真实有效点验收，不修改上游业务数据。

## 4. 追问：生命周期预算短，加上测试编排延迟

STOP 新任务 grounding-e854e9ff-9015-4e5d-963a-7a844da22380 已生成 23 个事件及有效选择。结果落盘于 13:54:23.425Z，choice.validUntil 为 13:54:30.188Z，只剩约 6.8 秒。

生产模块 assembleProductionWorldAnalysis 使用 LOAD_CONTEXT.startedAt + 60000 作为 validUntil，而不是结果完成时间。前面的模型和分析耗时会消耗选择有效期。prior-grounding 同时检查存储结果、选择、finding 和引用产品的有效期；执行阶段还会再次检查选择。脚本随后串行执行约 81 秒的 RANK，必然错过 STOP 选择。

兼容修复：STOP 完成并获得选择后立即提交追问，再执行 RANK；记录提交、校验、执行与失效时间。检查明确 choiceId/candidateId 的选择是否能通过既有确定性路径复用，避免不必要的模型轮次，但不能绕过契约要求或有效期检查。增加临界有效期的功能回归，分别区分“提交时已过期”和“执行前到期”。

若保留现有处理流程仍无法在剩余窗口内完成，应报告为有效期政策与耗时不匹配。改为完成后起算或延长 TTL 会改变此前确认的规则，作为独立政策调整，不纳入本次默认修复。

## 5. 验收脚本缺少正向业务断言

real-wsgs-instance-gate.mjs 当前 GDPS expectation 固定为 NO_DATA；其他分析只要求操作存在、无 BLOCKING gap，没有要求排名候选或 CROSS 事件存在。这会把“无数据语义通过”与“正向业务通过”混淆；已有报告虽已如实区分，脚本也应明确区分。

方案：按用例定义预期的数据条件，分别记录调用链、Schema、幂等、领域状态和正向业务结果；RANK 正例要求非空排名，GDPS 正例要求有效类别，CROSS 正例要求真实事件及两节点证据。缺少适合的现场数据标为受阻，不以 NO_DATA 或 fixture 替代。取消测试入口应与现有认证负例拆开，遵守用户仅测功能的范围。

## 执行优先级与完成标准

1. 先补稳定错误/预算证据和正向验收断言，修正追问编排。
2. 处理 CROSS 的预算契约与中间结果大小；并以只读分层计数确定 RANK/GDPS 根因后修复对应层。
3. 跑受影响功能回归，再用新任务验证 CROSS、RANK、GDPS、立即追问，并回归 MAP/STOP。涉及持久化与恢复的变更使用一次性真实 PostgreSQL 测试。
4. 继续只测功能，不运行认证专项。诊断候选结束后停止 API/Worker，保留真实 PARTIAL/PROVISIONAL、原截止时间及生产资格。

本轮只完成原因复核与方案，没有宣称新增现场通过，也没有修改预算、TTL 或业务代码。现场来源与新任务完整证据见 functional-verification-2026-09-08、device-identity-fix-2026-09-08 两份报告。
