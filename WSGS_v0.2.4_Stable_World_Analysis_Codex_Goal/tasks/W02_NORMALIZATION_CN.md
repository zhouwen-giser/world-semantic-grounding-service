# W02 — 五类通用结果归一化与安全裁剪

前置阶段：W01。验收范围：WA-019–WA-027。

## 实施要求

按 W01 冻结类型建立薄的 public world-analysis normalizer，复用当前 historical-trace-consumer、northbound-geospatial-findings、evidence/canonical 辅助代码。生产端先验证锁定的上游 envelope 和结果 Schema，再投影公共 Finding；不要对上游 any JSON 直接 cast。

把内部 HISTORICAL_ROAD_ASSOCIATION/HISTORICAL_TEMPORAL_EVENT/HISTORICAL_METRIC_RANKING/HISTORICAL_ACTION_TARGET_CANDIDATE 等映射到冻结五类 Finding。内部名字不要求改成公共名字；通过隔离的 mapper 保持演进边界。保留完整性、scope、证据、测量和排名依据，严禁代表值冒充排名分数或离路被解释为错误轨迹。

来源标识分清：Provider source feature ID 不一定是 ReferenceKey；只有真实权威 ReferenceProduct 可以进入 RP 引用字段。公共引用必须闭合，不存在的来源以 Gap 处理，不能补字符串。

对实际输出集裁剪，保留所选候选与必要证据；超预算时给合法 compact Gap/错误，不切坏 geometry，不漏原始 payload，不静默丢 completeness。区分展示 truncated 与输入 coverage，不因数组截断机械改变已得到完整证明的 FIRST/LAST，也不能保留已丢证明的绝对选择。

生成正确 findingSetHash 和完整 resultHash 输入，保护时序与排名顺序。用固定 golden vectors 验证重复映射确定性，并用变更一个关键字段的反例验证 hash 改变。normalizer 不做查询、不执行动作、不本地重建地图匹配或轨迹分析算法。

## 优先修改/核对入口

- `packages/historical-trace-consumer/src/advanced-normalizer.ts`
- `packages/historical-trace-consumer/src/normalizer.ts`
- `packages/northbound-geospatial-findings/src/`
- `packages/gowm-execution-evidence/src/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W02/`，至少包括：`normalization-report.json`, `normalization-tests.log`, `hash-vectors.json`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-019 | 验证锁定上游 envelope/schema 后才映射 | 有效/无效上游 fixture 对照 |
| WA-020 | 五类内部结果映射到公共联合 | 五类 golden tests |
| WA-021 | Historical Trace 保留执行范围/gap/暂停/封存 | 轨迹不完整和单执行反例 |
| WA-022 | 道路关联保留参考网络与离路/歧义语义 | road/off-network/last-road fixtures |
| WA-023 | 事件保留类型/时间窗/确认范围/FIRST-LAST 证据 | 完整及不完整 event fixtures |
| WA-024 | 排名保留方向、series、排名依据和代表样本 | MAX/MIN/负数/聚合排名 fixtures |
| WA-025 | Evidence/ReferenceProduct/feature 来源关系可验证 | 悬空/假引用反例 |
| WA-026 | 裁剪保留必要来源和合法 geometry/Gap | 小预算及选中候选保留测试 |
| WA-027 | 新扩展纳入 hash 且结果确定性 | golden hash/关键字段修改/重复映射 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
