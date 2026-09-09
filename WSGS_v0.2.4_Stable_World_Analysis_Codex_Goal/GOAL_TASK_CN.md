# 总任务：WSGS v0.2.4 稳定通用世界分析服务与北向合同冻结

## 1. 背景与工程顺序

此次工作替代“同时修改 SACS、SDAR、SMPP，边实现边对齐”的推进方式。目标顺序为：

```text
当前：WSGS 基线收口 → 北向合同冻结 → WSGS 实现和独立开发验证 → C1 消费交接包
后续独立任务：冻结 C2/C3 → 各仓库并行实现 → 两两联调 → 全链路用例
```

本任务只完成当前一行。不能把后续 SACS、SDAR、SMPP 的实现或验收偷放进本任务的完成门。

“稳定”在这里表示：对外模型明确、合同可版本化、输出经过校验、错误和不完整数据语义可预测、消费者无需依赖 Provider 内部代码。不是对上线环境、吞吐、HA、恢复目标或生产 SLA 的保证。

## 2. 范围和既有基础

允许修改 WSGS 的 `contracts/`、`packages/`、`services/`、必要配置、增量迁移、测试、验证脚本、文档、报告和专用 execplan。必须在现有分层中落地，不重建整个项目。

保留基础 Grounding、GDPS geospatial、Historical Trace/T5、签名 Gateway、服务端结果权威、作用域校验、deadline/cancel/recovery/idempotency 等既有能力。先核对实际源码，不能根据旧阶段报告推定当前分支已全部具备。

可只读访问其他仓库的冻结合同；优先使用 WSGS 已固定的上游副本。若上游缺失新能力，仅将该能力标为不可用并给出类型化缺口，不能修改上游来满足本任务。当前不新增多执行分析、组合指标评分、单位自动转换、道路级指标排名、路线规划或设备控制。

## 3. 工作项和协议版本分离

| 名称 | 目标 |
|---|---|
| 工作项 | `WSGS v0.2.4` |
| 专用分支 | `codex/wsgs-v0.2.4-stable-world-analysis-service` |
| 新协商合同 | `sacs-wsgs-grounding/1.2` |
| 新公共结果 profile | `wsgs-world-analysis-findings/1.0` |
| 旧合同 | `sacs-wsgs-grounding/1.0`、`sacs-wsgs-grounding/1.1` |
| 旧 geospatial profile | `sacs-wsgs-geospatial-findings/1.0` |
| 最终开发完成标志 | `WSGS_STABLE_GENERIC_WORLD_ANALYSIS_SERVICE_DEV_READY` |

`1.2` 必须精确显式协商，不因请求正文提到历史分析、User-Agent、Accept 或启用全局 Preview 而自动切换。新 profile 是 WSGS 通用语义，不含 SACS 会话、SDAR Skill、SMPP 执行模型。

执行时如果 `1.2` 已被其他变更占用，先核验内容；完全一致可复用并记录来源，不一致必须报合同冲突，不能覆盖已冻结版本或擅自换号规避。

工作项编号不构成软件版本升级授权；保持当前 `VERSION`、package 发布版本、镜像标签和发布资格，除非仓库已有必须同步的内部生成规则，且明确其不是 release。不得用版本递增冒充验收完成。

## 4. 目标能力

在新协商响应中新增 `worldAnalysisFindings`，与既有 `geospatialFindings` 并列。五类公共 Finding：

| findingKind | 职责 | 不得推导的含义 |
|---|---|---|
| `HISTORICAL_TRACE` | 任务、主体、执行区间、轨迹范围、缺口与封存状态 | 缺口期间持续移动或静止 |
| `ROAD_ASSOCIATION` | 已确认道路访问、离路、歧义和网络数据问题 | 离路即非法/错误移动 |
| `TEMPORAL_EVENT` | ENTER/EXIT/DWELL/STOP/PASS_NEAR/CROSS、FIRST/LAST 限定 | 不完整首尾下的绝对最早/最后 |
| `METRIC_RANKING` | 已观测位置域内、明确指标和排序依据的 Top-K | 全域最优、当前最优、组合指标评分 |
| `ACTION_TARGET_CANDIDATE` | 带历史证据的设备无关移动目标候选 | 可执行任务、当前可达、已经授权 |

额外提供通用 Choice、Gap。Candidate、Finding、ReferenceProduct、ReferenceKey、Evidence 必须具有明确且不混用的身份关系。完整语义见 `design/`。

## 5. 合同优先，不是先把代码写完再导出

W01 必须先完成：完整 Schema 引用闭包、字段条件、状态映射、协商矩阵、选择回传、hash 算法和范围、capabilities、limits、例子、错误词表、兼容说明、冻结清单与正反例校验。此时只允许合同、类型/验证器生成、离线合同测试和必要生成脚本，不允许引入新运行时行为。

冻结记录至少包含合同 ID/profile、工件路径与真实 SHA-256、语义决策文档、冻结范围、执行时来源提交和完成的校验命令。冻结提交在 W02 新逻辑之前。不得把整个仓库 HEAD hash 写进自引用工件造成无法收敛的 hash 循环。

被冻结的是对外可观察行为；内部函数、Provider 适配方式、数据结构布局和部署方式不冻结。但分页/裁剪含义、客户端可见限制、重试/选择语义属于外部行为，必须有合同规则，不能说“性能参数不冻结”就随意改变。

冻结后必要更改走变更记录：未分发的冻结候选可明确撤销并重做 W01；已交接的合同必须新增版本并重新评估消费者，不能原地重写。不要创建复杂协议治理平台。

## 6. 实施顺序与阶段门

| 阶段 | 交付 | 进入下一阶段的条件 |
|---|---|---|
| W00 | 基线对账、来源清单、变更和验证基线 | 已含主线修复和历史分析基础，无跨仓写入 |
| W01 | 机器合同与冻结提交 | 合同、示例、语义和兼容检查全部通过 |
| W02 | 五类结果适配与裁剪 | 类型校验、来源关系、语义保真通过 |
| W03 | API/worker/存储/幂等协商闭合 | GET/重试/恢复不换 profile 或结果 |
| W04 | 选择回传、历史复用和非执行目标 | 选择权威、失效与来源检查通过 |
| W05 | 能力发现、降级、默认配置隔离 | 单能力失败不破坏无关基线能力 |
| W06 | 回归、本地 HTTP 开发链路、证据 | 适用 Required 检查通过，未运行项显式记录 |
| W07 | 独立消费者交接包、复查、Draft PR | 72 项 Required 全部 PASS 后才给 DEV_READY |

默认按顺序执行。W01 之前不得并行启动新运行时实现；合同冻结之后，只允许在本仓库内按无冲突模块拆分工作，必须共享相同冻结 hash。不要启动其他仓库实现任务。

## 7. 运行时稳定性要求

复用现有异步 Job 生命周期。正常业务结果与协议错误分开：HTTP 200/202 不代表业务“全部完成”；GroundingResult 的终态不新增 PENDING。真实在跑的 WSGS Job 留在已有非终态；上游历史投影未就绪可以结束本次查询为 PARTIAL + 对应 Gap，下次以新的请求重查，不无限挂住。

同一幂等请求必须绑定规范化请求正文、协商结果和既有作用域。选择、指标、阶段或 profile 改变不能复用旧结果。保留现有冲突优先级，精确写入 W01 的状态映射表。恢复时从服务端保存的请求和协商元数据恢复，不能从 GET 的新 Header 重新解释旧任务。

旧数据库迁移不可改写；必要时只追加迁移并保留旧记录读取策略。持久化实现变更的单元测试不等于真实 PostgreSQL 验证；无数据库环境可以交付相应测试并记 NOT_RUN，但不得宣称数据库迁移/恢复已实测通过。

## 8. 验证与完成资格

必须运行仓库当前实际存在的 `npm run check`、`npm test`、`npm run build`，并补齐或使用等价新命令：

```text
npm run verify:world-analysis-contract
npm run smoke:world-analysis:fixture
npm run test:world-analysis:http
npm run verify:world-analysis:handoff
```

这些新命令是本任务交付要求，不声称基线已经存在。全部默认不依赖 Docker、真实 Gateway、真实设备或真实 SACS。根据仓库现有工具实现，避免加入重型新框架。

L1 本地 HTTP 测试必须使用独立临时端口和测试身份，穿过生产使用的 WSGS 模块装配。允许测试专用内存 Store、受控模型输出和契约校验过的 Gateway 响应，但必须明确哪些边界被替换；不得增加可在正常配置下悄然启用的 Fixture 成功路径。必须测试一次同步响应、一次异步创建/worker 完成/GET，以及选择下一轮。

L2 的真实 Gateway/Provider、真实 PostgreSQL、真实模型、真实 SACS、设备执行分开记账，不允许一个 `live=true` 代表全部真实。未知/未运行为 NOT_RUN；缺少依赖不是 PASS；Deferred 也不是 PASS。L2/L3 不扩大本次 Required 范围。

只读检查现有 health/ready 行为可以用于防止回归，但不重新引入 WSGS Readiness 黑盒总资格或 Data Platform Readiness 验收，不输出 `WSGS_READY` 或 `DATA_PLATFORM_READY`。

报告记录被测代码提交；有未提交代码时记录 diff hash。只需合理开发证据，不要求每次写报告后重新构建精确 HEAD 镜像。历史 PR 的测试数字只作观察记录，不当作本次测试结果。

## 9. 交付位置

建议沿用仓库目录：

```text
contracts/wsgs-v0.2.4-world-analysis/   # 真正的冻结合同，W01 生成
contracts/consumers/sacs-world-analysis-v1/ # 可分发的 C1 消费者合同包
packages/contracts/                  # 从唯一 Schema 真值导出的类型/验证器
execplans/EP-wsgs-v0.2.4-stable-world-analysis-service.md
reports/wsgs-v0.2.4-stable-world-analysis-service/
```

模块命名和细分路径可适配实际代码；公共身份、语义、执行顺序和冻结门不得省略。无需建立第二套 Native Handoff 工件体系。

最终报告至少给出：总状态、各层验证、72 行台账、测试日志索引、基线与被测来源、旧合同 hash 对比、新合同冻结记录、行为限制、交接包校验、Draft PR 状态及剩余阻塞。`templates/` 是初始 NOT_RUN 模板，不能原样当完成报告。

## 10. 明确禁止的结论

合同冻结不等于运行时全部能力已部署；Fixture 通过不等于真实 Gateway 可用；本地 HTTP 开发链路不等于真实 SACS 全链路；行动候选不等于当前推荐、可达性证明、任务批准或设备执行；DEV_READY 不等于发布资格。
