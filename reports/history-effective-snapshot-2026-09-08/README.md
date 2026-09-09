# 历史查询有效快照适配验收（2026-09-08）

## 修复

普通历史与 T2/T3/T4 基础数据准备共用 World Query。执行区间使用单节点模板，轨迹使用执行区间→轨迹双节点模板，`LATEST_AT_START`、禁止降级。任务发现、任务读取和 actor 当前引用解析保留授权直接操作；区间和轨迹不回退直接操作。

计划在提交前保存于现有 `world_query`，受理标识先落库再轮询；恢复使用已保存计划与幂等标识，写入由现有租约代际隔离。结果复用统一哈希、回执、快照校验，并按正式发布的输出 Schema 验证历史节点。新增历史入口要求 requested/effective 快照均存在。

首轮现场发现：区间节点已收到有效快照并返回 `PARTIAL / OPEN_EXECUTION`；轨迹节点在输入端口校验时失败。模板曾错误地将每个参数绑定到整个请求的 Schema，已分别绑定正式 object/string/integer 端口，完整请求仍按轨迹输入 Schema 严格验证。另外，现仅对明确未执行、没有输入/结果且原因全部为 `NODE_NOT_EXECUTED` 的跳过节点免除执行快照要求，仍校验完整查询清单和节点集合。真实不匹配仍被拒绝，不生成未执行节点的输入哈希或回执。

## 自动验证

- `npm run check`：1015 通过；48 项真实数据库测试默认跳过，下述独立运行补齐。
- PostgreSQL 16.9 一次性容器：48/48 通过，无跳过。包含原文清理、取消、旧租约拒绝、API 幂等、迁移升级及新增历史计划复用/已受理任务标识保留/篡改计划拒绝。首次新增测试使用了不存在的 identity.dataScope，已改为明确授权测试域；升级测试改用全新空数据库，最终全部通过。容器已删除。
- 上游实际 World Query Runtime / DirectExecutionService / Provider Runtime 边界：13/13 通过。测试来自当前 GOWM 源码 `effective-snapshot-runtime.test.ts` 与 `provider-snapshot-context.test.ts`；使用受控数据，不能替代现场业务验收。
- HTTP 业务回归使用 World Query 协议测试端点，验证签名、双节点数据绑定、快照和结果证据。不是现场 Provider 成功证明。

## 现场验收

当前正式来源仍为 GOWM 0.7.1，消费者快照 `edfb07a91457a59dd927884d049b1cb84bc96dac8adff412ab1a2dcc85026472`，正式包 SHA-256 `1ad2edcc2cbe0859e4481401e8cbc82548d35aa89ab9b688cc30caf3c1147e05`。来源与依赖摘要见 `source.json`。每次部署重新刷新并验证最新包，未固定版本或回退旧包。签名 Gateway 探测发现 158 项能力及语义项；错误签名、越权域均被拒绝（403）。

完整八案例候选：`0a36b38612a83ff9e01f`。全部任务均本轮新建，并先解析现场当前引用。详见 `acceptance.jsonl`。

| 案例 | 任务标识 | 结果 | 说明 |
|---|---|---|---|
| BASIC | `grounding-48fad5e3-41d9-4238-b19f-b648c16c95b3` | COMPLETED | 业务完成，回执与幂等字节重放通过 |
| TRACE | `grounding-f94dc570-0a5e-4a82-8886-b7ff2d19334a` | PARTIAL | 区间快照 MATCHED；轨迹 PROVIDER_NOT_READY |
| MAP | `grounding-7dd1ba11-adba-4d57-b6ad-de7659725c83` | PARTIAL | 区间快照 MATCHED；轨迹 PROVIDER_NOT_READY；未执行 T2 |
| STOP | `grounding-4993e0e1-3b04-47f8-b896-36d41606e9b7` | FAILED | 120 秒原截止时间超时；无查询执行证据 |
| CROSS | `grounding-6c852453-6325-4283-8c7c-9a757d28d8b0` | PARTIAL | 区间快照 MATCHED；轨迹 PROVIDER_NOT_READY；未执行 T3 |
| RANK | `grounding-e10d4f1c-bfeb-4827-8e22-4486f3f4abe7` | PARTIAL | HISTORICAL_QUERY_NOT_REGISTERED；未产生 World Query；未执行 T4 |
| GDPS | `grounding-823c899f-7077-4990-bb10-14ec61b1c3c3` | COMPLETED | NO_DATA 证据与公开语义一致；无业务数据，不能计作正向数据通过 |
| CANCEL | `grounding-8d1f1016-a274-44ee-b92d-64ce6fbab14e` | CANCELLED | 取消成功；API 错误签名 401、越权读取 404 |

### 快照证据及剩余阻塞

`world-queries.jsonl` 将 WSGS 任务关联到 Gateway 任务及保存的计划；`gateway-nodes.jsonl` 保存 requested/effective 快照哈希和节点状态，`worker-diagnostics.jsonl` 为服务器端筛选的稳定错误码。

TRACE、MAP、CROSS 的区间节点均返回 `PARTIAL / OPEN_EXECUTION`，`LATEST_AT_START`、禁止降级，快照一致性 `MATCHED`、检查资源数为 5。轨迹端口错误修复后，上游返回 `PROVIDER_NOT_READY`，错误详情阶段为 `PROVIDER_EXECUTION`，不再是原来的缺快照 422 或端口 `SCHEMA_MISMATCH`。

历史 Provider 容器显示 healthy，但业务执行失败；容器健康不能替代能力执行成功。现场没有轨迹成功回执及完整节点快照证据，因此不能宣布轨迹快照验收、T2/T3/T4 正向业务通过。受控真实运行时测试证明请求快照进入 Provider；这一证据与上述现场阻塞分别记录。未修改上游数据、Provider 或 GOWM 快照校验。

STOP 超时单独保留，未延长 120 秒截止时间；RANK 无 World Query，原因是基础计划编译报告 `HISTORICAL_QUERY_NOT_REGISTERED`，未将其臆断为数据为空。GDPS 的 NO_DATA 已按原语义保留。历史追问、有效期、取消与租约恢复由本次自动回归覆盖；没有可用新轨迹选择的现场正向追问未执行，未以 fixture 冒充现场通过。

### 最后的错误分类复测

完整八案例候选暴露 Provider 不可用被快照错误遮蔽的问题。最终代码将 `PROVIDER_NOT_READY` 等明确就绪/传输错误投影为 `UPSTREAM_FAILURE`，继续保持 `PARTIAL + BLOCKING gap`；缺失或篡改快照仍为契约错误。全套检查 1015 项通过。仅此分类变化以候选 `3b383bd92d792b38fb93` 和新 MAP 任务 `grounding-3686575b-fddc-4c10-9f4f-dd01c7dfa5b9` 复测：59.1 秒内返回 `PARTIAL + BLOCKING UPSTREAM_FAILURE`，Schema 和幂等字节重放通过。内部节点日志明确为 `history.get-trajectory / PROVIDER_NOT_READY`，汇总类别为 `HISTORICAL_UPSTREAM_UNAVAILABLE`。见 `acceptance-classification.jsonl` 与 `worker-classification.jsonl`。完整八案例未为这一分类变化全部重跑。

### 复现及边界

```sh
WSGS_UPSTREAM_DEPLOYMENT_ROOT=/mnt/data/gowm-analysis-current npm run deploy:instance -- --diagnostic-case=ALL
```

脚本核对最新正式包、构建、迁移检查、排空、签名探测，再启动领任务；诊断候选不自动激活，退出时停止 API/Worker。此次总体业务验收为 FAILED，生产资格和延期清单不变。无新表、无迁移变更、无北向接口变更。原 actor 身份匹配与引用刷新修复保留。

## 最终实例状态

最终 API、Worker 均 `Exited (0)`，候选未激活，见 `instance-state.txt`、`activation.json`。独立 PostgreSQL 与 Gateway 数据库保持 healthy，签名 Gateway 保留运行。未变更静态入口和上游业务数据。总体结论：WSGS 侧适配和回归完成，现场业务验收仍失败，轨迹 Provider 就绪问题、STOP 超时及 RANK 能力计划可用性问题仍阻塞正向业务验收。
