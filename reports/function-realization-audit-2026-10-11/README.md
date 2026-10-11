# WSGS 功能落实审计（2026-10-11）

审计基线：`00f66257c601e128d8cc6ab6957183f78139dfbf`。核对当前源码、公开契约、部署入口、验收脚本和仓库内历次现场证据。当前项目有真实的解析、查询、持久化和分析消费实现；主要问题是部分请求条件没有落实到查询、不同执行分支修复不一致，以及业务验收没有形成完整闭环。

本次确认 **7 项实现或使用缺口**。前 6 项有本地组件复现，第 7 项由实际编译分支确认。复现采用合成输入和已提交的 Provider fixture，不访问服务器、模型或业务数据库。远端 2026-10-11 的运行状态未核验；下文现场证据均标明其原日期，不能据此断言服务器现在仍有同一故障。

## 实现和使用缺口

| 编号 | 优先级 | 功能 | 当前实际行为与影响 |
|---|---|---|---|
| F01 | P1 | 普通历史追问的范围校验 | 完整性/缺口追问只检查旧引用是否过期，未比较车辆、任务、执行次数、阶段。要求排除暂停，或改问另一车辆第 2 次执行，仍可直接复用第 1 次的旧轨迹。 |
| F02 | P1 | 自由时间窗历史查询 | 指定 ISO 起止时间后，普通历史和高级分析的 intent 均与未指定时间时完全相同。实际仍按 LATEST/指定执行次数及整个执行阶段查询，没有落实用户给出的窗口，也没有明确拒绝。 |
| F03 | P1 | 只给任务的高级分析主体补全 | 基本轨迹新鲜执行已补主体接纳；高级分析在另一分支返回，未复用该修复。只有任务产品、没有 WORLD_OBJECT 产品时，已返回的有效道路分析仍被公开投影以 REFERENCE_MISSING 拒绝。 |
| F04 | P1 | 可用的多轮选择生命周期 | Choice/Finding 的截止时间为 LOAD_CONTEXT.startedAt + 60 秒。模型和分析会消耗该窗口；模拟处理 72 秒后，真实装配函数仍输出已过期 12 秒的 Choice。后续选择按契约会被拒绝。 |
| F05 | P2 | 复合高级分析请求 | 使用一个 analysis 和 if/else 优先级选分支。“进入 A 区、离开 A 区、停留多久”只生成 DWELL，没有 ENTER/EXIT，也没有提示这些请求未被执行。 |
| F06 | P2 | 能力发现与执行开关一致性 | HISTORY=YES、ADVANCED=YES、ALLOW_PREVIEW=NO 时，发现路径允许 HISTORICAL_TRACE，普通历史规划却报 HISTORY_CAPABILITY_DISABLED。契约与上游均有效时也能出现此差异。 |
| F07 | P2 | 高级分析仅编译的成功路径 | COMPILE_WORLD_QUERY 进入高级分析分支后始终返回空 compiled 和基础缺失/开关 gap；没有使用已加载可信基础进行成功编译的分支。执行模式中的实际分析编译在后面的 GOWM_EXECUTE 内完成。 |

P1 表示应先处理的结果正确性或实际可用性问题，P2 表示后续完善；这些优先级不代表生产资格评定。

### F01：追问可以把旧结果套到新范围

[intent.ts](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/intent.ts:92) 在完整性或缺口请求上直接 REUSE；同文件 108–109 行的 REQUERY 分支还无条件写入 prior 的任务/主体引用。生产 [历史复用分支](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3899) 直接返回旧 Finding，不再调用上游。

本地复现：`排除暂停后，这段轨迹完整吗？` 返回 REUSE，旧范围仍是 EXECUTION_ENVELOPE；`3号车第2次任务这段轨迹完整吗？` 也返回 REUSE，旧轨迹是另一车辆第 1 次执行。该项定位于普通历史追问函数及其加载到旧历史证据后的执行路径，未冒充已完成 1.2 公共 HTTP 多轮复测。

最小处理：复用前比较完整查询范围；车辆、任务、执行次数、阶段或源改变时重新查询。仅在新请求省略对应对象时继承 prior，明确对象不能被旧引用覆盖。增加“范围改变 + 完整性/缺口”的组合回归。

### F02：时间条件有表达结构，没有历史执行落点

[HistoricalTraceIntent](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/types.ts:25) 仅有执行选择和 phaseScope，没有自由时间窗；[普通 intent 投影](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/intent.ts:60) 和 [高级 intent 投影](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:17) 都不消费时间约束。历史 [执行器](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/executor.ts:144) 只传执行选择和阶段范围。

本地复现：分别给轨迹、通信排名追加 `仅限2026-09-01T08:03:00Z至2026-09-01T08:04:00Z`，所得 intent 与不追加时完全相同。2026-09-09 的 [成功轨迹验收](/home/zhouwen/web-download/world-semantic-grounding-service/reports/historical-subject-fix-2026-09-09/README.md:40) 也明确只覆盖 LATEST + EXECUTION_ENVELOPE。

最小处理：先对无法落实的明确时间条件返回现有 typed gap，防止静默扩大查询范围；再根据 GOWM 实际契约补时间窗绑定、交集语义、时区与边界校验。不能把返回后的局部裁剪当作上游已按窗口分析。

### F03：主体修复没有覆盖高级基础查询

[高级执行返回](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3895) 只在存在公开 prior authority 时带回其引用产品；[主体接纳](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3969) 位于其后另一历史分支。公开 [base 投影](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/public-world-analysis.ts:94) 正确要求存在主体产品，因此不能靠基础结果中出现 actor key 就直接发布 Finding。

本地复现：同一个通过契约验证的道路 fixture，带已接纳主体时输出 HISTORICAL_TRACE + ROAD_ASSOCIATION；删除主体产品、保留任务/区间/轨迹时输出 0 Finding 和两个 REFERENCE_MISSING。结合上述执行分支，可确认任务独立高级入口遗漏接纳。此项不是否定 2026-09-09 基本轨迹修复。

最小处理：把任务 actor 归属、主体获取和 reference.validate 接纳结果作为共享历史基础阶段输出，普通和高级执行都消费它。保留任务快照及历史版本；继续拒绝跨范围、错误主体和失效验证，不用裸 actor key 绕过校验。

### F04：60 秒策略与慢分析耗时不匹配

[resultDocument](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:2133) 从 LOAD_CONTEXT 起算；[选择校验](/home/zhouwen/web-download/world-semantic-grounding-service/packages/prior-grounding/src/validator.ts:97) 按 Choice/Finding/相关引用有效期拒绝过期选择。2026-09-08 的 [真实 STOP 验收](/home/zhouwen/web-download/world-semantic-grounding-service/reports/device-identity-fix-2026-09-08/README.md:34) 已记录返回后只剩约 6.8 秒，后续追问 NOT_RUN。

这是使用缺口，也涉及现有有效期政策；不能为了验收通过而直接延长旧结果租期。最小步骤是结果返回后立即发起追问，并评估是否可走已有可信选择的确定性路径，避免重复语义模型耗时。如要改成完成后起算，应单独调整政策，并以源引用/证据有效期作上限，GET/重试不续期，过期源仍重新验证或查询。

### F05：复合问题没有完整执行或明确拒绝

[advanced-intent.ts](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts:20) 只保存一个 analysis，37 行用 STOP → DWELL → ENTER → EXIT → PASS_NEAR 优先级取一种事件。模型即使理解多个意图，这一执行投影仍只取其中一个。

最小处理：先检测多意图，明确返回需要拆分的现有 gap；若产品要一次回答多个问题，再在总预算内拆成独立固定 recipe，保留每个问题对应的结果或缺口。不能把仅做 DWELL 的结果视为整句完成。

### F06：同一能力使用两种启用表达式

[发现路径](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:901) 使用 `history && (preview || advanced)`；[普通历史规划](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3551) 使用 `history && preview`。本地用精确匹配的受控操作元数据复现前者 available=true、后者 CAPABILITY_GAP。

最小处理：把历史能力启用和授权规则抽成共享判断，由发现、规划、锁选择统一调用；验证三个开关的组合。既有高级功能的精确 PREVIEW 授权仍须保留，不能全局放开无关能力。

### F07：高级仅编译没有成功分支

[WORLD_QUERY_COMPILE](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts:3668) 只构造空 compiled，然后对 COMPILE_WORLD_QUERY 直接返回 gap。缺乏基础时拒绝隐藏读操作是正确边界，但已有可信基础时也没有成功处理分支。本项由源码确认，未做新的公开 HTTP 复现。

最小处理：无可信基础时保持 gap；有仍有效、范围匹配的 server-owned foundation 时复用现有编译器，输出实际计划并保持零执行调用。补成功/缺基础/过期基础的仅编译回归。

## 实现已有，但验收和交付闭环不足

1. **正向现场业务覆盖不足。** 仓库已有真实 MAP、STOP 和基本 HISTORICAL_TRACE 成功证据，应承认其已落地；同时保留 PARTIAL、PROVISIONAL 和数据缺口。RANK 的既有现场结果是 NO_DATA/0 候选，GDPS 在该开发实例验证的是 NO_DATA 传播；不能推断所有上游数据库都没有数据。CROSS 的既有失败是 HTTP 413，未在本仓找到其后正常 WSGS 路径的正向闭环证据。当前远端需新证据才能判定状态。
2. **验收脚本缺少正向业务断言。** [real-wsgs-instance-gate.mjs](/home/zhouwen/web-download/world-semantic-grounding-service/validation/scripts/real-wsgs-instance-gate.mjs:91) 把 GDPS 预期固定为 NO_DATA；其余分析 98–100 行主要检查 operation 存在、无阻塞 gap、Schema 和幂等，没有逐用例要求正确 Finding、非空排名或 CROSS 双节点/事件证据。应把调用成功、无数据传播、正向业务分别判定，不能以总 PASS 替代真实有数据验收。
3. **GDPS 验收台账过时。** [台账](/home/zhouwen/web-download/world-semantic-grounding-service/reports/wsgs-v0.2-gdps-v0.2.1/acceptance-ledger.json:15) 仍记“缺三个文件”，1 PASS / 326 NOT_RUN。本次核验九个必需文件均存在，intake --check 已通过：30 operations、34 productTypes、35 profiles。旧缺文件原因不能再当当前实现缺陷；当前需要建立与新交付匹配的证据映射和验收记录，不能直接把 326 项补成 PASS。
4. **一键部署的高级就绪验证不足。** [deploy-dev.py](/home/zhouwen/web-download/world-semantic-grounding-service/deployment/deploy-dev.py:102) 只检查 `/health/ready` 与默认 `/v1/capabilities` HTTP 成功，没有协商 1.2 并核验启用的分析能力。由于高级 Provider 对普通 readiness 是可选依赖，脚本打印 ready 不等于高级分析可用。应在启用高级功能时校验相应能力快照，并分开报告服务就绪和业务验收。
5. **生产运行能力仍延期。** [production-deferred.csv](/home/zhouwen/web-download/world-semantic-grounding-service/acceptance/production-deferred.csv:2) 列有 14 项：外部 IdP/密钥轮换、完整故障恢复矩阵、多节点 HA、PITR/RPO/RTO、负载与 SLO、大对象存储及压力验证等。它们确实尚未完成，但没有冒充开发阶段已经具备。

## 已完成或明确边界

开发环境免用户/免注册/免验证采用 STATIC_TRUSTED，符合用户既定要求，不是账户系统遗漏。此次环境模板检查确认 128 个运行时/Compose 配置项有模板和说明。

明确任务类型纠正、任务索引修复交接、普通新鲜历史等待 gap、普通新鲜轨迹主体接纳，以及车辆逻辑身份与历史版本区分已有源码及证据。它们不应作为“当前全部未实现”重新列项。

多次执行轨迹/跨任务高级聚合目前明确拒绝；默认指标目录只含 RSSI、丢包率、时延，速度、GNSS 质量、振动综合排名没有提供。这些是能力范围限制。当前路线规划、设备执行、任务下发和自行读取 MQTT/XODR 不属于本服务承诺；ACTION_TARGET_CANDIDATE 仅是候选且 executionAuthorized=false。

## 本次验证与建议顺序

本次验证：TypeScript 项目检查通过；5 个相关测试文件 **226/226** 通过；`npm run config:check` 通过；GDPS intake `--check` 通过；6 类最小组件复现完成。未运行完整仓库测试、真实数据库恢复矩阵或新的服务器业务验收。

复现入口：[probe.ts](/home/zhouwen/web-download/world-semantic-grounding-service/reports/function-realization-audit-2026-10-11/probe.ts)，观察结果：[probe-output.json](/home/zhouwen/web-download/world-semantic-grounding-service/reports/function-realization-audit-2026-10-11/probe-output.json)。执行命令：

```bash
node --import tsx reports/function-realization-audit-2026-10-11/probe.ts
```

建议先修 F01 的错误复用、F03 的高级主体接纳，并对 F02 不支持的时间条件明确拒绝；随后统一 F06 开关，解决 F04 的可用追问窗口和 F05 的多意图处理，再补 F07 成功编译路径。现场验收脚本先补业务断言，再用授权真实上下文验证 CROSS、非空 RANK、GDPS 正向数据和立即追问。所有结果继续保留真实完整性、范围和版本语义。
