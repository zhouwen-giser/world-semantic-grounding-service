# W06 — Required 回归与本地 HTTP 开发链路

前置阶段：W05。验收范围：WA-055–WA-063。

## 实施要求

运行并记录 npm run check、npm test、npm run build，以及本任务新增合同、fixture smoke、HTTP 开发链路命令。遵循现有 test runner 和仓库规定；不能删断言、降低预期、排除新缺陷测试来凑 PASS。保留已有可选集成测试的显式 skip 条件，并记录实际 skip 数。

HTTP 测试用本地真实 listener 和临时端口，穿过请求校验、协商、backend、worker/pipeline、公共 normalizer、保存和 GET。可用明确测试专用的 Store/模型/Gateway 受控依赖，但高层结果不是直接预制。受控 Gateway payload 必须符合锁定上游合同；使用实际 compiled recipe/operation 请求断言。

至少跑历史轨迹、道路关联、最后 CROSS 完整/不完整、指标 Top-K、series 选择后再查询、rank→action candidate、Provider 缺失、1.0/1.1 回归，以及取消/deadline/idempotency 冲突。覆盖一个同步 200 与一个异步 202→worker→GET terminal。测试结束释放 listener/worker/temp 数据；不启动真实设备、不占用默认生产端口。

受控模型意味着不证明真实自然语言模型准确率；内存 Store 意味着不证明 PG crash durability；模拟 Gateway 意味着不证明真实 Provider 部署。report 的 verificationLevels 分别说明边界。

可选真实验证只在已配置且确认隔离、只读、安全的环境中执行；不为了它安装 Docker 或启动其他仓库。没有条件则 NOT_RUN，完成全部能运行的 Required，再输出明确本地结果。

## 优先修改/核对入口

- `tests/`
- `services/grounding-api/src/`
- `services/grounding-worker/src/`
- `validation/scripts/`
- `package.json`

路径是源码入口，不是必须逐个修改的清单；W00 对账后只改必要位置。不要创建重复模块解决名称差异。

## 阶段产物

写入 `reports/wsgs-v0.2.4-stable-world-analysis-service/W06/`，至少包括：`verification-summary.json`, `http-development-e2e.json`, `logs/`, `acceptance-ledger.json`。若复用一个报告文件，可提供精确条目定位而非复制多个空报告。记录命令、exit code、真实输出/证据和未执行范围。

## 验收

| ID | 要求 | 验证方式 |
|---|---|---|
| WA-055 | npm run check 完整运行并记录 | 原始日志/exit code |
| WA-056 | npm test 与 npm run build 独立运行 | 两个命令的独立日志 |
| WA-057 | 合同与 fixture smoke 默认不依赖 Docker | 两个新命令运行 |
| WA-058 | 本地真实 HTTP listener 走实际 WSGS 链路 | test:world-analysis:http 和模块追踪 |
| WA-059 | HTTP 同步和异步 worker/GET 路径闭合 | 200/202→worker→GET 测试 |
| WA-060 | HTTP 多轮 series/rank/action 路径闭合 | 两轮/三轮用例 |
| WA-061 | 关键失败/不完整/旧版本 HTTP 回归通过 | gap/ambiguity/profile/deadline/cancel 用例 |
| WA-062 | 受控依赖和真实验证边界如实分层 | verificationLevels 与 optional checks |
| WA-063 | 测试隔离清理且报告可追溯 | 端口/临时文件/日志/source 记录 |

## 完成门

本阶段所有对应 Required 均 PASS、有可核对证据且无阻断缺陷，才标记阶段完成。NOT_RUN/SKIPPED/BLOCKED 不属于 PASS。后续阶段可以帮助补充联合证据，但不能省略 W01 的合同先行门。
