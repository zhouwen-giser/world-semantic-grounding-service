# 开发服务器一键部署

此部署提供无用户、无注册、无令牌的 WSGS API。所有请求使用服务器配置的 `STATIC_TRUSTED` 身份，能访问该身份授权的数据，共享任务可见性与限流预算。`compose.yaml` 默认仍使用 JWT 和本机绑定；仅开发配置显式打开匿名网络访问。

## 生成与使用部署包

在源码目录执行 `npm run deploy:dev:package`，得到 `output/deployment/wsgs-development.tar.gz` 及 `.sha256` 校验文件。包包含源码、当前锁定的上游契约、Dockerfile、数据库迁移、配置模板与脚本；不包含本机环境变量文件、私钥、node_modules 或镜像。服务器需要 Docker Engine、支持 `env_file.required` 和 `up --wait` 的 Docker Compose、Python 3.9+，以及拉取基础镜像和 npm 依赖的网络连接。这是联网构建包，不是离线镜像包。

```bash
sha256sum -c wsgs-development.tar.gz.sha256
tar -xzf wsgs-development.tar.gz
cd wsgs-development
./deploy-dev.sh --init
```

初始化只创建不存在的 `.env`，权限为 0600，自动生成 PostgreSQL 密码、载荷加密密钥和 JWT 密钥。已有配置不会被覆盖。

编辑 `.env`，填写 GOWM 地址、传输凭据、已注册的委托身份、对应的 PKCS8 私钥主机路径、已授权的 readiness 数据范围及模型配置。私钥必须能被容器 UID 10001 读取。这里的上游委托身份配置与客户端免验证访问是两个不同层次；脚本不会替你创建 GOWM 授权或虚构可用模型。无模型时可设置 `WSGS_MODEL_POLICY=MODEL_OPTIONAL` 并清空三个模型配置项，但依赖模型的功能将不可用。

```bash
./deploy-dev.sh --check
./deploy-dev.sh
# 已有构建/导入的镜像时：./deploy-dev.sh --no-build
# 自定义配置文件：./deploy-dev.sh --env-file /absolute/path/dev.env
```

脚本验证配置，生成 `compose.dev.generated.json`，构建镜像，启动 PostgreSQL、迁移、API 和 Worker，等待容器健康，最后检查真实 `/health/ready` 和匿名 `/v1/capabilities`。任一步失败返回非零状态，不会声称部署成功；失败后的容器保留供诊断，数据库卷不删除。

开发配置必须包含 `WSGS_AUTH_MODE=STATIC_TRUSTED` 和 `WSGS_API_BIND_ADDRESS=0.0.0.0`。未配置 `WSGS_STATIC_*` 时，部署脚本使用委托服务主体、readiness actor、数据范围与权限生成固定身份，并增加 `grounding.read`。可在 `.env` 中使用新的复数范围字段覆盖；不要同时设置旧单数别名。这不会绕过 GOWM 的上游数据授权。

访问地址为 `http://服务器IP:8080`（可通过 `WSGS_API_PORT` 修改）；服务器网络需允许该端口。API 没有网页账户界面：

```bash
curl --fail http://服务器IP:8080/health/ready
curl --fail http://服务器IP:8080/v1/capabilities
```

模型或 GOWM 运行在服务器本机时，开发覆盖文件提供 `host.docker.internal` 到宿主机的映射。上游需监听容器可达地址。文件类参数应填写**容器内路径**；包内文件使用 `/app/contracts/...` 或 `/app/config/...`。外部交付文件需要额外只读挂载，主机私钥和 operation lock 则已有专用 `*_HOST_FILE` 配置。

## 配置加载与校验

`.env.example` 列出运行时和 Compose 参数（含数据库池、迁移超时、Gateway 重试、readiness 缓存和各流水线阶段预算），并说明可选字段与旧名称。取消注释可选字段后需填写有效值，不应随意设置为空。`npm run config:check` 扫描运行时代码、动态阶段名称和 Compose 引用，检查模板覆盖率。

Compose CLI 的 `--env-file` 负责 YAML 替换，容器的 `env_file` 负责传入其余可选项；脚本自动将 `WSGS_ENV_FILE` 指向同一绝对路径。直接运行 Compose 时也要保持两者一致。显式 `environment` 值优先于 `env_file`；Shell 环境可覆盖 Compose 替换值。部署时应清理无关的 Shell 覆盖变量。

原生 Node 入口 `npm run start:api`、`npm run start:worker`、`npm run db:migrate`、`npm run db:migrate:verify` 使用 Node 22 的环境文件加载能力，系统环境优先。先运行 `npm run typecheck` 编译。原生运行时将数据库地址、委托私钥路径等改为主机可达路径；Node 的环境文件不会展开 `${VAR}`，模板采用独立配置值。

运维时使用相同项目名、环境文件和覆盖文件，例如默认部署：

```bash
export WSGS_ENV_FILE="$PWD/.env"
docker compose -p wsgs-dev --env-file "$WSGS_ENV_FILE" -f compose.yaml -f compose.dev.generated.json logs --tail 100
docker compose -p wsgs-dev --env-file "$WSGS_ENV_FILE" -f compose.yaml -f compose.dev.generated.json down
```

`down` 保留数据库卷；重复部署保留已有密钥和数据。修改 PostgreSQL 密码不会自动修改已有数据库用户密码，需要先完成数据库侧的密码轮换。生产部署应恢复 JWT、关闭匿名网络暴露，并使用独立的配置与项目名。

复用已有 GOWM 时，可设置 `WSGS_DEV_UPSTREAM_NETWORK` 为现有 Docker 网络名，网关地址使用该网络中的容器名。共享 `STATIC_SERVICE` 网关若因全量 Provider 健康检查使可用性响应过期，可设置 `GOWM_AVAILABILITY_MODE=REQUIRED_OPERATIONS`，只读取 WSGS 当前锁定操作的单项状态；原始有效期、鉴权及失败处理保持生效。
