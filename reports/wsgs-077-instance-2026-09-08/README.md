# WSGS 077 现场复验

状态：基础查询与 GDPS 真实无数据链路已通过，整体业务验收仍未完成；API/Worker 已停止，候选未激活。

最终消费者快照 `6e668684bd0e52bb714b64e529b7257d356846019e101385c0d49ca3086d6d59`，GOWM b28cde5a、GDPS 联合 35c93adc、GSAP 26652830。上游已完成正式077、指定车辆受控补齐以及当前引用/旧引用校验，属于上游分项证据，不代表WSGS链路通过。

每例前通过签名 Gateway 的 reference.get 读取当前引用，实际任务不固定历史版本812。现有健康数据库验证后复用，应用和迁移显式 no-deps；不更改旧任务 authority。

`npm run check` 997 项通过、47项默认跳过。最近一次真实临时 PostgreSQL 47/47 结果见 ../wsgs-consumer-repair-2026-09-07/final-postgres.txt；本轮未修改数据库存储代码，未将这份结果冒称为再次执行。

生产延期事项与生产资格声明保持不变。

## 消费者快照结果适配

原BASIC grounding-1914b553-0bff-4edc-bda9-7e68463e2a31 在Gateway已COMPLETED，但WSGS旧解析器拒绝requested/effective manifest与节点审计字段，并按旧outputs单独校验hash。已补齐明确字段校验、保留节点/整体快照审计，并验证有效快照与主manifest一致，按正式 `{outputs,effectiveSnapshotManifest}` 内容验证hash；历史不带扩展字段结果保留原规则，未知字段和篡改hash仍拒绝。新增4项回归，完整check **1001通过、47默认跳过**。

修复后BASIC **grounding-f09eae98-d1e0-463f-aee7-ea7194d3d159**：实际API→Worker→模型→签名Gateway→Provider，202→COMPLETED，world.get-current-state实际证据存在，结果Schema与幂等字节重放PASS，耗时43.094秒。见basic-after-snapshot-fix.jsonl。该次为明确的单例诊断，结束后API/Worker均exited0，不更新活动指针、不宣称全量验收。

## 独立未完成项

- 历史任务actorReferenceKeys为空。新MAP grounding-e363f16c-2749-4086-9531-c3dbf3602419 两引用VALID，仅执行operational-task.get即SUBJECT_TASK_MISMATCH。上游只读证据确认事件本身无actor，正在核查可信设备/session与既有车辆关联；不造关系、不修改不可变事件。不将T2/T3/T4认定为已执行。
- GDPS grounding-42a23efe-b821-4841-b34d-b4b0f6fb7526 已越过前置引用，landcover节点DAG_EXECUTION/SCHEMA_MISMATCH/maxItems。GDPS严格2D而世界位置可3D，当前整数组绑定存在维度适配风险；等上游最小错误路径/长度证据，不提前当作NO_DATA结果。
- 当前指标语义目录无speed，通用GDPS概念映射无BUILDING；不通过修改语义或造数据凑成功验收。分析追问、到期、活动升级排空及现有GDPS产品正向消费仍未完成。

## 正式水平位置端口适配

现场最小诊断已确认旧GDPS失败的世界位置数组长度3，landcover节点无Provider envelope且输入校验maxItems失败。正式GOWM d0433bb1新增horizontalPositionCoordinates端口，保留原3D字段与同源快照。WSGS六种GDPS点配方现只选择此正式端口并沿用其声明的精确path/schemaHash；缺端口拒绝，不裁切旧绑定、不改GDPS二维Schema。

最终三方快照 `fa15026a7e9d1c15113b3ca339db8ee73e09eff57bd028ae689bd50bf1b49c21`（GSAP1665a5d5/GDPS69ea8830/GOWMd0433bb1）完整check **1003通过、47默认跳过**，Gateway544文件/三个编译Manifest门禁通过。候选c60a540a0f35ca38005c正在执行GDPS定向诊断，尚未认定业务通过；结束无论结果均停止API/Worker。

## GDPS 真实无数据链路结果

正式二维端口已实际消除input maxItems错误。随后发现并修复专用recipe上下文遗漏：产品类型/profile从正式锁绑定读取并拒绝冲突；正式queryProfile=null保持不设通用profile。新增正式锁NO_DATA回归，完整check **1004通过、47默认跳过**，两针对性文件65通过。

候选f84ac9612b15de80b6c4，真实任务 **grounding-7c9f51cb-9a7f-4ea8-8e1f-03004920211d**：API 202后任务COMPLETED，world.get-current-state COMPLETED、landcover.get-class NO_DATA，各1条Provider receipt。公开结果Schema与幂等字节重放PASS，公开landcover证据upstreamStatus=NO_DATA且unknowns=[NO_DATA]。任务COMPLETED表示证据查询完成，不代表取得地表类别；没有业务数据，也未补造产品。

原验收脚本只查worldAnalysisFindings.gaps，未检查WORLD_EVIDENCE中的明确NO_DATA证据，因此原始日志status=FAILED。原始文件gdps-after-context-fix-original-gate.jsonl完整保留；同一grounding/resultHash的公开证据只读复核与Provider节点回执共同支持修正判定，见gdps-no-data-assessment.json。脚本现要求Provider NO_DATA receipt与公开NO_DATA状态/unknowns同时成立；该断言修订语法检查通过，未冒称原脚本已返回PASS。

诊断后API/Worker均exited0，未激活。历史任务主体关联、T2/T3/T4正向结果、分析追问/到期、活动升级排空和现有GDPS产品正向数据读取仍未完成；历史证据不足不豁免。
