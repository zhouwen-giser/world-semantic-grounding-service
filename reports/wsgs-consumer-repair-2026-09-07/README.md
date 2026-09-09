# WSGS 联调后续修复（2026-09-07）

本地修复及全检通过；最终正式闭包已部署为验收候选，但真实业务复验尚未通过，不能投入使用。现场由 GSAP 任务统一协调。下文保留前期证据，并追加最终轮次结果。

- 已知引用在 REFERENCE_VALIDATE 阶段验证后，编译器原先仍再次解析别名，可能将空候选列表绑定至下游。生产编译现在要求与 mention 对应的唯一、未过期、已验证引用，并直接绑定该引用；无确定引用返回缺口，不生成不存在的 candidates[0] 依赖。不跳过 Gateway 的作用域及权限校验。
- Gateway CircuitOpenError 原先没有稳定 code，被高级执行器误分类为结果契约错误。现新增 GATEWAY_CIRCUIT_OPEN，归类上游故障；安全诊断仅记录阶段、稳定错误分类、最后操作与数量，不记录异常消息、请求值或凭证。
- 最终 TRACE 的 operational-task.get / get-execution-intervals 在受理时 availability=UNAVAILABLE，因此被移出 capturedLock。这不是正式完整锁缺失；原 NOT_REGISTERED 分类已改为 OPERATION_UNAVAILABLE。保留不可用时禁止执行的行为，旧任务授权快照不重写，恢复后用新任务复验。

验证：四个针对性测试文件 189 项通过；npm run check 997 项通过、47 项 PostgreSQL 用例默认跳过。本次未改数据库存储，前一轮真实 PostgreSQL 47/47 记录仍保留在原验收报告，但不冒称为本轮再次执行。

协调任务的现场证据表明：首轮 MAP/STOP/CROSS/RANK 只尝试 operational-task.get，尚未进入 T2/T3/T4，不能将 WSGS 的 UPSTREAM_CONTRACT_MISMATCH 直接归责分析 Provider。地表覆盖 DAG 实际 reference.resolve 为 UNRESOLVED/candidates=[]，GDPS 节点被 SKIPPED，尚无该次 GDPS 执行响应。

GDPS 另确认现场没有 LAND_COVER 产品。后续需验证原用例的真实无数据结果，并对已有产品增加成功读取用例，不能用其他产品伪造地表类别。GDPS 提供了真实建筑精确范围，直接 Provider 读取 7 要素；这尚不是 WSGS 链路通过。

## 最终来源本地验证

最终消费者快照 `d252f82fde5cac747e6b77a4da3fdd34f48adafcb0394fc0bf7232b086842076`：GOWM `84511f649f324ea8c90cc5a706937ea5463c6436ebeaf4954884cfcd401c89be`，GDPS 联合 `d8781e35c6cb68a2afafa0ade00e2ce4c90abf484a73a1ccf7ad577310f708bf`，GSAP `cfa22c315f9cf9c42607d1fbe444da320b219a1b9952c2c538bf11ae7df7f0f4`。

重新执行 `npm run check`：997 通过、47 默认跳过；随后创建独立临时 PostgreSQL 17，四个数据库集成测试文件 **47/47 通过**（见 `final-postgres.txt`），容器已移除。本轮数据库验证为实际重新执行，不引用历史结果。

当前指标目录没有速度语义项，不能将速度排名作为已支持成功用例；不临时修改语义目录或注入观测。通信信号与 LAND_COVER 仍需通过 WSGS 验证真实缺数据行为。

## 最终候选实例与阻塞

候选源码归档标识 `180aac42dd6e21f441e9`，消费者快照同上。Gateway 正式 tar 构建通过 541 个运行文件和编译 Manifest 身份检查；签名发现为 158 项能力及语义，错误签名、外域分别返回 403。API、Worker 健康启动后执行真实新任务，原任务 authority 未改。

首次切换发现运行数据库引用的旧镜像 ID 已不在库存。部署入口已修正为验证并复用健康数据库；仅新建分支检查本地镜像并使用 `--pull never`，记录实际镜像 ID；迁移和应用启动使用 `--no-deps`。健康复用无变更、异常数据库拒绝、正式 helper 参数传递及失败传播的本地验证通过。现场两数据库保持原容器和数据卷，未重启上游数据库或 MQTT。

真实用例记录于 `final-instance-acceptance.jsonl`。BASIC `grounding-3e294c9e-b4c1-47ca-a472-1fddb75e4895` 的引用校验确认车辆版本 812 为 STALE，任务引用 VALID；查询编译返回 CAPABILITY_GAP，空 PARTIAL 不计业务成功。其他历史分析用例也未产生业务证据，不能宣称已经调用或验证 T2/T3/T4。

为消除旧验收引用，脚本已改每例通过签名 `reference.get` 获取当前 key 后才受理；当前该操作返回 `403 SCOPE_DENIED`、Provider `gowm.reference-catalog`、阶段 `PROVIDER_EXECUTION`。此脚本修订语法检查通过，完整成功路径尚受上游阻塞。GSAP 使用实际服务角色、default scope、只读事务检查：identity=1、current_descriptor=0、name_entry=0、scope_resource=1，无 PostgreSQL 错误。根因是现有车辆原生描述符/名称投影缺口，不是权限不足；已交由 GOWM 修复，不补造引用或扩权。

尚未完成：可用 GDPS 产品的 WSGS 成功消费、LAND_COVER 与 radio 实际到达 Provider 后的缺数据验收、T2/T3/T4 业务成功、分析追问/到期以及活动任务升级排空。前期 Provider 直连结果不能替代这些项目。生产延期事项和生产资格声明不变。

本轮最终结果：7 个业务用例均 PARTIAL、无操作证据，验收 FAILED；7 项结果 Schema 与逐字节幂等重放通过。取消任务 `grounding-e9c8610f-a4dc-436c-88ce-34c5a1febfc5` 为 CANCELLED，外域读取 404、错误签名 401。部署失败门禁已停止 API 与 Worker，实际检查均 exited/0；未激活候选。GOWM 已接手正式投影修复，后续等待最新联合包与现场协调通知。
