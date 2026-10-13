# WSGS 功能落实修复结果（2026-10-13）

修复方案：[EP-wsgs-function-realization-fix-2026-10-13.md](../../execplans/EP-wsgs-function-realization-fix-2026-10-13.md)。修复前证据保留在 [审计报告](../function-realization-audit-2026-10-13/README.md)。分支为 `codex/wsgs-v0.2.4-stable-world-analysis-service`，已拉取到 `0c00de5c0f45f591c2986544e0902b84038a1537`；本报告记录修复验证时该提交之上的未提交工作区；部署阶段会另行记录提交及其归档摘要。软件版本仍为 `0.2.1`。

## 本轮完成的五项修复

| 项目 | 修复后的行为 | 回归证据 |
| --- | --- | --- |
| A01 阶段与刷新 | “包含暂停/整个执行时段”切回 `EXECUTION_ENVELOPE` 并重新查询；“重查/重新/刷新”不复用旧基础；省略的范围继承，有效同范围选择仍可复用 | 普通与高级追问用例、公开 HTTP 多轮用例检查实际历史/区间输入及操作次数，GET 字节保持一致 |
| A02 完整范围 | 即使只有一种分析，也检查整句所有主体、任务、执行批次和来源；不同范围及矛盾阶段返回明确 Gap，执行批次序号不会误作 FIRST | 组件用例及公开 HTTP 负例断言解析失败且未执行历史查询或分析 |
| A03 独立未支持查询 | “道路，以及是否超速/统计超速/查电池”等返回 `CAPABILITY_UNAVAILABLE`；不再默默丢弃附加问题；已支持的轨迹基础与上下文修饰仍可用 | 支持复合分析、短查询指令和上下文保留用例 |
| A04 空间实体动作冲突 | 先保护源文本目标名称，再提取分析动作；“进入停车区”只有 ENTER，目标保持“停车区”；支持已识别的区域后缀和引号包围名称 | 含停车/进入/道路关键词及分隔符的目标用例；ENTER 执行用例检查传给目标解析器的名称 |
| A05 统一部署自检 | `smoke` 在实际 `grounding-api` 容器内运行包内运行时验证器，检查 1.2 就绪 Schema、有效期和六种分析能力；缺失能力会失败，`YES/true` 两种启用值均受检查 | 控制就绪响应的成功/失败用例验证执行命令；能力就绪与现场业务验收分别记录 |

同时补充缓存来源校验：统一入口逐文件核对已解包源码与所选包的内容/执行权限，拒绝继续使用旧包或篡改的缓存；允许运行时生成额外文件。升级源码应使用新解包目录并遵循上游迁移步骤。

## 验证

- 在修复前源码运行新的高级历史组件回归，21 项失败、135 项通过；证明本轮针对可复现问题。
- 修复后 `npm run check` 成功：88 个测试文件通过、4 个跳过，1214 项测试通过、49 项 PostgreSQL 用例跳过；包含类型、契约、消费者来源、架构、开发验收及完整测试。
- 单独 `npm run test:postgres -- postgres:17-alpine` 成功：隔离的一次性 PostgreSQL 中 49 项全部通过。未连接现有业务数据库。
- N03 来源报告通过实际执行 120 项相关测试重新生成，全量检查接受其输入指纹。
- `python3 deployment/test_bundle.py`：5 项通过，覆盖可重复生成、目录/链接/摘要拒绝、消费者不匹配及缓存源码校验。
- WSGS 与统一部署包两次独立生成，SHA-256 完全一致。实际解包、两次初始化（身份/密钥不变）、Compose、委托 Gateway/GDPS 映射及解包源码构建全部通过，且容器清单未改变。受控配置为 MODEL_OPTIONAL、禁用 UGV ingest；详情见 [部署验证](deployment-verification.json)、[重复生成证据](reproducibility.json) 及 [总验证](verification.json)。

完整检查、隔离 PostgreSQL 与修复前失败日志保存在本目录；日志摘要与源文件摘要绑定在 `verification.json`。

## 部署交付

- [WSGS 源码部署包](../../output/deployment/releases/2026-10-13-workspace-fixes-631dff623d1c/wsgs-development.tar.gz)，SHA-256：`778c219a9e77948a98c6deb4636fa3309c1258071047cdc89189af03c7cc6202`。
- [GOWM + GDPS + GSAP + WSGS 统一部署包](../../output/deployment/releases/2026-10-13-workspace-fixes-631dff623d1c/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz)，SHA-256：`631dff623d1c3a2ff9d25787ff023f576165a7a0efd1b334fc3e85ddc712bdb8`。
- 上游来源：GSAP 0.1.0 `c963ab2230a6…`，GDPS 0.2.3 `83039247c936…`，GOWM 0.7.1 `1f5dd4002c6d…`，消费者快照 `df52ffc02e1a…`。完整摘要及代码工作区状态已写入包内 SOURCE/MANIFEST。
- 新包未包含私钥、实际环境凭据、node_modules、dist 或生成输出；提供 `.sha256` 外部摘要和完整包内清单。旧部署包保留在 `output/deployment/releases/2026-10-10-before-fixes/`。
- 这是源码在线构建交付；部署机仍须满足 [统一部署说明](../../docs/unified-development-deployment.md) 中的前置条件。升级源码使用新的解包目录，不覆盖旧源码缓存。

## 仍有边界

自由历史时间窗、跨任务/批次聚合、GNSS/振动/多指标联合评分和严格 PINNED 重放列为方案中的上游协作阶段。本轮不扩展冻结契约，也不生成这些未支持功能的结果。

本地开发闭合检查为 63/63，生产资格仍为 false；完整验收台账仍有 17 个 NOT_RUN 和 67 个 BLOCKED 项、14 项开发阶段延后项。真实现场的 SACS/CROSS、非空 RANK、GDPS 正向产品、MQTT、慢模型及选择追问验收为 NOT_RUN。本轮通过项来自本地受控回归与包校验，不代表现场业务验收完成。
