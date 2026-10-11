# WSGS 功能落实问题最小修复（2026-10-11）

结论：F01–F07 的本地最小修复与回归验证完成。最终 `npm run check` 退出码为 0：**88 个测试文件通过、4 个跳过；1157 项测试通过、49 项跳过**。自由时间窗和复合分析采用明确拒绝的最小方案，尚未新增完整时间窗分析或多分析 DAG 能力。

基线提交：`00f66257c601e128d8cc6ab6957183f78139dfbf`。验证时修改保留在原分支 `codex/wsgs-v0.2.4-stable-world-analysis-service` 的工作区中，尚未提交；后续提交及推送状态以 Git 记录为准。本次未部署、未重新打包。原始审计及失败复现保留在 [审计报告](/home/zhouwen/web-download/world-semantic-grounding-service/reports/function-realization-audit-2026-10-11/README.md)；其中 `probe.ts` 是修复前基线，不能作为修复后通过断言使用。

## 修复结果

| 问题 | 修复后的行为 | 验证证据 |
|---|---|---|
| F01 历史追问复用错误范围 | 比较主体、任务、执行选择、阶段和显式数据源/跟踪会话；变化后重查。仅继承省略的上下文，切换任务时不携带旧主体，简短追问也保留显式对象。有效复用结果继续保存原始查询范围。 | 组件回归覆盖各范围变化、过期及更新请求；生产 HTTP 三轮测试验证“原轨迹 → 排除暂停后重查 → 完整性追问复用”，后续范围仍为 ACTIVE_PHASES_ONLY。 |
| F02 明确时间窗被忽略 | 检测文本及语义帧中的不支持时间条件，返回 `CAPABILITY_UNAVAILABLE`，`detail.reasonCode=HISTORICAL_TIME_WINDOW_UNSUPPORTED`；停止历史与分析查询。 | ISO、中文日期/时刻、相对窗口、英文窗口、模型时间约束、普通历史及高级 HTTP 负向回归。 |
| F03 任务独立高级入口缺少主体产品 | 普通与高级新鲜历史基础共用主体接纳：任务 actor 归属、逻辑身份、授权 `reference.get` 与 `reference.validate`。接纳当前有效版本后再分析，保留历史主体版本。拒绝时停止 Provider 调用。 | 任务独立 TRACE/MAP/RANK 的生产 HTTP 测试均产生有效 WORLD_OBJECT 产品与关联 Finding；SCOPE_DENIED 不产生主体产品或 Finding，不调用道路分析。 |
| F04 慢处理耗尽 Choice 生命周期 | 新结果按装配时刻给予最多 60 秒，并以原引用/基础证据租期为上限。过期源不产生可用 Choice；GET 和幂等重放保持原字节，不续期。 | 72 秒处理耗时模拟、引用有效期上限、无效/过期租期、即时选择追问和 GET/重放回归。 |
| F05 复合分析静默丢子句 | 不同分析类型、事件类型及冲突的 FIRST/LAST 选择返回 `CAPABILITY_UNAVAILABLE`，原因 `MULTI_ANALYSIS_NOT_SUPPORTED`，要求拆分请求。 | ENTER+EXIT+DWELL、道路+STOP、RANK+CROSS、FIRST+LAST 组件回归及公开 HTTP 零分析调用验证。 |
| F06 能力发现与规划开关不一致 | 发现、历史规划及南向锁选择统一使用 `history && (preview || advanced)`；高级 Provider 的精确 PREVIEW 授权保持原规则。 | 全部 8 个布尔组合及 HISTORY=YES、ADVANCED=YES、ALLOW_PREVIEW=NO 的普通历史 HTTP 正向测试。 |
| F07 高级仅编译没有成功分支 | 有仍有效且范围匹配的服务器历史基础时复用同一编译器，输出并持久化真实计划；不执行历史或分析操作。目标事件要求已有可信目标；基础缺失/过期仍返回 gap。编译和执行共用选择有效期与引用校验。 | MAP/CROSS/STOP/RANK 纯编译测试，基础缺失/过期、目标缺失、引用版本或租期失效回归；公开 HTTP RANK 选择后仅编译成功、计划写入、零历史/Provider 调用、GET/重放一致。 |

主要实现：[历史意图与复用](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/intent.ts)、[时间约束](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/constraints.ts)、[高级意图](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-intent.ts)、[高级编译/执行](/home/zhouwen/web-download/world-semantic-grounding-service/packages/historical-trace-consumer/src/advanced-executor.ts)、[生产流水线](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/production-module.ts)、[公开结果装配](/home/zhouwen/web-download/world-semantic-grounding-service/services/grounding-worker/src/world-analysis-result.ts)。

接口和配置：不新增 HTTP 接口、环境变量或公开枚举。继续使用已有 typed gap，并在现有 `detail.reasonCode` 中保留具体原因。本次未更改模型配置、120 秒请求预算、STATIC_TRUSTED 匿名访问方式、远端 GOWM 数据范围或业务数据。

## 同步修复的交付验证缺口

- **部署验证**：一键部署新增匿名 1.2 能力探测，校验快照有效期及 HISTORICAL_TRACE、ROAD_ASSOCIATION、TEMPORAL_EVENT、CROSS、METRIC_RANKING、ACTION_TARGET_CANDIDATE。HTTP 200 但能力不可用仍失败；输出区分服务就绪和 `businessAcceptance=NOT_RUN`。Dockerfile 已包含该验证脚本。
- **现场业务断言**：TRACE 要求有效样本与主体，MAP 要求非空道路，STOP/CROSS 要求对应事件，CROSS 还要求两个分析操作，RANK 要求非空历史观测位置候选。GDPS 默认验证正向 Finding；`GDPS --expect-no-data` 只验证无数据传播，明确 `businessStatus=NOT_PROVEN`。取消及 JWT 负向测试需显式选择；STATIC_TRUSTED 不构造客户端 JWT。
- **GDPS 台账**：当前九个交付文件通过 intake；30 个操作、34 个产品类型、35 个描述符。重新执行缺 CHECKSUMS.json 的临时副本负向测试。仅将当前源码/契约已验证的 9 项登记 PASS，另 318 项仍 NOT_RUN，整体 BLOCKED；移除已过时的“当前缺三个文件”原因。详见 [当前验证记录](/home/zhouwen/web-download/world-semantic-grounding-service/reports/wsgs-v0.2-gdps-v0.2.1/current-intake-verification.json) 和 [台账](/home/zhouwen/web-download/world-semantic-grounding-service/reports/wsgs-v0.2-gdps-v0.2.1/acceptance-ledger.json)。
- **N03 证据**：完整检查发现原有 focused execution 记录的输入指纹过时。实际重跑对应四个测试文件，120 项通过后重新生成六份 N03 证据；真实上游状态继续为 NOT_RUN。

## 验证记录与边界

最终全仓命令：

```bash
npm run check
node validation/scripts/generate-gdps-v021-acceptance-ledger.mjs
git diff --check
```

`npm run check` 含配置覆盖、上游/公开/内部契约、生成类型、架构边界、验收台账一致性、开发闭环、TypeScript 和全部 Vitest。128 个运行时/Compose 配置项的 `.env.example` 模板和说明覆盖检查通过。GDPS 台账命令退出码为 0，表示台账与证据一致，输出的验收结论仍是 BLOCKED。

完整日志：[check.log](/home/zhouwen/web-download/world-semantic-grounding-service/reports/function-realization-fix-2026-10-11/check.log)。结果、文件 SHA-256 与日志摘要见 [verification.json](/home/zhouwen/web-download/world-semantic-grounding-service/reports/function-realization-fix-2026-10-11/verification.json)。

49 项跳过来自四个 PostgreSQL/升级集成测试文件：未设置 `TEST_DATABASE_URL` 与 `TEST_UPGRADE_DATABASE_URL`。本次没有临时指向共享业务库来消除跳过。HTTP 回归运行实际 API、Worker 和生产阶段，通过签名 Gateway 的本地受控 HTTP 服务消费严格契约 fixture，持久化使用隔离内存存储；它不证明 PostgreSQL 崩溃恢复或真实现场数据可用。

F04 的 72 秒场景通过回拨 LOAD_CONTEXT 的开始时间模拟处理耗时，使用真实结果装配及即时 HTTP 追问；没有等待真实模型运行 72 秒。源引用的到期时间未延长。

仍未执行：新部署包构建、远端更新、真实 SACS→WSGS→GOWM 业务验收、现场 CROSS/非空 RANK/GDPS 正向数据及真实模型慢调用后的追问。已有生产延期项仍为 14 项；原有 v0.2 完整验收台账仍 BLOCKED，本次不宣称生产资格或全部产品能力完成。
