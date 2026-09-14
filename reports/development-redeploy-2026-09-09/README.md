# WSGS 开发环境清理重部署（2026-09-09）

已按用户授权在 `sz-gowm` 清理旧 WSGS 并部署新开发包，直接复用已部署的 GOWM 0.7.1。对外 API 为 `http://17.26.1.20:18082`，无需用户、注册或访问令牌。

- Compose 项目：`wsgs-dev`。
- 当前入口：`/mnt/data/wsgs-live/current`。
- 激活目录：`/mnt/data/wsgs-live/releases/abc04d9917d085e5/wsgs-development`。
- 部署包 SHA-256：`abc04d9917d085e5d4ccc7ce0cdf7f4084c375f5ae6641852e873b978cd79e53`。
- 当前包：`output/deployment/wsgs-development.tar.gz` 及 `.sha256`。
- 模型沿用原实例配置；凭据仅在服务器内读取、写入权限 0600 的新 `.env`，未纳入归档或报告。

## 清理与复用边界

删除 7 个旧 `wsgs-live` 容器、`wsgs-live-delegation`、`wsgs-live_gateway-data`、`wsgs-live_wsgs-postgres-data` 三个专用卷。旧 `wsgs:*` 与 `wsgs-gowm:*` 镜像标签已清空；本轮被替换的中间镜像也已删除。不执行全局 prune 或强制移除共享镜像。

现有 GOWM 网关容器 ID 保持 `15824f0df349c212f4936b783ece9d3739c181e17f730b8c67be331d3796c7d4`，持续 healthy；未重启或修改其配置、镜像和数据。WSGS API/Worker 加入其现有 Docker 网络。新 WSGS 仅运行自身 PostgreSQL、迁移、API、Worker，没有再建专用 GOWM 网关。

本次包刷新到了现场正式 GOWM `01b37aeb563179a7449844b93d28cccafdf507a9befffa241d7482460aab221a`，契约及 Provider 注册表匹配。

## 现场修正

- 修正 Compose 私钥 secret 的目标文件名，使其与运行时读取路径一致。
- 增加 `WSGS_DEV_UPSTREAM_NETWORK`，支持连接现有 GOWM 网络。
- 18080 被现有 CRS 服务占用，实际采用检查后空闲的 18082。
- 现有 GOWM 使用 `STATIC_SERVICE`，全量 158 操作可用性查询约 6.1 秒，返回时超过原始 5 秒有效期，导致 WSGS 报 `AVAILABILITY_EXPIRED`。单独检查 31 个必需操作约 1.5 秒，全部 AVAILABLE。
- 增加可选 `GOWM_AVAILABILITY_MODE=REQUIRED_OPERATIONS`，按当前契约锁逐项读取 WSGS 所需操作，保留原始有效期、鉴权、截止时间和失败传播。默认仍为 `ALL_OPERATIONS`。没有修改 GOWM 或放宽快照有效期校验。

## 验收

类型检查、配置覆盖检查通过，覆盖 127 个运行时/Compose 配置项。部署相关 35 项测试通过，查询适配、生产模块和可信快照相关 63 项测试通过。服务器镜像构建执行契约校验和编译成功。

PostgreSQL、API、Worker 均 healthy，迁移退出码 0。一键脚本最终退出码 0。外部 `/health/live` 返回 live，外部 `/health/ready` 返回 ready 且无原因项；匿名 1.2 能力请求 HTTP 200。

匿名异步冒烟请求 `grounding-f36dd677-90ec-4224-9b98-a69767750430`：HTTP 202，35.298 秒生成公开 Schema 合法的 `UNRESOLVED` 结果，resultHash 存在，幂等重放完全一致。该测试未提供已知引用上下文，结果中引用数为 0，因此仅证明处理链路、持久化及重放工作，不宣称目标地理引用解析成功或全面业务验收。第一次测试使用错误的 requestedProducts 枚举，被正常拒绝为 HTTP 400；修正后先经公开 Schema 校验再提交。

服务器日志与摘要在激活目录的父目录；本地脱敏摘要见 `deployment-summary.json`。清理清单及结果保留于服务器 `/mnt/data/wsgs-live/releases/5edfed27c72e5b1b/`。

## 运维

```bash
cd /mnt/data/wsgs-live/current
./deploy-dev.sh --check
# 使用当前镜像重新启动：
./deploy-dev.sh --no-build
```

`GOWM_GATEWAY_BASE_URL` 指向现有网关，数据范围沿用其固定服务身份；客户端免验证意味着共享此身份及其范围。
