# 按设备稳定身份处理车辆版本（2026-09-08）

## 实现

根据用户要求，车辆身份按GOWM已注册设备的稳定引用身份（namespace、kind、id）区分，version只作为该设备状态/历史证据版本，不作为是否同一设备的判断条件。不以名称猜设备，也不由WSGS生成设备ID。

- 历史轨迹标准化保留GOWM输出的subjectReferenceKey，不再用执行时当前引用覆盖其版本；核对返回主体仍为同一设备。
- 公开历史和分析finding统一指向该设备已有、经校验的GOWM referenceProduct。Provider的冻结版本、结果、回执和哈希不改写。
- 公开assertScope对主体使用稳定设备身份，仍保持实际trajectory引用（含版本）及其来源一致性；不同设备不合并。
- 历史上下文中的同设备不同版本不再算多个主体；高级历史与历史追问复用也按设备稳定身份比较主体。
- 无公开Schema、数据库表或迁移改动，无上游数据改动，不处理CROSS预算问题或生产延期事项。

## 本地与真实证据验证

类型检查通过；历史、分析、公开finding及HTTP业务功能回归 **201/201通过**，见 functional-tests.txt。包含MAP/STOP/RANK同设备版本演进正例、GOWM历史版本不被覆盖、同设备追问复用、不同设备/错误轨迹来源不误配。按用户范围没有运行认证专项，也没有重复全仓认证/安全套件。

本轮真实检查点只读复算（不改变旧任务结果）：
- MAP：ROAD_ASSOCIATION保留93 roadVisits、27 offNetworkSegments、83 ambiguousSegments。
- STOP：TEMPORAL_EVENT保留23 events，生成1个追问choice。
- RANK：正常输出METRIC_RANKING / NO_DATA，不再被车辆版本误分类成UPSTREAM_CONTRACT_MISMATCH。
- 原PARTIAL、PROVISIONAL、输出条数上限及RESULT_TRUNCATED照实保留。结果见real-checkpoint-projection.jsonl。

## 新候选现场复测

候选adb9871ecddfc49a40bf已构建，构建时正式来源校验及typecheck通过（build.txt）。当前只复测MAP、STOP、RANK和有效追问，记录live-functional.jsonl。正常业务请求沿用实例配置，没有执行认证负例。诊断结束后停止API/Worker，不自动激活。

### 新任务实测结果（已完成）

| 功能 | 新任务 | 结果 |
|---|---|---|
| MAP | grounding-7159d84e-1e9a-481d-a6c9-0ab3f0f8721c | **功能通过**，83.829秒；公开ROAD_ASSOCIATION含93 roadVisits、27 offNetworkSegments、83 ambiguousSegments。PARTIAL，仅RESULT_TRUNCATED/WARNING，无车辆版本阻塞。 |
| STOP | grounding-e854e9ff-9015-4e5d-963a-7a844da22380 | **功能通过**，71.329秒；公开TEMPORAL_EVENT含23 events并生成EVENT_SELECTION。PARTIAL，仅RESULT_TRUNCATED/WARNING，无车辆版本阻塞。 |
| RANK | grounding-e2660ccf-8453-4bb9-8ac6-f6d82659386a | **版本适配及无数据表达通过**，81.104秒；公开METRIC_RANKING/NO_DATA，候选0。仍缺指标样本，不计有数据排名通过。 |
| 有效追问 | 未提交 | **NOT_RUN**：执行追问检查时无仍有效的选择。STOP选择有效至13:54:30.188Z，而结果落盘13:54:23.425Z，仅剩约6.8秒；本次串行RANK之后再检查已到期。未延长既有有效期或伪造选择，也未把此项计作通过。 |

三项新结果均通过公开Schema校验、幂等重放和真实分析回执核对。证据见cases.json、execution-evidence.jsonl、live-functional.jsonl。模型本轮均一次成功，MAP33.988秒、STOP42.667秒、RANK51.773秒。历史轨迹仍3355点/13处gap/PROVISIONAL，不宣称完整无缺口数据资格。

设备一致性已真实验证：Provider历史版本47414与当前设备版本74048/74303/74550指向同一稳定设备ID，现能正常输出分析finding。GOWM原始回执与结果哈希保留。

剩余功能验证：CROSS首节点HTTP413（独立节点输出预算问题待闭环）、RANK/GDPS有数据场景、有效期内追问。旧现场报告的版本阻塞结论已由本报告的新任务覆盖，不能继续当作当前未修复问题。

最终API/Worker均exited，候选未激活，见instance-state.txt。没有运行认证及相关专项；没有修改总截止时间、追问有效期或上游业务数据。
