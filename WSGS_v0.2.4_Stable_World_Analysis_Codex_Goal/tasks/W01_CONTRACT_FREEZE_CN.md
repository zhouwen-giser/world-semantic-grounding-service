# W01 — 北向合同冻结与正反例

前置阶段：W00。验收范围：WA-010–WA-018。

## 实施要求

在改动新运行时之前完成设计决策与机器合同。以 design/ 两份文件为边界，细化字段类型、nullable/optional 条件、状态聚合、来源/引用、哈希范围、能力声明、limits 和 Choice 回传。特别落实：封闭旧 Schema 不直接 allOf 扩展；1.2 需要完整 request/result/job/capabilities validator 闭包；现有 selectedProductIds 不能表达新 candidateId。

创建 contracts/wsgs-v0.2.4-world-analysis/。请求 selection 若没有完全同义的现有字段，采用仅 1.2 的 analysisSelections，生成其 schema 和完整下一轮 request 示例。不得新建 selection/intervention endpoint。1.2 定义 geospatialFindings 与 worldAnalysisFindings 的共存规则；旧 geospatial 子合同保持原字节。

生成完整 JSON Schema draft 2020-12 闭包、公开 TypeScript 类型和校验入口、公开状态/原因码词表、OpenAPI 的真实 200/202/GET/cancel 形状以及正反例。正例来自人工明确标识的合同样本或仓库 fixture 的受控投影，不伪称真实现场结果。反例包括悬空 ID、错误 rank/position、缺失条件字段、未知 kind、非有限/越界坐标、错误 profile 等。

建立 verify:world-analysis-contract：完整 payload 验证、旧合同 hashes 不变、类型生成无 drift、离线引用闭包、固定 hash vectors 和语义校验。Schema 不能表达的跨字段约束必须在公开语义校验/测试中补上，不能只写说明。

自审后写 contract-freeze.json/contract-release-lock.json 和 CHECKSUMS，生成真实字节 hash。执行验证，形成仅合同/类型生成/合同测试的冻结提交并记录路径和 commit。只有该阶段通过才允许 W02 新运行时逻辑。冻结前可修订；冻结后必须显式撤销未分发候选或按变更规则新增版本，禁止静默改 hash。

## 优先修改/核对入口

- `contracts/wsgs-v0.1/`
- `contracts/wsgs-v0.2.1-sacs-geospatial/`
- `packages/contracts/`
- `validation/scripts/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W01/`，至少包括：`contract-freeze.json`, `contract-compatibility.json`, `contract-validation.log`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-010 | W01 冻结早于新运行时实现 | 提交序列及 freeze record |
| WA-011 | 五类 Finding 与有界 Choice/Gap 判别联合 | 完整 Schema 正反例 |
| WA-012 | 请求/结果/Job/Capabilities/OpenAPI 引用闭包 | 离线完整 payload 校验 |
| WA-013 | 旧 1.0/1.1 与 geospatial 工件不可变 | W00 哈希逐文件对比 |
| WA-014 | 明确 1.2 精确协商和 geospatial 共存规则 | 协商矩阵正反例 |
| WA-015 | 明确 ID/引用/选择回传条件且不混用 RP ID | Schema 与跨字段语义校验 |
| WA-016 | 状态/原因码/时间/CRS/缺失值语义可判定 | 语义用例校验 |
| WA-017 | 哈希范围、canonical 算法、排序与限额已冻结 | 固定 hash vectors 与 limits 检查 |
| WA-018 | 生成真实 lock/checksums 和唯一来源类型 | verify:world-analysis-contract |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
