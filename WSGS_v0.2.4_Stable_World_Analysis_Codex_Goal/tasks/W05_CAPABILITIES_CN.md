# W05 — 能力发现、局部降级与默认行为

前置阶段：W04。验收范围：WA-046–WA-054。

## 实施要求

通过实际可信 capability snapshot、配置 flag、服务端 principal 授权、上游锁/语义版本和 runtime availability 推导 1.2 worldAnalysis 能力列表。把 supported 与 available 分开，带有限 reasonCodes、检查有效性和公开 limits；不能从本地存在 schema 文件推定远端可执行。

声明五类 Finding 的实际支持范围。历史目标仅声明当前实现的历史来源；不提前开放 user/current 任意位置行动。CROSS 与 action target 对基础能力的依赖要精确传播，不能让单个 T4 不可用拖垮全部历史查询。

默认保留现有历史/高级分析 opt-in。缺少可选 Provider、合同漂移、语义不匹配或未授权时，仅让相关能力 unavailable 并返回对应 typed Gap；不全局启用 PREVIEW、不直连 Provider、不降级成无数据成功。服务仍可接受合法 1.2 协商并说明不可用。

对无关普通 Grounding/GDPS 运行回归。只检测既有 health/ready 行为是否回归，不新增 WSGS/Data Platform 总 readiness 黑盒资格。保留模型不可用时原有确定性路径与明确缺口，不把受控测试模型作为正式 fallback。

更新 .env.example/docs，给出最小新增配置、含义、默认值和影响范围，示例不带 secret。模型/Gateway/身份配置均复用现有机制，不添加第二套全局认证/能力治理层。

## 优先修改/核对入口

- `services/grounding-api/src/production.ts`
- `packages/trusted-capability-snapshot/src/`
- `packages/historical-trace-consumer/src/config.ts`
- `packages/historical-trace-consumer/src/advanced-config.ts`
- `.env.example`
- `docs/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W05/`，至少包括：`capabilities-report.json`, `capabilities-tests.log`, `configuration-notes.md`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-046 | capabilities 分开 supported 与 available | 实际 snapshot/config/permission fixture |
| WA-047 | 能力按 flags/version/hash/semantic/permission 判定 | 禁用/漂移/未授权/过期 discovery 用例 |
| WA-048 | 每能力具备有界可解释 reason 和 limits | 完整 capabilities schema 校验 |
| WA-049 | CROSS 与 action 的基础依赖正确传播 | 缺 T2/T3/T4/trace 组合测试 |
| WA-050 | 可选分析失败不破坏普通 Grounding/GDPS | 无关路径回归 |
| WA-051 | 保留现有默认 opt-in 和签名 Gateway 路径 | 默认配置与架构断言 |
| WA-052 | 未部署能力和未实现来源不被宣传可用 | supportedSources/operation 范围核对 |
| WA-053 | 不新增总 readiness 黑盒资格 | 源码/脚本/报告范围扫描 |
| WA-054 | 配置和降级说明可独立理解 | .env.example 与文档核对 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
