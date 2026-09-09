# GOWM 最新消费者与独立 WSGS 实例验收

日期：2026-09-07。结论：**代码及部署入口已落地，现场业务验收未通过，实例未投入使用。** 不能据此宣称全部计划完成或生产可用。

## 已交付

- `npm run gowm:refresh`：正式发布目录自动选择、联合包来源交叉校验、manifest/exports 与依赖闭包验证、不可变消费者快照及原子指针。
- API/Worker、Schema 注册器、操作锁、GDPS 与分析消费者共用当前快照；删除活动运行依据中的固定 GOWM 版本/数量断言和旧版默认回退。显式外部锁也必须匹配当前正式快照。
- semantic profile 1.1、当前引用类型/快照 Schema，以及现有历史、新增区间操作所需契约已纳入。GDPS 当前描述符为 36 个产品类型、37 个 profile；数量来自正式数据。实验能力不因目录可见而自动获得执行授权。
- 追问检查点新增消费者快照绑定：过期仍按原规则拒绝，快照不同则返回既有 `SELECTION_INVALID`；不重算历史检查点或延长任务截止时间。
- 现场发现并修复南向请求标识约束差异、重复操作输入/预算变化导致的幂等键冲突。保留北向请求标识，南向使用确定性合法标识；相同线协议请求的传输重试保持幂等。
- 可重复执行的独立部署入口、配置生成器、正式迁移、签名发现预检、排空脚本及真实业务验收入口。Gateway 构建源码直接取自核验后的正式归档，不再依赖服务器已有源码目录。每次部署构建后及验收后重新检查是否出现更新发布。

运行说明：[latest-gowm-instance.md](../../docs/latest-gowm-instance.md)。未提交 Git；未修改已发布迁移或生产资格声明。

## 本次正式来源

| 项目 | 实际记录 |
|---|---|
| GOWM runtime / consumer / Gateway 契约 | 0.7.1（本次观察值，无版本上限） |
| GOWM 来源提交 | `8f9508ce8d6628970b31b10c0f8ca6455678d4a1` |
| GOWM 正式包 SHA-256 | `6144a0b68f47f8414a56941b7abbddc108995f9137ddfa15a1568e597793d906` |
| GDPS/GOWM 联合包 | GDPS 0.2.2 / GOWM 0.7.1 |
| 消费者快照摘要 | `24ec002b87ad4a638d8ca52cb72013cfd2916304a78a44025de2681cf694c7ac` |
| 当前发现目录 | 158 项能力、158 个语义 profile；不作为永久数量断言 |

完整来源与衍生摘要：[consumer-snapshot.json](consumer-snapshot.json)。正式包原文、模型凭证、数据库凭证及签名私钥均未写入报告。

## 验证结果

| 验证 | 本次结果 |
|---|---|
| `npm run check` | 通过：992 项测试通过，默认环境下 47 项 PostgreSQL 测试跳过 |
| 独立真实 PostgreSQL 集成 | 4 个文件、47/47 通过；一次性 PostgreSQL 容器及卷已清理 |
| 正式包机制测试 | 9/9 通过，包含完整模拟 9.0.0 包、缺失依赖、刷新中发布变化、同版本重发、最新损坏不回退及不安全归档 |
| 当前 Schema 闭包 | 84 个 Schema 编译及锁验证通过 |
| 当前正式元数据 HTTP 回归 | 14/14 通过；属于受控 HTTP 测试，不算现场业务证据 |
| 实际签名发现 | 通过，158 项目录与当前快照摘要一致 |
| Gateway 错误签名 / 越权 scope | 分别返回 403 / 403 |
| 实际 API 取消 / 越权读取 / 错误签名 | CANCELLED / 404 / 401 |
| 实际幂等重放 | 已产生的失败任务和合法 PARTIAL 结果均保持一致 |
| 升级排空及正常停机 | 排空入口成功；本次排空时活动任务为 0，API/Worker 均以退出码 0 停止 |
| 基础、历史、T2/T3/T4、GDPS 全链路 | **未通过**，详情如下 |

测试证据：[check.txt](check.txt)、[postgres-tests.txt](postgres-tests.txt)、[publication-tests.txt](publication-tests.txt)、[signed-preflight.json](signed-preflight.json)、[lifecycle.json](lifecycle.json)、[shutdown.txt](shutdown.txt)。模拟 9.0.0 包只证明消费者升级机制，不代表存在真实 9.0.0 正式发布。

## 现场阻断与真实任务

第一轮通过实际 API → Worker → qwen3.8-27b → 签名 Gateway → Provider 执行七类请求，未使用 fixture 替代现场响应。完整任务标识及结果见 [initial-business-attempt.json](initial-business-attempt.json)。

- 基础查询与 GDPS：World Query 的 `world.get-current-state` 节点返回 `INVALID_REQUEST`。需要继续核对引用解析后的 DAG 输入；尚不能认定为已修复。
- 历史：第一轮出现 `HTTP_409_IDEMPOTENCY_CONFLICT`。修复后任务 `grounding-3621a7ca-b54f-4796-8a10-bc8fdb9c2269` 返回可校验且可幂等重放的 PARTIAL，但没有历史业务证据，仍判为验收失败：[final-trace.json](final-trace.json)。
- T2 地图匹配、T3 停车：第一轮返回带阻断性 `UPSTREAM_FAILURE` 的 PARTIAL，未形成业务 finding。
- T3 路口及 T4 排名：第一轮返回 `UPSTREAM_CONTRACT_MISMATCH`，未形成业务 finding。具体契约失败位置仍需进一步隔离，不能用空 PARTIAL 作为通过。
- 已独立复现一个上游根因：现有 `gowm.operational-reality` 的只读任务查询本身成功，但 Provider `operational-task.get` 的快照生成抛出 PostgreSQL `42501 / permission denied for table world_reference_identity`。仅做只读诊断，未修改现有 Provider、授权或业务数据：[provider-blocker.json](provider-blocker.json)。这项根因不能替代对所有失败链路的逐项诊断。
- 真实取消任务：`grounding-a0bbac5d-7afc-40fc-bad8-8de74c5126fe`，最终 `CANCELLED`。

需要继续完成的验收：成功历史/T2/T3/T4/GDPS 链路，真实有效 Choice 追问及自然到期拒绝，存在活动任务时的升级排空，以及最终部署入口从构建到成功激活的完整执行。上述事项未被单元测试或历史报告替代。现有测试证明了过期与快照拒绝逻辑，但不等于本次现场 Choice 验收。

## 实例交付状态

- 项目：`wsgs-live`，服务器根目录：`/mnt/data/wsgs-live`。
- 实际运行验证镜像：`wsgs:9172769eb1baa98dbbb2`。
- 最终源码和部署工具候选：`/mnt/data/wsgs-live/releases/2330752e00f4e2768d38`，状态 **PREPARED / activated:false**。最终工具修订尚未完成从该候选到业务验收通过的部署；不能把此前镜像测试冒充最终候选验收。
- API 回环端口为 18082；**目前 API 与 Worker 已停止**，不开放业务访问。两套独立 PostgreSQL 健康，内部签名 Gateway 保留用于诊断。
- 原静态 Gateway 仍健康，镜像 ID 未变；GPUStack 保持运行。未更新成功激活指针，不自动回退旧 GOWM。

状态证据：[instance-status.json](instance-status.json)、[prepared-release.json](prepared-release.json)。生产延期事项和原有生产资格状态保持不变。
