# WSGS v0.2.4：稳定通用世界分析服务 Codex Goal 任务包

**任务范围：只修改 `zhouwen-giser/world-semantic-grounding-service`。先冻结合同，再实现，再完成 WSGS 独立开发验证。**

本包是可执行任务规范，不是已经发布的协议包，也不是代码完成报告。`v0.2.4` 是本次工作项编号，不自动修改仓库软件版本、Docker 标签或发布状态。生成日期：2026-09-06。

## 启动

把整个目录放到 WSGS 工作区根目录，目录名保持为 `WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal`。打开该仓库的 Codex 会话，将 `CODEX_MASTER_PROMPT.md` 中的 Goal 指令完整粘贴执行。若使用 `/goal`，后面跟该文件中的目标正文，不要再套一层重复 `/goal`。

先执行任务包自身校验：

```bash
node WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/tools/verify-package.mjs
```

该命令只校验本任务包完整性、阶段依赖、验收矩阵和模板，不运行 WSGS，不证明服务已经可用。

## 阅读顺序

1. `CODEX_MASTER_PROMPT.md`、`GOAL_TASK_CN.md`：范围、目标、完成条件。
2. `sources/SOURCE_AUDIT_CN.md`：已核验的源码入口和观察基线。
3. `design/CONTRACT_AND_SEMANTICS_CN.md`、`design/COMPATIBILITY_AND_SELECTION_CN.md`：W01 必须冻结的协议决策。
4. `tasks/W00_*.md` 到 `tasks/W07_*.md`：分阶段执行。
5. `acceptance/acceptance-matrix.csv`、`acceptance/development-cases.json`：逐项验证。

## 核心产物

WSGS 中形成 `sacs-wsgs-grounding/1.2` 与通用结果模型 `wsgs-world-analysis-findings/1.0`，包含五类 Finding、Choice、Gap、同一 Grounding Job API 上的协商与结果复用，以及消费者可独立使用的合同交接包。

旧 `1.0`、`1.1` 合同及 geospatial profile 不得被原地改写。新分析能力不得通过全局开启 PREVIEW 或绕过 GOWM Gateway 获得。

## 验收层级

| 层级 | 本次要求 | 可支持的结论 |
|---|---|---|
| L0 合同/单元/归一化 | Required | 合同自洽、核心语义可验证 |
| L1 本地 HTTP 开发链路，依赖受控 | Required | WSGS 自身开发链路闭合，不等于真实跨服务联调 |
| L2 真实 Gateway/Provider、真实 PostgreSQL、真实 SACS | Optional；未运行必须记录 NOT_RUN | 只支持实际运行过的子范围 |
| L3 生产性能、HA、灾备、发布资格 | Deferred | 不得据本任务声明通过 |

最终完成标志：`WSGS_STABLE_GENERIC_WORLD_ANALYSIS_SERVICE_DEV_READY`。仅在 72 项 Required 全部通过、有运行证据且无阻断缺陷时使用。

不创建/合并远程 PR、不发布、不打 Tag、不部署是本任务包生成阶段的状态。Codex 实施阶段可在当前权限内推送专用分支并创建 **Draft PR**，不得自动合并、发布、打 Tag 或部署；权限不足时交付本地提交和 PR 正文，单列远程交付阻塞。
