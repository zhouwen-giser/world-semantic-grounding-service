# WSGS 首轮真实联调（2026-09-07）

结论：**BLOCKED，尚未完成 WSGS 北向业务端到端联调**。已连接实际服务器、读取正式契约，并使用 WSGS 真实 Gateway 客户端和语义模型适配器执行检查。未修改服务器部署、账号计费或本机凭证，未跳过契约验证。

## 实测结果

| 检查 | 结果 |
|---|---|
| sz-gowm Gateway 存活、就绪 | PASS，两项均 HTTP 200 |
| 服务器能力与语义目录 | HTTP 200，各 158 项 |
| 当前 WSGS 客户端读取可用性 | PASS，158 项通过现有响应校验 |
| 当前 WSGS 客户端读取能力目录、语义目录 | BLOCKED，HTTP 200 但 RESPONSE_SCHEMA_MISMATCH |
| 当前 WSGS 导入服务器正式操作锁 | BLOCKED，OPERATIONAL_LOCK_SCHEMA_MISMATCH |
| qwen3.8-27b WSGS 真实模型门禁 | PASS，六个场景全部通过 Schema、精确 UTF-16 提及及权限字段检查 |
| WSGS API → PostgreSQL → Worker → 模型 → Gateway → 结果落库 | NOT_RUN，前置条件未满足 |

## 已定位的阻碍

1. **模型阻碍已解除**：按用户更新后的 qwen3.8-27b 配置，真实六场景门禁通过：车辆位置、模糊道路、区域内车辆、邻近距离、地表覆盖及提示注入。之前 qwen3.8-plus 的 404 和 qwen3.7-plus 的免费额度 403 仅作为历史诊断保留，不代表当前模型状态。未变更计费配置。
2. **消费者契约滞后**：当前仓库锁定 Gateway/消费者包 0.6.3，服务器正式锁为 0.7.1。正式锁含新字段，本地常量与 Schema 拒绝导入。锁中操作数由 120 变为 122，新增历史轨迹和任务执行区间；另有两项原操作输出 Schema 摘要变化。
3. **运行时语义差异**：历史轨迹、任务执行区间及 T2/T3/T4 均使用 semanticProfile.profileVersion=1.1，现有 WSGS 校验器不接受相应版本、新引用种类及部分快照策略字段。这不是只改版本号就能修复的问题。
4. **WSGS 实例配置尚未完成**：本机数据库、请求加密密钥、JWT 密钥、Gateway 令牌及授权 Scope 仍为占位值，委托私钥文件不存在，历史开关关闭。现有远端 Gateway 为 STATIC_SERVICE，未配置签名委托参数；这些仍需在接入方案中明确，不能算委托身份已验证。

第一次全目录探测中，任务区间操作短暂报告 PROVIDER_UNREACHABLE；随后三次单操作实时复查均为 AVAILABLE。T2/T3/T4 在本次可用性检查中均为 AVAILABLE。以上状态仅证明采样时可用，不替代业务结果验证。

引用任务《检查功能实现与项目遗漏》的最新报告提供真实任务 T2/T3/T4 正例证据，但本轮没有把既有 Provider 验收计为 WSGS 端到端通过。没有向现场注入合成观测、删除数据或改变算法阈值。

## 后续顺序

- 模型六场景已通过，后续端到端使用当前 qwen3.8-27b 和现有密钥。
- 正式对齐 GOWM 0.7.1 消费者包、操作锁、Schema、语义版本和历史引用类型，保留哈希与权限校验。
- 配置隔离的 WSGS 数据库、API/Worker、可信身份和与服务器相符的 Gateway 接入方式。
- 运行参考解析、查询编译、历史轨迹、道路关联、STOP/CROSS、指标排名及追问的北向端到端用例；分别记录 PASS、PARTIAL、FAIL、BLOCKED 和 NOT_RUN。

## 证据文件

- `gateway-discovery.json`：实时服务器发现摘要。
- `wsgs-client-preflight.json`：WSGS 真实客户端经临时 SSH 回环隧道访问服务器的结果，隧道已关闭。
- `server-operation-lock.json`：服务器正式 WSGS 操作锁原件，不含凭证。
- `contract-preflight.json`：本地锁与服务器锁的实际差异和导入错误。
- `response-schema-differences.json`：真实响应对本地 Schema 的校验错误。
- `task-interval-availability.json`：任务区间可用性的三次复查。
- `model-gate.json`：qwen3.8-27b 六场景实际通过证据与哈希。
- `model-preflight.json`、`configuration-preflight.json`：脱敏模型及配置诊断。

生产延期清单和生产资格状态未改变。
