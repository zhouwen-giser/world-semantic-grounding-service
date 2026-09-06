# W03 — 协商贯穿 API、Job、幂等和恢复

前置阶段：W02。验收范围：WA-028–WA-036。

## 实施要求

扩展现有 GroundingContractSelection 判别联合和 parse/validate，按 W01 的配对实现 1.2。请求、capabilities、同步 result、异步 job、GET 终态和 cancel 都使用对应的版本 validator。鉴权在已有信任边界内完成，不从 body/token 文本推断权限。

新协商元数据在创建时由服务器确定并保存，所有 worker/recovery 入口严格读取保存值。已有 1.0/1.1 记录走旧解释，不能强制升级。新外层 result 构造和 result hash 必须在保存前完成，不能 GET 时追加扩展。

幂等指纹包含 schema/profile 与 analysisSelections 等完整语义输入。相同 key+相同请求重试返回原 job/result；同 key 改 profile/候选/指标不复用，按 W01 明确的 409/406 条件处理。GET 换 profile 不进行隐式数据转换。

若 DB constraint/保存结构确实需要升级，只追加迁移与断言，解释旧记录兼容。保留 lease/fencing、deadline、cancel 和终态覆盖防护。测试 crash/retry/late completion 只证明其实际运行边界；真实 PG 未跑仍须列 NOT_RUN。

不要把新 profile 的支持写死在 HTTP 表层而遗漏 backend/worker/queue/store。生成最小全路径协议回归，检查无 Header 请求和旧 geospatial 路径的响应 shape/hash 规则未被改动。

## 优先修改/核对入口

- `services/grounding-api/src/`
- `packages/grounding-pipeline/src/contract-selection.ts`
- `packages/grounding-pipeline/src/backend.ts`
- `services/grounding-worker/src/`
- `database/migrations/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W03/`，至少包括：`transport-runtime-report.json`, `transport-tests.log`, `migration-notes.md`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-028 | 实现服务端精确 1.2 配对与授权 | headers/principal 配对测试 |
| WA-029 | POST 使用对应版本 request validator | 新旧 request 正反例 |
| WA-030 | 同步与异步完整响应使用对应 validator | 200 result/202 job/GET terminal |
| WA-031 | 协商元数据保存并在 worker/recovery 恢复 | store/worker 恢复测试 |
| WA-032 | 相同幂等请求复用原 job/result | 重复提交和读取测试 |
| WA-033 | 幂等包含 profile 与全部选择语义 | 同 key 改 profile/candidate/metric 测试 |
| WA-034 | GET/cancel 不隐式跨 profile 投影 | 旧/新 job 跨 profile 读取测试 |
| WA-035 | 保留 cancel/deadline/fencing 终态不变式 | late worker/timeout/cancel 回归 |
| WA-036 | 必要持久化变更只追加迁移且旧数据可解释 | 迁移静态/组件测试及环境说明 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
