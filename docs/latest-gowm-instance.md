# 最新正式 GOWM 消费者与独立联调实例

此流程替代活动运行时的固定 GOWM 版本路径。0.7.1 是本次实际交付版本，不是版本上限。生产资格与生产延期清单保持原状；本次现场验收状态见 `reports/gowm-latest-instance-2026-09-07/README.md`。

## 刷新与构建

```sh
npm run gowm:refresh
npm run gowm:check
npm run build
npm run check
```

`npm run build` 的 prebuild 自动刷新。刷新器以正式交付目录中的包及 `.sha256` 发布记录为依据，按数值语义版本选择最新正式版本；拒绝缺失或损坏的最新包，不回退旧包。不使用源代码 HEAD、临时构建目录、备份或 sample handoff。

可配置的是发布入口，不是版本号：

- `WSGS_GOWM_RELEASE_DIR`：默认相邻 GOWM 仓库的 `output/deployment`。
- `WSGS_GDPS_GOWM_RELEASE_DIR`：默认相邻 GDPS 仓库的 `output/deployment`。
- `WSGS_ANALYSIS_RELEASE_DIR`：默认相邻分析 Provider 仓库的 `output/deployment/current`。

联合包内嵌 GOWM 必须与所选正式 GOWM 字节一致，分析联合包也必须引用同一 GDPS/GOWM 包。公开 manifest、exports、注册表、引用 Schema 和内容哈希共同生成消费者快照；缺失引用或校验失败会中止刷新。只存在于同一正式部署包内的公开 Schema 依赖也会记录来源和哈希。

`contracts/upstream/gowm-current` 原子指向不可变 `gowm-releases/<摘要>`。API、Worker 和构建验证共用它；进程启动后不联网更新，不重新解析软链接。`SNAPSHOT.json` 记录实际版本、来源及哈希。历史夹具和报告不作为活动授权依据。

Dockerfile 只验证已经由此入口选定的构建上下文；发布必须使用下面的部署入口，不能把直接构建旧目录视为一次“最新正式交付”部署。

## 独立实例部署

```sh
# 生成候选配置与上传代码；不启动业务服务
npm run deploy:instance -- --prepare-only
# 刷新、回归、构建、排空、探测、真实验收；失败不激活
npm run deploy:instance
```

默认主机为 SSH 别名 `sz-gowm`，可用 `WSGS_DEPLOY_HOST` 覆盖。`WSGS_UPSTREAM_DEPLOYMENT_ROOT` 可显式指定服务器已激活上游目录（默认为 `/mnt/data/gowm-gdps-analysis-live`）；使用绝对存在路径，注册表仍从实际运行 Gateway 挂载读取并核对。现场基础部署布局由 `deployment/prepare-instance.py` 明确约束；发现不一致时失败，不能猜测另一个实例。

项目 `wsgs-live` 使用 `/mnt/data/wsgs-live/releases/`、独立 WSGS PostgreSQL、独立 Gateway 数据库和查询持久化、独立签名 Gateway。现有静态 Gateway、业务数据库和 GPUStack 不重建。新 Gateway 从所选正式归档重新提取构建源，并通过现有内部网络连接 Provider。使用正式迁移和初始化；不拷贝业务数据到新数据库。

独立 Gateway 构建调用正式包的 `scripts/build-verified-image.sh`：先验证 `SHA256SUMS`，仅将清单文件以 tar 字节流送入 Docker，再验证镜像实际文件和运行契约摘要。缺少脚本或任一校验失败均阻断部署，不回退目录构建。服务器优先使用 PATH 中的 Node；非交互 SSH 未配置 PATH 时，选择当前用户 NVM 中最新正式数字版本的 Node。配置文件保存在包源码目录之外。

应用升级先验证并复用现有健康数据库，不对数据库调用 Compose 重建。数据库不存在时，先验证配置镜像在本地存在，再以 `--pull never` 创建并记录镜像身份；异常数据库会阻断流程。迁移单次执行并检查退出码，Gateway、API 和 Worker 使用 `--no-deps` 启动，避免隐式重建数据库。

现场验收前将本次部署的真实车辆和任务引用写入 `validation/live-site-references.json`（已忽略 Git），结构为 `{ "subject": { "namespace": "gowm", "kind": "WORLD_OBJECT", "id": "…", "version": "…" }, "task": { "namespace": "gowm", "kind": "OPERATIONAL_TASK", "id": "…", "version": "…" } }`。每例执行前均通过授权的 `reference.get` 读取两者当前版本；缺少文件或引用不可用即拒绝，不回退旧数据库引用。重建上游数据库后必须重新取得种子引用。

使用 `--diagnostic-case=ALL` 可运行全部现有用例，结束后仍停止 API/Worker、不激活实例。

定位单个用例时可向部署脚本传入 `--diagnostic-case=BASIC`（或 TRACE、MAP、STOP、CROSS、RANK、GDPS、CANCEL）。该模式仍执行正式构建与签名检查，单例结束后停止 API/Worker，不更新活动发布指针；`DIAGNOSTIC_PASSED` 仅表示该例通过，不能代替默认全量验收。

模型配置从本机 `.env` 中显式允许的 MODEL 变量读取，经 SSH 标准输入传输；不会进入构建归档、镜像或报告。数据库、北向 JWT、加密及 Gateway 传输凭证独立生成。RS256 私钥只存在于受限秘密文件及专用卷中，仅挂载至 API/Worker；容器保持 UID 10001 和只读根文件系统。Gateway 只配置公钥。

联调身份使用现场的 default data/dataset scope、独立服务主体及显式新协议白名单。主域留空；多域调用仍按现有规则选择。启用历史、分析及所需 Preview；GDPS 描述符和 recipe 绑定由当前正式快照生成。原文保留 3600 秒、清理周期 60 秒、批量 100。

API 绑定服务器回环地址；首次选择空闲的 18080–18099 端口并保存在实例状态，重部署不随机换端口。本次为 18082。验收通过并启动后可使用：

```sh
ssh -N -L 18082:127.0.0.1:18082 sz-gowm
```

部署先停止 API 受理，等待已受理任务按原截止时间进入终态，再停止 Worker、切换快照。构建后与验收后重新刷新并比较选择结果；发布期间出现新版则失败。配置、迁移、签名目录与权限探测通过后才启动候选 API/Worker。真实验收失败会停止这两个服务，保留数据库和诊断资料；仅成功时更新 `current`。

历史公开结果和幂等重放不重新解释。分析追问先检查原有有效期，再检查检查点中的消费者快照摘要；缺失或不同摘要返回既有 `SELECTION_INVALID`。不会重写检查点或延长原文/选择有效期。

## 验收口径

`real-wsgs-instance-gate.mjs` 通过真实 HTTP、Worker、模型和 Provider 执行现场用例。合法的 PARTIAL/PROVISIONAL 会如实记录；缺少业务证据或包含 BLOCKING gap 不算通过。现场参考对象需要真实存在且可被现有 Provider 读取。该脚本不建立测试业务数据，不修改上游授权。

`npm run check` 中受环境保护的数据库用例须另外配置 `TEST_DATABASE_URL` 和 `TEST_UPGRADE_DATABASE_URL` 在一次性 PostgreSQL 中执行。不能用跳过状态或历史通过记录代替本次数据库验证。
