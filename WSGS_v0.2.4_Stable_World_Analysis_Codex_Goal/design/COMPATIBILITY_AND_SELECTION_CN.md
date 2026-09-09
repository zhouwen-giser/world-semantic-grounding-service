# W01/W03/W04：兼容、协商、选择回传与结果权威

## 1. 源码核验所得的约束

本包观察的代码使用 `wsgs-contract-version` 与 `wsgs-result-profile` 精确配对协商，缺少两个 Header 时走 1.0。配置中用服务端 principal allowlist 控制 geospatial profile。`GroundingContractSelection` 被设计为服务端保存并严格解析的元数据。不能仅在路由增加一个字符串分支就认为 1.2 已接入。

当前基础 request/result Schema 都是 `additionalProperties:false`；当前 API POST 还使用单一 request validator。旧 `priorGroundings[].selectedProductIds` 只是 ReferenceProduct ID 数组。上述事实来源见 `sources/SOURCE_AUDIT_CN.md` 的 S03–S08。

因此必须完成以下两个修正，而不是照抄此前概念示意：**新扩展需要完整的新 Schema 验证路径；分析 candidateId 不能假装成 selectedProductIds。**

## 2. 新旧 Schema 共存

不得直接改写冻结的 1.0/1.1 Schema、examples、release-lock 和 hash。1.2 用独立的请求/结果/Job/capabilities Schema；可引用公共未变子类型或生成一个新版本的完整外层 Schema。

不能用 `allOf: [封闭旧对象, 新字段]` 就声称扩展成功：旧对象的 additionalProperties:false 会拒绝新字段。必须测试完整有效新 payload 被新 validator 接受，同时旧 validator 仍拒绝新字段；旧 payload 在旧路径行为不变。

`schemaVersion` 是 payload 字段，其是否仍为既有 1.0 必须在 W01 对账并明确，不能因传输协商为 1.2 就盲改全部内嵌 schemaVersion。resultProfile 承诺的 payload 必须明确可验证。

## 3. 协商矩阵

冻结至少以下行为，并覆盖 capabilities、POST、GET、cancel 和同步/异步结果：

| Header 与身份 | 行为 |
|---|---|
| 两个 Header 均缺失 | 保持既有 1.0 |
| 精确 1.0，无 profile | 保持既有 1.0 |
| 精确 1.1 + 旧 geospatial profile，原有授权满足 | 保持既有 1.1 |
| 精确 1.2 + world analysis profile，新 profile 服务端授权满足 | 新 1.2 |
| 单边 Header、错误配对、未知 profile、重复 Header、逗号合并 | 按冻结错误码拒绝，不宽松猜测 |
| 请求正文、自然语言或 User-Agent 伪装版本/身份 | 不影响协商和授权 |
| 同一 grounding 用其他 profile GET | 遵循已保存 selection 拒绝不匹配，不能静默投影 |

新 profile allowlist 可为简单服务端配置，不建设新身份平台。不得把配置键叫通用却仍只硬编码名为 SACS 的单个 principal；通用消费服务只依赖身份授权与协议，不依赖应用名称。

## 4. 最小选择回传

优先保留现有 GroundingRequest 外形及 `contextCapsule.priorGroundings` 的完整性锚点。在 W01 检查是否已有能无歧义承载 choiceId/candidateId 的结构化字段；只有语义完全一致才可复用。

若现有合同没有，应在 **仅 1.2 的请求 Schema** 增加一个有界可选 `analysisSelections` 字段，推荐元素如下（字段名在 W01 冻结后不得漂移）：

```ts
interface WorldAnalysisSelectionV1 {
  priorGroundingId: string;
  priorResultHash: `sha256:${string}`;
  findingSetHash: `sha256:${string}`;
  choiceId: string;
  candidateId: string;
}
```

该锚点必须能关联到 contextCapsule 中明确提供的 prior grounding；重复/冲突 selections 被拒绝，不能后者覆盖前者。不新增独立 Selection API/Intervention API，不在旧 selectedProductIds 中编码 `rank:2`、metric series key 或 eventId，不在自然语言尾部塞隐式控制串。

Choice 与 candidates 始终存于 WSGS 服务端权威结果。客户端返回 ID/hash 是“请求选择这个条目”，不是授权证明。服务端从持久化结果解析该候选的实际 series/位置/事件/任务，校验 actor、data scope、TTL、源结果 hash、findingSetHash、choice 所属关系与当前语义。

若选择条目已被服务端裁剪、缺少证据或不在授权范围，明确重查/重新澄清，不能根据 rank 算位置或由模型补齐。选择过期时不要默默绑定到最新结果同序号候选。用户改变任务/执行/指标/单位/phase/目标，属于新查询语义；不能误当作仅展示选择。

原始自然语言作为用户意图保留，不作为服务端权威数据。自然语言“第二个”可以在唯一有效 Choice 中解析；多个 Choice 或不同来源时必须澄清。结构化选择与明确文本发生矛盾时不静默择一。

## 5. 幂等与持久化

幂等规范化输入必须包含已协商合同、profile、完整语义请求（包含 analysisSelections）以及现有作用域。保持既有 idempotency key 使用方式和冲突优先级：同一 key 不同语义是冲突，不可复用；GET profile 不匹配拒绝。W01 明确各路径使用 409 或 406 的条件，不能每个模块自己决定。

保存请求、selection、最终响应及其 hash 必须遵循现有事务/lease/fencing 机制。若需新迁移，只追加；旧记录缺省必须有明确旧版本解释，不能一律视为 1.2。所有 recovery 入口必须支持新 selection 且保留原语义。

重试/GET 返回已保存结果，不能为同一 grounding 再跑模型重生成另一组 candidateId。晚到 worker 不得覆盖取消或超时终态；source hash、snapshot 和 result hash 的现有验证不得删除。

## 6. Capabilities 和局部降级

1.2 capabilities 返回支持的 profile、五类 Finding、Choice/Selection 能力、公开 limits、实际配置/来源约束、按能力的 availability 及有限原因码。

“代码支持”与“当前可执行”分开。availability 根据 feature flags、服务端授权、可信 capability snapshot、正确版本/hash/semantic、Gateway 操作可用性和基础依赖推导，不得静态全部写 true。发现已过期或权限不明时给 unavailable/unknown 原因，不能沿用旧 true。

ACTION_TARGET_CANDIDATE 依赖相应历史 trace/指标 ranking，CROSS 依赖所需 T2/T3；依赖失败只向该能力传播。某个可选 Provider 不可用，不得连带使普通 reference grounding、无关 GDPS 或独立可用历史能力失败。

保留已有默认 opt-in flags；不能为了显示 available=true 全局打开 Preview、绕过锁或关闭权限。1.2 协商支持与分析 Provider 运行可用性不是同一件事：合同可以可协商，某能力仍 unavailable。

## 7. 消费者独立性

W07 新建临时干净消费目录，仅复制最终 C1 公开交接包，安装/使用验证所需最小工具，不能 import WSGS runtime、SACS 源码或 T2/T3/T4 内部类型。离线 `$ref` 全部可解析，完整请求/响应/Job/capabilities 示例可验证。

至少提供通用 HTTP 使用示例、1.2 Header、原始文本 hash、Idempotency-Key、POST 200/202、GET Job 终态、下一轮 selection、cancel、typed Gap 的完整说明。示例不含凭据、不连接真实生产端点、不触发设备。

独立消费测试证明“交接包可被消费”，不能标为“真实 SACS 已集成”。交接包含 `contract-frozen` 与 `implementation-dev-verified` 的明确区别，以及真实集成 NOT_RUN 状态。
