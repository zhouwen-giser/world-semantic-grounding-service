# W00 — 基线对账与收口

前置阶段：无；首先执行。验收范围：WA-001–WA-009。

## 实施要求

先读适用 AGENTS.md、git status、当前 branch/remotes、main 与 PR #14 当前状态。对照 sources/observed-baseline.json，记录实际 main/head 和 merge-base。观察 SHA 不是强制回退点。

确认 main 中 recovery/idempotency/deadline 修复已被保留；确认 T5 已包含 Historical Trace 基础。使用 git merge-base --is-ancestor / log / diff 判断：已包含的不重复合并；未包含的只在 WSGS 专用分支本地集成。禁止 gh pr merge、改远程 main、重置用户修改、force push。无法验证当前远端时记录 unavailable，使用已能确证的源码开展不依赖它的工作，不冒充最新基线。

优先读取以下现有路径，并补齐实际调用关系：services/grounding-api/src/{server,schemas,contract-negotiation,production}.ts；packages/grounding-pipeline/src/{contract-selection,backend,canonical,postgres-backend-store}.ts；services/grounding-worker/src/{production-module,result-schema,postgres-store,worker}.ts；packages/historical-trace-consumer/src/；packages/prior-grounding/src/；packages/runtime/src/；contracts/wsgs-v0.1/；contracts/wsgs-v0.2.1-sacs-geospatial/；当前上游锁、package.json 和 CI。

产出一张入口→validator→backend→queue/worker→historical consumer→public result→store→GET 的实际路径图（文字即可），以及旧合同文件集合/hash、新合同新增点和现有测试基线。检查通用化是否可用现有扩展模块完成，不新建任意查询引擎。

运行当前适用检查，记录执行命令、exit code、skipped 和原因。历史测试失败不能因本次范围小而藏起来；先区分可重现既有问题、新引入问题、可选依赖未配置。已知阻断正确性的失败必须修复或阻断对应后续资格。

## 优先修改/核对入口

- `sources/observed-baseline.json`
- `services/grounding-api/src/`
- `packages/historical-trace-consumer/src/`
- `packages/runtime/src/`
- `contracts/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W00/`，至少包括：`baseline.md`, `baseline.json`, `legacy-contract-hashes.json`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-001 | 只有 WSGS 存在实现写入，其他仓库只读 | git diff/status 与变更范围复查 |
| WA-002 | 刷新并记录 main/T5 观察值和提交包含关系 | source/ancestry 对账 |
| WA-003 | 保留 main recovery/idempotency/deadline 修复 | 差异核对和现有定向回归 |
| WA-004 | 历史轨迹和 T5 在同一实施基线可定位 | 依赖、编译和源码入口核验 |
| WA-005 | 保全用户工作区并使用专用分支 | 工作区操作记录 |
| WA-006 | 列出真实请求至结果读取的调用路径 | 源码路径和函数引用对账 |
| WA-007 | 冻结旧公开合同文件清单和真实字节 hash | 哈希脚本与旧版本路径清单 |
| WA-008 | 记录当前命令、测试失败、skip 与依赖条件 | 基线命令日志 |
| WA-009 | 形成执行计划与版本/范围声明 | execplan 和 baseline 审查 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
