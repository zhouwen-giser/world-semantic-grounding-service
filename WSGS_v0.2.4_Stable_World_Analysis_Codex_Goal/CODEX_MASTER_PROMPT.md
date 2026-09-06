/goal 仅在 zhouwen-giser/world-semantic-grounding-service 仓库完成 WSGS v0.2.4 Stable Generic World Analysis Service and Northbound Contract Freeze。以本任务包 GOAL_TASK_CN.md 为总任务，严格执行 tasks/W00 到 W07 与 acceptance/acceptance-matrix.csv：先核验并收口最新 main 与现有 Historical Trace/T5 功能，保留恢复、幂等、截止时间修复；先完成机器可读北向合同、示例、状态语义、哈希定义、选择回传语义与冻结检查，再进行运行时实现。完成五类通用 World Analysis Finding、精确 1.2 协商、作用域内结果复用、非执行性目标候选、按能力声明及可独立消费的合同交接包；旧 1.0/1.1 合同不可变。用合同/单元测试和不依赖 Docker 的本地 HTTP 开发链路证明 WSGS 独立闭合，逐项记录 72 项 Required 的证据；在全部通过且无阻断缺陷后才输出 WSGS_STABLE_GENERIC_WORLD_ANALYSIS_SERVICE_DEV_READY。只交付 WSGS 专用分支与 Draft PR，不自动合并、发布、打 Tag 或部署。

## 开始前必须读取

读取当前工作区适用的 AGENTS.md，以及本目录的：

- `GOAL_TASK_CN.md`
- `sources/SOURCE_AUDIT_CN.md`、`sources/observed-baseline.json`
- `design/CONTRACT_AND_SEMANTICS_CN.md`
- `design/COMPATIBILITY_AND_SELECTION_CN.md`
- `tasks/`、`acceptance/`、`templates/`

本包相对路径均以本包根目录为准；源码路径以 WSGS 仓库根目录为准。不要把任务包目录当成另一个应用源码树。可把执行计划和当前进度写入 WSGS 的 `execplans/EP-wsgs-v0.2.4-stable-world-analysis-service.md`；不要覆盖仓库已有 AGENTS.md。

## 必须遵守的约束

只修改 WSGS。GOWM+、GDPS、GSAP、SACS、SDAR、SMPP 只允许只读核对；不得提交、启动或修改这些项目，不生成它们的实现补丁来绕开 WSGS 的缺口。本次不设计或实现 C2/C3 执行协议，不开始三项目联调。

优先复用当前 Grounding Job API、Gateway Client、合同校验、持久化与历史结果权威、Query Compiler、Normalizer。不要另建 Native Analysis Control、Plan/Revision/Intervention API、WebSocket/SSE 分析控制协议、通用任意 DAG 引擎或第二套数据库。

不得把 Provider 原始结果或任意 `Record<string, unknown>` 当成公共业务合同。保留证据来源，不向北暴露不受控 Provider 载荷。不得伪造 ReferenceKey、Product ID、事件、测量、轨迹完整性或执行授权。

`selectedProductIds` 只承载真实 ReferenceProduct ID；分析候选必须有自己的可验证选择回传语义。候选选择、合同 profile、结果 hash 和 actor/data scope 必须贯穿请求、幂等键、持久化、GET 和 worker 恢复，不能只改 API Header。

Action Target 只做设备无关的历史目标候选：`executionAuthorized=false`；要求当前验证、路径规划和后续执行确认，不实现任何设备动作。世界对象 ID 中合法出现 `ugv1` 不属于违规；违规的是把设备控制结构、工具名、Topic、mission_id、速度等写入通用模型或执行链路。

默认测试不依赖 Docker，不要求真实设备或真实 SACS。L1 必须穿过实际 WSGS HTTP listener、请求/响应校验、backend/worker/pipeline 与公共归一化；测试专用受控依赖必须明确标注，不能将高层最终回答 Mock 后冒充开发链路通过。真实 Gateway/数据库/模型未运行必须 NOT_RUN，不计为真实联调通过。

## 执行和停止规则

先完成 W00，然后 W01。W01 合同冻结检查通过并形成专用提交/文件哈希后，才能开始 W02–W05 新运行时逻辑。允许 W01 在冻结前自审修正；冻结后禁止静默改字段、重算 hash 并继续宣称同一冻结版本未变。

每阶段运行对应验证并更新进度，不要完成文档就停。优先修复本仓库内的实现问题。缺少可选外部服务时完成剩余本地工作，不无限等待或反复请求凭据；强制合同冲突或 Required 无法验证时交付已完成部分、具体失败点和最小阻塞条件，不能伪造完成标志。

采用专用分支 `codex/wsgs-v0.2.4-stable-world-analysis-service`。先核验提交包含关系，不能机械重复 merge/cherry-pick T5，也不能远程合并现有 Draft PR。不得 reset/clean 用户工作区，不得 force push。

完成前独立复查全部变更，运行矩阵要求的命令，生成 MD/JSON 最终报告及消费者交接包。在现有权限允许时创建 Draft PR；不能创建则输出本地交付和 PR 正文，不把远程 PR 写成已完成。

最终答复必须分开列出：源码/合同完成情况、Required 结果、可选真实验证运行范围、未运行项、冻结合同身份、交接包、提交与 Draft PR、剩余阻塞。不得声称 Production Ready、Release Qualified、Strict Replay Ready、真实 SACS/UGV 全链路验收通过。
