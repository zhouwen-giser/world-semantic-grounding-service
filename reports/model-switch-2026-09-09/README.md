# 开发环境模型切换（2026-09-09）

- 目标：sz-gowm / WSGS 开发环境，http://17.26.1.20:18082。
- 将当前发布目录的 `.env` 中 `MODEL_NAME` 从 `qwen3.8-27b` 改为 `qwen3.8-flash`。
- 停止 API 接收请求并排空 Worker，排空时无在途任务；使用现有 Compose 配置重建 API 和 Worker。
- 两个运行容器的 `MODEL_NAME` 均确认是 `qwen3.8-flash`，健康状态均为 healthy。
- `/health/ready` 实际模型就绪探测返回 HTTP 200、`status=ready`、空 reasons；耗时 47.424 秒。
- 模型地址、凭据、请求预算、现有 GOWM 和数据未修改。本地开发 `.env` 未修改。

本次验证说明新模型可调用，不代表此前 SACS 30 秒请求预算下的业务请求均能完成。

外部匿名 `/v1/capabilities` 使用 1.2 契约和 world-analysis 结果配置复核通过：HTTP 200，`requiredCapabilitiesReady=true`，六项高级分析全部 `available=true / AVAILABLE`。此次响应耗时 117.284 秒，模型就绪链路延迟仍明显波动。
