# W04 — 结构化选择、结果复用与非执行目标候选

前置阶段：W03。验收范围：WA-037–WA-045。

## 实施要求

消费 W01 的分析选择结构。服务端查找 prior result 的真实字节/hash，在 actor/data scope、TTL、choice/candidate 归属和来源完整性验证后获取 series/event/location。客户端提交的 coordinate、safeSummary、source ID、rank 和 displayName 都不能替代服务端权威来源。

复用 packages/prior-grounding 与历史 followup/context 路径。请求里的 priorGroundings 保留 groundingId/resultHash 锚点，analysisSelections 与其一致；selectedProductIds 仍只含真实 ReferenceProduct。同一显示 rank 在新结果中不代表同一个候选。

明确区分“在旧结果选第二个”和“改指标/改执行阶段/更新数据再算”。前者可在证据、TTL、scope 有效时复用；后者必须构造新查询并使旧派生目标失效。结果截断未保存候选、事件尾部证据不足或多个 Choice 不能唯一确定时，重查/澄清而非猜测。

Action Target 根据显式用户动作候选意图，从实际选择的 ranking candidate 构造，精确复制 representativeVisitedPosition，绑定 sourceFindingId/candidateId/rank/measurement/time/evidence。目标 subject 仍是世界对象，不绑定车控 Resource/Skill/MCP/MQTT。三个后续 requirement 为 true，executionAuthorized 恒 false。

测试 tampered candidate、cross-scope、expired prior、hash mismatch、rank out of range、metric changed，以及单纯查 Top-K 不生成动作候选。保留既有安全检查，不扩张为新的完整攻击测试平台。

## 优先修改/核对入口

- `packages/prior-grounding/src/`
- `packages/historical-trace-consumer/src/advanced-followup.ts`
- `packages/historical-trace-consumer/src/context.ts`
- `services/grounding-worker/src/production-module.ts`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W04/`，至少包括：`followup-action-report.json`, `followup-action-tests.log`, `two-turn-contract-examples.json`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-037 | 新分析 selection 使用独立合法结构 | 新请求 Schema 和多轮测试 |
| WA-038 | 仅从服务端已保存结果解析选中候选 | 篡改摘要/坐标/rank 负例 |
| WA-039 | 选择校验 actor/scope/TTL/hash/归属 | 作用域和完整性关键反例 |
| WA-040 | 自然语言序号只在唯一 Choice 内解释 | 多个 Choice/文本与 selection 冲突 |
| WA-041 | 改变指标/series/阶段/执行触发新查询 | 语义变化测试 |
| WA-042 | 缺失/裁剪候选重查而非补造 | rank 越界/未保存候选/不完整 suffix |
| WA-043 | 动作候选精确使用代表实到位置与来源 | 坐标/measurement/time/evidence 等值断言 |
| WA-044 | 动作候选恒非授权且用途限制完整 | false 授权与三个 true requirement 断言 |
| WA-045 | 候选输出不绑定具体应用且不误杀世界 ID | 普通查询/显式动作/opaque ugv1 ID 测试 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
