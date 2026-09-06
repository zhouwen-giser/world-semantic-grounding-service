# W07 — 消费者交接、最终复查与 Draft PR

前置阶段：W06。验收范围：WA-064–WA-072。

## 实施要求

从 W01 冻结公共合同构建 contracts/consumers/sacs-world-analysis-v1/，包含公开 Schema/类型/验证入口、完整正反例、README、manifest、checksums 与能力限制。无需带所有上游模型或 WSGS runtime；不得新建 Native Analysis Control 那套控制端口/八件交接体系。

在临时干净目录只使用该交接包验证完整 requests/results/jobs/capabilities/两轮选择例子。不能借用 WSGS 源码 node_modules 的隐式路径、SACS 私有实现、T2/T3/T4 模型或联网 $ref。建立 verify:world-analysis:handoff 和负例：删除依赖、篡改文件、错误 profile 必须失败。

独立复查范围、合同漂移、身份闭包、排名语义、结果裁剪、目标非授权、异常映射和旧版本回归，修复新问题并重跑相关检查。整合 72 项 Required 的状态和证据路径/hash，不允许仅写勾选表无运行日志。

最终 reports/wsgs-v0.2.4-stable-world-analysis-service/ 下生成 FINAL_REPORT.md/json、acceptance-ledger、test evidence index、contract-freeze 引用、handoff 校验、limitations 和 PR_BODY.md。JSON 初始模板不得冒充结果。记录被测代码，不为了最后加报告而重做 exact-HEAD 发布循环。

在当前权限允许时推送 WSGS 专用分支并创建 Draft PR。不要合并 PR #14 或新 PR，不 Tag、不 Release、不部署。远程写入受限则保留本地提交和 PR 正文，把 remoteDelivery 标 BLOCKED；已实证代码/合同开发资格与远程交付状态分开记录。

只有 Required 全部 PASS 且无阻断代码/合同问题，才给最终 DEV_READY。真实跨服务/数据库/模型未跑保持 NOT_RUN，不将本地交接验证解释为真实 SACS 集成通过。

## 优先修改/核对入口

- `contracts/consumers/`
- `reports/`
- `execplans/`
- `validation/scripts/`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W07/`，至少包括：`handoff-validation.json`, `review.md`, `FINAL_REPORT.md`, `FINAL_REPORT.json`, `PR_BODY.md`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-064 | 交接包仅含公开合同和必要闭包 | handoff manifest/导入扫描 |
| WA-065 | 独立干净目录可验证完整样本 | verify:world-analysis:handoff |
| WA-066 | 交接包的篡改/缺依赖/错 profile 反例失败 | negative handoff tests |
| WA-067 | 具备完整消费指南和选择/cancel 例子 | README/OpenAPI/examples 核对 |
| WA-068 | 72 项 Required 台账都有真实证据 | acceptance-ledger/evidence index |
| WA-069 | 独立复查并关闭阻断缺陷 | review.md 和必要重跑记录 |
| WA-070 | 提交与 Draft PR 状态如实交付 | git/PR 记录或明确远程阻塞 |
| WA-071 | MD/JSON 报告与来源/未运行项一致 | 最终报告一致性与证据检查 |
| WA-072 | DEV_READY 只由 Required 全通过支持 | 全台账汇总和结论检查 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
