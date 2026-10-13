# WSGS 本机 Docker 部署（2026-10-13）

状态：部署及在线验证 PASS。代码提交 `bad1382` 完成五项功能修复与统一打包工具，`0615c07` 将部署自检等待时间与模型总预算对齐。实际运行镜像、部署源码包及完整 SHA-256 均绑定到 `0615c07b38f61038453b6ee4e1166418516f4e4a`；后续报告提交不改变已部署代码。

基于已读取的 `GSAP-session`（`01a12515-2515-7390-b756-62cbe5bfb735`）及其 [本机部署报告](/home/sz/code/gowm-spatiotemporal-analysis-providers/output/local-deployment-2026-10-13.json)，复用现有 GOWM 0.7.1 / GDPS 0.2.3 / GSAP 0.1.0。GSAP 包为 `c963ab2230a6c2e5d3948470dfa8c0765df4cd21f6a73f630e021121de8aec9f`，当前目录有 20 个 Provider、160 项操作。

## 运行结果

| 项目 | 结果 |
| --- | --- |
| WSGS 地址 | `http://127.0.0.1:28080`；`/health/ready` HTTP 200，`ready`，无失败原因 |
| Compose 项目 | `gowm-analysis-dev-f3dc6f4b8e-wsgs` |
| API / Worker 镜像 | `wsgs-unified:33941ed9e76dbe79`；两个容器均 running / healthy，实际镜像 ID 与构建记录一致 |
| 模型 | 原项目 `.env` 的 `qwen3.7-flash-2026-07-15`，DashScope compatible-mode，`CHAT_COMPLETIONS_STRICT`，`MODEL_REQUIRED`，总模型超时 120000ms、最多一次重试 |
| 模型配置生效 | API / Worker 中七项模型配置逐项与 `.env` 一致，凭据只比较一致性，不写入报告或镜像 |
| 真实模型 | 新镜像预检成功，输出通过 Schema / 精确源文本提及校验；在线请求的模型阶段也成功，一次尝试、28026ms |
| 签名 Gateway | 160 项操作来源匹配；正确委托可用，错误签名和越权 Scope 均拒绝 |
| 高级分析能力 | 1.2 Schema / 有效期 / 六种能力全部通过包内完整验证器 |
| 北向拒绝检查 | 无效 1.2 请求 HTTP 400 |
| 源码来源 | 运行容器中七个关键源码、消费者快照与操作锁文件逐个匹配部署包 |
| 旧任务 / 数据库 | 旧任务 0，排空完成；新镜像执行迁移和断言成功；WSGS 与 GOWM 数据库身份 / OID 一致 |
| 保留范围 | GOWM / GDPS / GSAP / WSGS 两个 Compose 项目中 36 个未升级运行容器 ID 不变；数据库凭据、加密密钥、委托身份和持久卷不变 |

部署中先完成新镜像、签名及模型预检，然后停止 API 入队、排空 Worker、执行迁移断言，最后仅以 `--no-deps` 更新 API / Worker。GOWM / GDPS / GSAP / Gateway / 数据库继续使用既有运行容器；提供冻结旧配置用于回退。

真实模型首次预检耗时约 35 秒，暴露了旧验证器 15 秒等待时间不足的问题。本轮增补八项回归：自检在 `MODEL_REQUIRED` 下等待 `MODEL_TIMEOUT_MS + 15000` 毫秒，包含重试的模型总预算保持不变。最终冷启动在线自检通过。

## 公开请求验证与边界

发出一条匿名、只读的 `EXECUTE_WORLD_QUERY`：“2号车在哪里？”。返回 202，Worker 完成模型解析、语义帧验证、引用解析、结果组装及持久化；最终结果通过公开 1.2 Schema，幂等重放字节一致。

当前数据未能解析“2号车”引用，结果为 `UNRESOLVED`，有 `REFERENCE_UNRESOLVED` 缺口且无世界事实证据。这项验证确认实际模型与异步服务链路可用，不代表实体位置正向验收。完整历史分析、现场非空 CROSS / RANK、GDPS 正向产品、外部 MQTT 与生产资格仍未完成。

另有独立 `smpp-telemetry` Compose 项目的 telemetry-processor、query-api、grafana 在本轮同一时段由其他部署更新；其新容器创建于 WSGS 切换之前，位于 `/mnt/data/smpp-telemetry-local-state`，不是本轮升级目标。报告保留这三项并行变化，保留断言限定为本轮关联的 GOWM / GDPS / GSAP / WSGS 项目。

## 交付与证据

- [在线部署报告](deployment-summary.json)、[公开请求验证](http-smoke.json)、[持久化流水线证据](http-smoke-evidence.json)。
- [全量检查](check-output.txt)：1222 项通过，49 项 PostgreSQL 集成用例跳过；SQL 未改变，修复阶段独立 PostgreSQL 49/49 证据仍保留。新增就绪预算回归文件 23/23 通过。
- [最终统一部署包](../../output/deployment/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz)，SHA-256 `b2b10f06896b33ce69ce4c6675fdebc70ca5b2b4608d4aa0e60f659d4a2cff5e`。
- [最终 WSGS 包](../../output/deployment/wsgs-development.tar.gz)，SHA-256 `33941ed9e76dbe7951a8d94aeb9a0e29d05cbdec44a95f6cfb16f61ba98a45ed`。
- [两次独立生成](reproducibility.json) 摘要一致；[实际解包与初始化校验](package-verification.json) 通过；实际部署镜像执行锁定依赖安装、消费者校验和 TypeScript 编译，构建及运行来源另见部署报告。
- 私有部署与回退配置位于 `/home/sz/.wsgs-deployments/local-20261013-0615c07/`，目录 0700，配置 0600；实际 `.env`、配置凭据及完整私有响应没有提交到 Git。

本轮数据和 API 模型配置没有写入通用部署包；通用包保留环境模板及现场业务验收 `NOT_RUN`，本机验证证据由本报告单独绑定。
