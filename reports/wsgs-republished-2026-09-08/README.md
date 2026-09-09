# 重发布后 WSGS 实测（2026-09-08）

上游根目录：`/mnt/data/gowm-analysis-releases/9f19951ac4ad691e/gowm-gdps-analysis-dev-server-0.1.0`。本次刷新通过，消费者快照 `edfb07a91457a59dd927884d049b1cb84bc96dac8adff412ab1a2dcc85026472`。来源见 source.json。上次包不一致不再复现。

## 修复前现场证据

本次新任务的完整日志在 acceptance-before-fix.txt。旧库任务未用于本次通过判定。

- 签名 Gateway：158 能力/158 语义，契约一致；错误签名403、越权403。
- 新库19条事件均有actor。任务签名查询HTTP200/COMPLETED，actor不再为空。
- BASIC和GDPS返回合法PARTIAL，但没有Provider执行证据，不能算业务通过。
- MAP/STOP/CROSS/RANK均在前置上下文阶段阻断，没有调用相应分析算法。
- TRACE：120秒截止时间失败；检查点最后完成DETERMINISTIC_PARSE，不能将其归因于历史Provider。
- CANCEL通过，越权读取404，错误北向签名401。
- 任务reference.get返回版本5，而校验权威视图currentVersion为1、descriptorObjectVersion为空；即时校验仍STALE。车辆在持续更新，解析耗时增加了版本过期风险。
- 原WSGS关联函数将同一车辆的actor版本1与当前状态版本作相等比较，使用真实Gateway返回值可复现SUBJECT_TASK_MISMATCH。见task-gateway-probe.jsonl。
- 完整check：1004通过、47默认跳过。本次没有重新执行独立PostgreSQL回归，现场链路使用真实PostgreSQL。

修复前诊断候选40d9e1118c7bf8181162结束后API/Worker均退出0，没有激活。

## 按用户要求修复

WSGS负责主动解析车辆引用，不要求GOWM修改actor事件版本。关联只比较namespace/kind/id，原任务actor保持不变；版本不同时经授权Gateway取得车辆引用用于本次新查询。

新EXECUTE_WORLD_QUERY遇到STALE时，对WORLD_OBJECT和OPERATIONAL_TASK主动取得权威引用并重新校验，最多两轮；授权拒绝、缺失、过期不触发刷新，持续校验不通过仍拒绝。任务使用operational-task.get返回的实际引用。刷新前后引用存入检查点，不重写原文、任务快照或历史结果；带priorGroundings的执行和单独验证请求不自动解释为新版本。

## 修复后结果

- 完整 `npm run check`：1012通过、47默认跳过；定向两文件40通过。此轮没有重跑独立PostgreSQL回归套件，现场任务使用真实PostgreSQL，不冒称跳过项通过。
- Gateway 796文件与运行Manifest一致；签名目录158能力/158语义，错误签名403、越权403。
- 候选8afa40b20cac457b1f69，真实MAP任务 `grounding-7966141d-8f8d-4097-8a51-59e43f6d5c8e`。
- 引用主动刷新后，两者均VALID/revalidationRequired=false。实际操作依次为operational-task.get、reference.get、operational-task.get-execution-intervals；未再因actor版本不同拒绝。
- 任务最终PARTIAL，结果Schema及幂等字节重放通过，但业务仍失败：FOUNDATION阶段最后操作get-execution-intervals返回HTTP422，analysisEvidenceCount=0。具体见worker-after-fix.jsonl与checkpoint-after-fix.jsonl。
- 代码核查发现get-execution-intervals强制要求effectiveQuerySnapshot，WSGS该路径仍通过不附有效查询快照的直接操作调用。这是越过版本问题后暴露的独立快照调用适配问题，不能把本轮PARTIAL算成T2成功。
- BASIC/GDPS/TRACE/STOP/CROSS/RANK未在修复后全量重跑，其修复前失败不能倒填为通过。
- 诊断结束API/Worker均退出0，候选没有激活。生产延期事项与生产资格保持不变。

远端日志仅按白名单筛选阶段、错误码、操作名及任务标识后传回。完整日志传回方案被自动审批拒绝，未执行。

## HTTP422 与快照缺失的代码定位

这两条记录是同一故障的表现与原因。WSGS production-module.ts 的 foundationGateway（约3557行）无条件走 executeOperation，后者调用直接操作入口。Gateway app.ts 直接路由只传operation/request/principal；direct-execution.ts 仅从内部 trustedJobContext 取得 requestedSnapshot/effectiveSnapshot，所以该路径不会注入有效快照。World Query 的 query-plan-runtime.ts（约315行）才将查询协调器生成的快照注入调用上下文。

operational-reality-provider/src/provider.ts 第57–58行在调用 repository 之前检查 context.snapshots.effective；缺失时报 SCHEMA_MISMATCH，Provider SDK 将其映射为422。现场日志保留的是HTTP_422类别；上述根因由实际调用链与明确的源代码拒绝条件定位，并非日志中保存了原始异常全文。

WSGS advanced-executor.ts 将HTTP错误归为ADVANCED_HISTORY_UPSTREAM_FAILURE，advancedEvidence将非COMPLETED封装为PARTIAL并保留BLOCKING gap，因此Schema合法、幂等一致与业务失败同时成立。这里不代表地图匹配算法运行过。

修复应在WSGS把需要有效快照的历史基础操作接入正式World Query协调路径，让Gateway负责资源发现、快照捕获与证据校验。不能向业务input随意增加effectiveQuerySnapshot字段，也不能用本机时间伪造快照或关闭Provider检查。后续history.get-trajectory也要求有效快照，应一并处理；区间与轨迹间的引用、快照和结果证据必须保持一致。已有历史编排单测以mock直接返回区间/轨迹，未覆盖真实Gateway快照注入边界，是该遗漏未在单测暴露的原因。


后续修复与新任务复测见 [历史查询有效快照适配验收](../history-effective-snapshot-2026-09-08/README.md)。本报告上述失败为当时观察，保留作为修复前证据。
