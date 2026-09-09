# W01 合同设计输入：通用世界分析结果与语义约束

**状态：TASK_DESIGN_INPUT / NOT_YET_FROZEN。** 这里约束 Codex 应实现的协议，不代表这些类型已存在于仓库或已经冻结。W00 对照已固定的上游和北向源码后，W01 生成完整机器可读合同。不得只把本文件复制到 `contracts/` 就宣称冻结。

## A. 外层和命名

新协商组合：

```text
WSGS-Contract-Version: sacs-wsgs-grounding/1.2
WSGS-Result-Profile: wsgs-world-analysis-findings/1.0
```

新结果 `GroundingResult12` 保持旧核心字段的名称与含义，增加 `worldAnalysisFindings`。保留 geospatial 合同的独立版本：1.2 中可同时携带按旧 geospatial profile 验证的 `geospatialFindings`，不重命名/扩大其中的枚举。1.2 的 capabilities 必须声明包含这两个结果组件的规则。不要用逗号 Header 或客户端字符串列表发明第二套协商。

对有效的 1.2 GroundingResult，`worldAnalysisFindings` 为必备组件：即使本轮没有历史分析，也返回合法空 findings/choices/gaps 及真实 hash。旧 1.0/1.1 响应不得添加此字段。未完成 Job 按既有 Job 结构返回，不伪造终态结果。

逻辑结构（W01 完整化为 JSON Schema，不得留下未定义的类型）：

```ts
interface WorldAnalysisFindingsV1 {
  profile: "wsgs-world-analysis-findings/1.0";
  findings: WorldAnalysisFinding[];
  choices: WorldAnalysisChoice[];
  gaps: WorldAnalysisGap[];
  findingSetHash: `sha256:${string}`;
}
```

每个数组、字符串、递归层级、坐标点数都要有显式上限；最终输出服从请求 `maxResultBytes` 与服务上限的较小者。上限不能被解释成实际数据总数。

## B. 公共基类和条件字段

基类包含 `findingId`、`findingKind`、`semanticConcept`、`status`、主体 ReferenceProduct ID 集合、证据 ID 集合、`unknowns`、`warnings`。五种 findingKind 采用 `oneOf`/判别联合，不得用开放对象兜底所有类型。可保留 bounded `sourceOperations` 等来源元数据，但不让消费者据 Provider ID、版本或字段路径解码业务含义。

单条 Finding status 为 `COMPLETED | PARTIAL | NO_DATA | INDETERMINATE`。这些只描述本条语义输出，不替代 GroundingResult.status，也不取代外层失败码。

成功语义需要有证据或明确的用户输入出处；当前任务产出的历史分析/目标必须有服务端验证过的历史证据。只有 Gap 时允许没有 Finding，不能凑出一个无证据的“成功 Finding”。

字段按状态有条件约束：例如尚未取得 trajectory reference 的 NO_DATA/INDETERMINATE 不得强制填写虚假 ID。使用可选字段、明确 unknown 状态或独立 Gap，不以空字符串、0、false 伪造缺失值。公共 confidence 仅转述有定义的源置信度，不合成无依据的概率；有值时限定 [0,1] 并说明含义。

## C. Historical Trace

表达任务与世界主体、实际选择的单次 execution、execution interval 与 trajectory 的有效引用，保留：selected/active/paused periods、执行生命周期、requested/defined/excluded periods、显式 gaps、prefix/suffix completeness、finalization state、覆盖率（只有源提供且定义明确时）。

必须同时保存“请求范围”和“实际可证明范围”；不得只给一个大包围区间掩盖暂停或多段轨迹。不得跨 UNKNOWN GAP 或 paused period 插值。ALL/multiple executions 仍按现有限制拒绝，不扩展分析域。

时间区间先核验源合同开闭端点约定，再冻结北向 `TimeRange` 表示与映射；不能统一改成半开区间却丢失源端点。公共日期需要有时区，规范化须保持时刻不变。自然语言“上一次”必须绑定服务端解析出的 task/execution，而不是用本机当前时间猜测。

`PROVISIONAL` 不是 `SEALED`；轨迹封存也不证明附加通信指标采样完整。轨迹封存状态和指标覆盖状态分别输出。

## D. Road Association

公共模型包括 roadVisits、offNetworkSegments、ambiguousSegments、网络数据问题候选（若源有）、前后缀关联完整性及必要网络上下文。冻结：

```text
networkRole = REFERENCE_MODEL_NOT_PHYSICAL_TRUTH
OFF_NETWORK != 错误轨迹/违法移动/真实世界不可通行
```

roadVisits 至少能表达 visitId、道路来源标识、显示名（可选）、时间范围和有证据的位置。道路来源标识没有被 GOWM 权威物化为 ReferenceProduct 时，不得伪造 ReferenceProduct ID；保留带来源/网络版本语境的 opaque feature ID。

“最后一条已确认道路”必须写明确认范围，只能证明可用数据中的最后已确认项。尾部存在 gap/off-network/ambiguity 时不能升级成绝对最终道路。不得根据列表最后一项直接生成绝对结论。

离路原因可以保留源给出的候选解释和不确定性，不能由 WSGS 无证据地断言某段是未绘制道路。点/线预览仅作展示，不能用于导航或覆盖计算。

## E. Temporal Event

支持 `ENTER | EXIT | DWELL | STOP | PASS_NEAR | CROSS`。事件条目需要 eventId、源定义的瞬时时间窗或区间、位置（有源时）、目标引用/名称（有源时）、reasonCodes 与证据。

INSTANT 的估计时刻不能强制要求在源没有提供时捏造；时间窗不应压缩成精确一秒。INTERVAL 的持续时长仅按已冻结源语义映射，不能把整个跨 gap 时间算成停留时长。

FIRST/LAST 选择包含选择类型、selectedEventId（有候选时）、confirmed、确认范围和类型化 reasonCode。需要保留 prefix/suffix、上游缺口、质量断点、离路、歧义关联等阻断原因。

**数据不完整与响应展示截断分开。** 如果 Provider 已对完整请求范围证明 FIRST/LAST，WSGS 仅裁剪无关展示项且仍保留被选事件与完整证明，不得机械抹掉该证明；反之，证明范围或被选事件被裁掉时，必须降级或去掉选择，不得留下悬空 selectedEventId。

CROSS 的 T2→T3 内部 DAG 和完整 MapMatchResult 输入继续复用；公共结果不要求消费者了解 `/source/mapMatchResult` 或 T2/T3 结构。

## F. Metric Ranking

公共模型保留 metric concept、observedProperty、unit（已知时）、optimizationDirection、明确的 metric series 选择、candidateDomain、候选顺序和实际排名依据。

冻结：

```text
candidateDomain = PAST_OBSERVED_LOCATIONS
metricTemporalCompletenessKnown = false  # 本版本的保证上限
```

每个可用候选至少保留 candidateId、原始 rank、representativeVisitedPosition、representativeObservedAt、representativeMeasurementId、representativeValue、sampleCount，以及源提供的 rankingBasis/统计值。**代表样本值不一定是排名分数**：如按平均值排名，不能把 representativeValue 展示成平均值或排序依据。W01 明确可支持的排名依据子结构；未知依据不输出误导性“最佳”。

MAXIMIZE/MINIMIZE 由指标目录和明确意图确定，不能硬编码“值大越好”。RSSI 等负数不可取绝对值；单位不能悄然变换；零样本不是值为 0。

多个 metric series 时给 Choice，不跨设备/源/单位混合排序；不做未经定义的综合分数。Top-K 保留 rank 与排序语义，裁剪不重新编号成另一个排名。H3 cell/boundary 仅是聚合/展示对象，其中心点不得用作实到位置或动作目标。

## G. Action Target Candidate

本版本只实现已有历史分析支持的 `MOVE_TO_LOCATION` **候选**，并保持设备无关。目标字段包含几何 Point、坐标语义、来源 Finding/candidate/rank、测量时间和测量 ID、证据链接；主体指向合法世界 ReferenceProduct，而非执行资源绑定。

固定：

```ts
requirements: {
  currentValidationRequired: true;
  routePlanningRequired: true;
  executionConfirmationRequired: true;
}
executionAuthorized: false;
```

对历史指标目标，target 必须精确取自被选择候选的 representativeVisitedPosition；不得用 H3 center、道路中心线、地图截图点、模型重写坐标或平均坐标替代。使用 EPSG:4326 的经纬度轴顺序时为 longitude, latitude；高度若存在须独立标注其单位/垂直基准，不能声称 EPSG:4326 本身定义了海拔。无明确高度语义时只输出合法 2D 目标，不能补 0 米。

只冻结并声明本次实际实现的历史来源。当前世界点、用户地图点可在设计文档中列为未来扩展，不为了“通用”额外实现新行动来源，也不能在 capabilities 中提前宣称可用。

目标来源关系必须可在同一返回集或经过授权解析的已保存结果中验证；缺少来源 candidate/measurement 时不生成目标。指标/执行区间/series 改变后旧目标失效并重算。仅在用户明确要求动作候选或选择对应目标时生成，不把任意 Top-1 查询都变成动作建议。

禁止写入公共动作模型：Provider 执行 ID、SDAR agent/skill、MCP tool/task、mission_id、MQTT topic、速度、转向、到达容差或设备控制参数。**不禁止合法 opaque 世界 ID 包含 `ugv1`；禁止结构耦合，不做字符串误杀。**

## H. Choice 与选择权威

ChoiceKind：REFERENCE_SELECTION、TASK_SELECTION、METRIC_SERIES_SELECTION、RANKED_LOCATION_SELECTION、EVENT_SELECTION。每个 Choice 有 choiceId、提示码、来源 Finding（可选）、有限候选项；候选包含 candidateId、displayName 与经过白名单映射的摘要。只有真的对应 ReferenceProduct 时才带 referenceProductId。

Choice 不是任务或执行授权。Rank 是展示与选择语义，不是身份。完整选择回传与过期规则见 `COMPATIBILITY_AND_SELECTION_CN.md`。禁止 `safeSummary: any` 直接透传 Provider；选择语义所必需的字段必须被明确建模或绑定服务端数据，不能依赖展示文案。

## I. Gap 与状态映射

Gap 需包含 gapId、gapKind、severity（INFO/WARNING/BLOCKING）、messageCode、关联 Finding/Evidence ID，以及有界、安全的 detail。对整个请求的 Gap 可以没有 findingIds。缺口词表至少覆盖：能力不可用、引用缺失/歧义、任务/目标上下文缺失、指标不支持/多 series、历史投影未就绪、轨迹/分析不完整、结果裁剪、当前验证/路径规划/未授权执行。

另外冻结选择无效/过期/范围不匹配、上游合同不匹配、上游超时/失败的公共处理。协议错误码和业务 Gap 不得互相滥用；不得把每种故障全部归成“无数据”。

建议并在 W01 最终确定：

| 实际情况 | GroundingResult | Finding / Gap |
|---|---|---|
| 分析完成且有有效数据 | COMPLETED | COMPLETED（目标未授权属于用途限制，不等于分析失败） |
| 执行成功但范围内无匹配项 | COMPLETED 或按既有总体聚合规则 | NO_DATA，不能声称现实中从未发生 |
| 上游投影未就绪 | PARTIAL | HISTORICAL_PROJECTION_PENDING，不新增结果终态 PENDING |
| 缺必需主体/任务/目标 | UNRESOLVED；已有独立有效部分则 PARTIAL | 对应上下文 Gap |
| 存在未决必需选择 | AMBIGUOUS；独立有效部分可保留 | Choice + 关联 Gap |
| 截断/覆盖不全 | PARTIAL，除非被请求结论有完整独立证明并在规则中明确 | 保留有界结果和完整性说明 |
| Provider 超时/失败/合同不符 | FAILED 或保留独立有效结果的 PARTIAL | 对应原因，禁止 NO_DATA 伪成功 |
| WSGS 取消 | CANCELLED | 按已有终态规则，不晚到回写成功 |

多意图聚合规则必须写成确定性优先级；action 的后续执行限制应通过用途/阻塞目标来表达，不能把所有只读分析都标成 FAILED。保留旧合同状态映射，不回写到旧版本文件。

## J. 哈希、引用闭包和裁剪

1. Schema/artifact hash：对冻结 UTF-8 文件实际字节做 SHA-256，写入 manifest/lock；不要用 Git blob SHA 代替 SHA-256。冻结 JSON schema dialect 为现有 draft 2020-12，离线校验完整 `$ref` 闭包。
2. findingSetHash：W01 固定 canonical JSON 算法与输入 `{profile, findings, choices, gaps}`，排除 findingSetHash 本身；不加入日志时间和耗时。选择候选顺序/排名/时序数组保留，只有明确定义为集合的数组才可排序。
3. GroundingResult.resultHash：沿用已有规范化算法，并对 1.2 明确纳入新扩展，不能先算旧 hash 后拼扩展。避免 resultHash 与 selection token 相互包含产生循环。
4. 标识：同一保存结果的 GET/重试必须保持 Finding/Choice/candidate 身份和 hash。不同 grounding 可不同。hash 只做完整性校验，不替代 actor/scope 授权。
5. 裁剪：先做来源/语义验证，再按冻结策略裁剪；保留被选择项、必要来源证据和完整性元数据。若无法同时保留，移除依赖它的派生产物并返回 Gap，不能给悬空引用或截断的坐标数组。
6. 响应过大：必须能返回大小预算内的合法紧凑 Gap/错误；仍超过预算则用 W01 明确的协议错误，不返回未校验的任意对象。不要只给 safePayload 加限而让同一原始结果从另一个 evidence 字段漏出。
7. 公共预览与服务端复用：北向展示被裁剪不意味着服务端丢弃权威原始结果；私有持久化仍可保存经验证的完整结果及 hash，所有复用必须再校验 TTL/作用域和实际语义。

## K. 最小实际合同集合

在 `contracts/wsgs-v0.2.4-world-analysis/` 生成请求 1.2、结果 1.2、Job 1.2、Capabilities 1.2、Findings 联合、五类子模型、Choice、Selection（若需新增回传字段）、Gap、公共定义、词表、limits、OpenAPI 增量/完整导出、完整正反例、冻结 lock 与 checksums。

不要手工改生成 TypeScript；以唯一 Schema 真值生成并检查 drift。消费者交接包只带公开合同及其公共依赖，不包含全部上游 manifests、Provider 模型、内部 runtime 和凭据。W01 必须覆盖实际 HTTP 返回形状，而不是只验证一个脱离 Job/Result 的子对象。
