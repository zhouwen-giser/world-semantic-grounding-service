# GOWM + GDPS + GSAP + WSGS 统一开发部署包

统一包以已经生成的 GSAP 联合部署包为基础，原样保留 GSAP、GDPS 和 GOWM 归档；WSGS 的消费者快照必须与三层归档逐字节匹配。`deployment/MANIFEST.json` 记录各组件版本、提交、原包摘要和 WSGS 契约快照。分支工作项为 v0.2.4，WSGS 当前软件版本仍为 0.2.1；打包不修改组件版本。

这是需要联网构建镜像的 Linux x86-64 开发部署包。服务器需要 Docker Engine、支持 `env_file.required`、`up --wait` 和 `!reset` 的 Compose，Node.js 22+、Python 3.10+、openssl、curl、tar、sha256sum，以及镜像、npm、Python 和系统软件源访问。建议至少 20 GiB 可用磁盘。包中没有本机配置、实际凭据、私钥或镜像。

## 首次部署

```bash
sha256sum -c gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz.sha256
umask 077
tar -xzf gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz
cd gowm-gdps-gsap-wsgs-dev-server-0.2.1
./deploy init
# 编辑 upstream.env：填写真实 UGV_MQTT_URL 及所需认证/TLS 配置。
# 编辑 wsgs.env：填写 MODEL_BASE_URL、MODEL_API_KEY、MODEL_NAME。
./deploy config-check
./deploy doctor
./deploy up
```

`init` 不启动容器；初始化环境文件、持久化随机凭据、委托密钥以及独立 Compose 项目。重复初始化保留密码、密钥及模型配置。所有命令使用统一包根目录的 `upstream.env` 和 `wsgs.env`（0600）。上游路径、Scope、WSGS 操作锁与摘要、Provider 注册、GDPS 消费者文件、委托配置由初始化过程从本包派生，勿手工改动这些管理项。迁移同一归档的目录时保留两个环境文件和整个 `.runtime/`，不能把身份文件复制到另一部署。

初始化会核对缓存源码与本次归档，旧版本缓存或被修改的源码不能作为新包构建输入。源码升级请解压到新的目录，并按上游的数据保留/升级流程迁移现有部署；不要把新归档直接覆盖旧目录后继续使用旧源码缓存。

部署目录须由当前用户拥有；目录及非 sticky 的父目录不能允许组用户或其他用户写入。上游入口会检查这一条件并拒绝不安全的路径。

`upstream.env` 默认启用 UGV；必须提供真实 MQTT 地址和对应秘密文件。明确不使用 UGV 时设置 `UGV_MQTT_INGEST_ENABLED=false`。不会生成测试轨迹或指标。WSGS 默认要求模型；模型运行在服务器本机时可使用 `host.docker.internal`，其服务必须监听容器可达地址。暂不配置模型时，显式设置 `WSGS_MODEL_POLICY=MODEL_OPTIONAL`，并清空 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`；这不证明模型功能可用。

## 统一启动的组件

启动顺序为 GOWM/GDPS 基础服务和真实数据库、三个 GSAP 分析 Provider、WSGS 专用 Gateway 数据库与注册初始化、签名 Gateway、WSGS 数据库迁移、API 和 Worker。WSGS 使用本包当前操作锁，启用历史和分析能力，并注册固定 WSGS 服务主体的两个公开契约。服务可用仍取决于真实模型、授权数据及上游证据。

GSAP 继续使用原有部署入口及正式 GOWM 镜像校验脚本。WSGS 的独立 `SIGNED_DELEGATION_V1` Gateway 使用同一已验证 GOWM 镜像和完整的 20 Provider 注册表，通过上游 Docker 网络访问业务 Provider；使用独立数据库、传输凭据和委托身份。WSGS API/Worker 的委托私钥通过专用卷交给 UID 10001；不要求修改主机文件所有权。

默认开发 API 为免用户、免令牌的 `STATIC_TRUSTED` 模式，对外端口 `8080`，所有请求共享服务器授权身份。访问 `http://服务器IP:8080/health/ready` 和 `http://服务器IP:8080/v1/capabilities`。可在 `wsgs.env` 调整 `WSGS_API_PORT`、`WSGS_API_BIND_ADDRESS`、模型配置及流水线预算。原上游网关端口、UGV 配置及分析算法参数保留在 `upstream.env`。

## 验证与维护

```bash
./deploy build-images       # 构建与校验镜像，不启动服务
./deploy status
./deploy logs               # WSGS 项目最近 200 行
./deploy logs grounding-worker
./deploy smoke              # GSAP smoke + WSGS readiness/匿名能力发现
./deploy down               # 先停止 WSGS，再停止上游；保留所有数据卷
```

WSGS 自检复用 `validation/scripts/verify-development-runtime.mjs`：检查普通依赖就绪，并在高级分析启用时协商 1.2，验证 Schema、能力快照有效期及六项分析能力。仅 HTTP 200、CROSS 不可用或过期能力快照不能通过。自检输出仍区分 `serviceReady`、`advancedCapabilities` 和 `businessAcceptance=NOT_RUN`。

在 `MODEL_REQUIRED` 下，就绪请求等待 `MODEL_TIMEOUT_MS + 15000` 毫秒，为真实模型及数据库/Gateway 检查保留时间；模型总预算已经包含重试。`MODEL_OPTIONAL` 使用 15 秒就绪请求预算。

上游单独排障可执行 `ANALYSIS_DEV_ENV_FILE="$PWD/upstream.env" ./.runtime/upstream/gowm-gdps-analysis-dev-server-0.1.0/deploy logs 服务名`。统一入口无清库命令。失败后保留配置和诊断容器，修复后重新执行 `./deploy up`。中断留下 `.runtime/unified-up.lock` 时，先确认没有部署进程运行，再删除该锁。

归档校验、配置校验和离线回归不等于整栈现场验收。发布清单中 `siteAcceptance=NOT_RUN`；`smoke` 的 readiness/能力清单通过也不证明真实业务分析、模型准确率或 SACS 联调通过。使用真实数据执行业务验收后再判断现场是否可用。

## 在 WSGS 源码中重新打包

```bash
npm ci --ignore-scripts
npm run gowm:refresh
npm run deploy:dev:package
npm run deploy:unified:package
# 实际解包、重复初始化、Compose 配置和源码构建验证（不启动容器）：
python3 deployment/verify-unified-package.py output/deployment/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz --build-source
# 指定另一个已经发布的 GSAP 包：
# npm run deploy:unified:package -- --gsap-package /absolute/path/gowm-gdps-analysis-dev-server-0.1.0.tar.gz
```

默认读取相邻 GSAP 仓库 `output/deployment/current/`。自定义消费者来源时，同时设置 `WSGS_GOWM_RELEASE_DIR`、`WSGS_GDPS_GOWM_RELEASE_DIR` 和 `WSGS_ANALYSIS_RELEASE_DIR`，保证刷新时使用联合包包含的同一套正式归档。来源不一致或任一校验失败时打包终止。

验证结果写入归档旁的 `.verification.json`，并绑定该归档的 SHA-256。配置验证使用关闭 UGV、显式 MODEL_OPTIONAL 的临时配置，只验证配置及编译，不代表真实 MQTT 或模型验收。
