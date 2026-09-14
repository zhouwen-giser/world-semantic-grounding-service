# 1.2 能力快照时序修复（2026-09-09）

根因：生产 API 先采集有效期约 5 秒的高级能力快照，再等待模型/数据库 readiness，最后投影响应。现场复现 discovery 后剩余 4.372 秒，就绪检查耗时 15.413 秒；6 项原本 AVAILABLE 的能力因过期统一降级为 SNAPSHOT_UNAVAILABLE。

修复：先完成 readiness，再采集调用者范围内最新能力并立即投影；真实过期但结构合法的快照返回 SNAPSHOT_EXPIRED，缺失或非法快照仍返回 SNAPSHOT_UNAVAILABLE。保持原始有效期校验，能力可用性与整体模型 readiness 独立。

新增回归通过生产 backend 入口模拟 15 秒 readiness 和 5 秒快照，覆盖 readiness 成功/失败，并验证真实过期状态和公开 Schema。3 项测试在修复前全部失败，修复后通过。类型检查、相关单元和 Compose 测试 29 项通过；HTTP 能力发现测试 6 项通过（首次沙箱不允许本机监听，获准重跑后通过）。

修复包 SHA-256：409cbc061e7dd7b0dc7c8650ed5bc3041247c0066aae0e79576ea61c8c8632c2。

## 现场验收：已完成

新发布目录 `/mnt/data/wsgs-live/releases/409cbc061e7dd7b0/wsgs-development`，当前入口 `/mnt/data/wsgs-live/current`，API 继续使用 `http://17.26.1.20:18082`，免用户、免注册、免令牌。

切换前停止 API 接入并排空队列，待处理任务数为 0。复用当前数据库、配置及现有 GOWM；仅重建并切换 WSGS 镜像。迁移退出码 0，API、Worker、PostgreSQL healthy，一键部署脚本成功。

从开发机直接请求 1.2 能力接口，使用真实模型和已有 GOWM，未携带 Authorization。三份完整响应均通过公开 Schema 验证，6 项能力均为 available=true、reasonCodes=[AVAILABLE]，requiredCapabilitiesReady=true。

| 场景 | HTTP | 耗时 | 收到响应时的剩余有效期 |
| --- | --- | --- | --- |
| API 重启后首次请求 | 200 | 21.513 秒 | 4309 毫秒 |
| 就绪缓存命中 | 200 | 1.580 秒 | 4350 毫秒 |
| 等待 6 秒使就绪缓存过期后请求 | 200 | 20.951 秒 | 4288 毫秒 |

逐项结果包括 HISTORICAL_TRACE、ROAD_ASSOCIATION、TEMPORAL_EVENT、CROSS、METRIC_RANKING、ACTION_TARGET_CANDIDATE。证据见 `live-validation.json` 及对应三份响应 JSON。

这验证了能力发现与快照时序修复，不替代各分析业务结果的完整验收。现有 GOWM 网关 ID 仍为 `15824f0df349c212f4936b783ece9d3739c181e17f730b8c67be331d3796c7d4`，healthy，未修改其镜像、配置或数据。
