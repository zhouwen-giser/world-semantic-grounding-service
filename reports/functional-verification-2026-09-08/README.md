# 功能问题项现场验证（2026-09-08）

## 范围与总体结论

按用户明确授权，只验证 TRACE、MAP、STOP、CROSS、RANK、GDPS 和有条件的有效结果追问。**未执行认证、签名、越权、HTTP错误分类或其他相关测试项目**。正常业务请求使用实例既有传输身份。

六项业务请求均实际完成，公开结果 Schema 与幂等重放均一致；本轮模型都成功，12.044–56.289 秒，MAP 两次尝试，其余一次。总体仍未通过完整业务验收：发现公开分析转换中的车辆版本比较遗漏，以及 CROSS 的 HTTP 413；RANK/GDPS 另有数据缺口。追问因没有有效分析选择而未执行。

## 当前现场结果

| 功能 | 任务 | 耗时 | 结果与判定 |
|---|---|---:|---|
| TRACE | grounding-bedb133b-f03c-41ab-946e-b3b57e7dd9de | 49.378秒 | **功能通过，PARTIAL**。区间和轨迹各有回执；3355轨迹点、14段、13处gap、覆盖率0.9982493120，PROVISIONAL、suffixComplete=false；没有BLOCKING gap。不是完整无缺口轨迹资格通过。 |
| MAP / T2 | grounding-3579156c-e203-41b9-b861-53476fba6fe2 | 86.378秒 | Provider实际返回93 roadVisits、27 offNetworkSegments、83 ambiguousSegments；13.355秒，PARTIAL_DUE_TO_QUALITY_BREAKS。但WSGS公开转换拒绝，最终只有历史finding和BLOCKING UPSTREAM_CONTRACT_MISMATCH。**业务输出未通过**。 |
| STOP / T3 | grounding-e5fb791e-3235-49ef-802a-583beb1e5463 | 64.066秒 | Provider实际返回23 events，8.692秒，EVENTS_FOUND_WITH_INCOMPLETE_INPUT；同样被公开转换拒绝。**业务输出未通过**。 |
| CROSS / T3 | grounding-44c04744-8f85-4fed-8bf5-80ba587a089e | 61.370秒 | ANALYSIS阶段trajectory.map-match返回HTTP_413，analysisEvidenceCount=0，未到事件节点；公开BLOCKING UPSTREAM_FAILURE。**未通过**。 |
| RANK / T4 | grounding-58f4968d-7dda-4986-a971-1941087794df | 83.801秒 | rank-locations实际执行10.436秒，NO_DATA / NO_METRIC_SAMPLES、候选0；另被同一公开转换校验拒绝。**排名有数据业务未通过**。 |
| GDPS | grounding-e6a33976-5d97-4675-b51f-0ca410619c61 | 37.809秒 | world.get-current-state及landcover.get-class均有回执；真实NO_DATA与公开unknowns一致。**无数据传播通过；有数据正向验证受数据缺口阻塞**。 |
| 有效追问 | 未提交 | — | NO_LIVE_ANALYSIS_CHOICE：本轮分析finding被过滤，未生成有效EVENT/RANK选择；**NOT_RUN**，未伪造候选。 |

## 新问题一：公开转换仍将车辆版本变化当成跨主体

定位：packages/historical-trace-consumer/src/public-world-analysis.ts 的 assertScope（源代码265行）仍以完整 subjectReferenceKey 的哈希比较身份。MAP/STOP在独立只读转换复算中均在此抛出UPSTREAM_CONTRACT_MISMATCH；Provider envelope及投影evidence Schema校验通过。

- 同一车辆：gowm / WORLD_OBJECT / wrf_9905ca9544ac4b25926ead291d636934。
- Provider冻结版本：47414。
- WSGS当前foundation版本：MAP=70163、STOP=70574、RANK=71077。
- 轨迹引用一致：wrf_349f838c72fb4a25adbb6862dfc5ee1a@2。
- 因而不是轨迹版本错误，也不是没有实际分析结果。MAP、STOP的真实结果被消费者过滤掉；RANK还有独立无指标数据问题。

后续修复应保留Provider冻结版本及trajectory→subject来源证据，以已验证的同主体身份关联公开结果，不能改写上游哈希或要求上游改冻结版本。当前任务只做功能验证与原因定位，本轮没有修改运行中的转换逻辑。

## 新问题二：CROSS 的 HTTP 413

服务器端筛选日志确认：
ANALYSIS / HTTP_413 / lastOperation=trajectory.map-match / attemptedOperations=5 / analysisEvidenceCount=0。

用户请求maxResultBytes=1048576；双节点编译器按节点权重分配输出预算，而单MAP实际outputBytes=967772。首节点输出预算不足是排查方向，**目前尚未证明413究竟在哪一层产生**，不把推断写成已证实原因。稳定错误码及任务标识已交“检查功能实现与项目遗漏”只读核对Gateway/Provider实际预算和记录；不额外重跑模型。

## 证据、来源与收尾

- live-functional.jsonl / cases.json：六项真实新任务及追问未执行原因。
- execution-evidence.jsonl：内部加密检查点经AAD/hash验证后的白名单输出，包含阶段耗时、模型尝试数、节点回执、快照一致性、结果哈希和业务计数，不导出原文、凭证或完整Provider正文。
- initial-evidence.jsonl：TRACE/MAP首次定位。
- projection-probe.jsonl：MAP/STOP evidence Schema均通过。
- finding-probe.jsonl：只读复算公开转换，assertScope错误位置。
- worker-failure-codes.jsonl：CROSS稳定HTTP_413证据。
- instance-state.txt：API、Worker最终均exited。

复用诊断候选f628e707bfcf45fecc4c；启动前候选完整SNAPSHOT与当前消费者快照相同，当前联合正式包3248e5bc333df1ca674691f2f2c2079ae3a4f1614d7c5c70a66fa170eb2f0826匹配。GOWM来源53cea4cc0903e3b6fc5a84bb948a18ce3a6079244cde174c6946b1a6d216735e，GDPS来源dbc4bb4642d63b34beacadf110128b7cc19820e3c2de4419edbdb0f609072003。没有固定未来版本、回退旧包或修改上游业务数据。

功能入口：real-wsgs-instance-gate.mjs FUNCTIONAL；有效追问入口：verify-live-followups.mjs；证据收集入口：collect-functional-evidence.mjs。新增/调整脚本均语法检查通过。本轮是现场功能验收，没有重跑全仓、数据库集成或认证项目。

原120秒业务截止时间保持；之前180秒预算仅用于独立模型诊断。未激活候选，未变更生产资格和生产延期清单。临时诊断文件/容器已清理，API/Worker已停止。

## 后续更新

用户要求车辆按设备ID区分后，WSGS已修复公开转换及追问复用中的版本比较遗漏，并以新任务验证MAP93道路访问、STOP23停车事件正常公开输出，RANK正常表达NO_DATA。详见 ../device-identity-fix-2026-09-08/README.md。以上原始失败保留为历史定位证据，车辆版本阻塞不再列为当前未修复项。
