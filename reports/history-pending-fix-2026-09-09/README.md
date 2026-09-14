# WSGS 历史投影等待原因修复

2026-09-09，已完成源码修复、回归测试、开发包构建及 sz-gowm 定向上线。

## 修复行为

生产结果装配现在独立接收 HistoricalExecutionResult 的 status/reasonCode。PENDING 映射已有公开 HISTORICAL_PROJECTION_PENDING / BLOCKING gap，即使没有 trajectoryReferenceKey、没有可用 foundation，也保留等待原因。仍返回 PARTIAL，不创建轨迹 Finding 或可信轨迹引用。

复用原公开契约，无新接口、环境变量或迁移。CAPABILITY_GAP 及既有上层失败优先级保留；COMPLETED/普通 PARTIAL 不会凭空生成 pending gap。生产模块传入历史执行结果，装配边界负责映射，结果哈希和 findingSetHash 按已有逻辑重新计算。

## 验证

- 3个测试文件共105项通过：生产结果装配、公开分析投影、历史执行。新增5项回归覆盖两种 pending reasonCode、无轨迹基础时的等待原因、完成/部分结果不误报、能力缺口及失败优先级。
- 验证无新增引用、Finding 或 Choice；公开 schema、resultHash、findingSetHash 与确定性均通过。
- TypeScript检查、128项环境配置覆盖检查及修改文件diff空白检查通过。
- 部署镜像中离线运行契约夹具：PARTIAL，唯一gap=HISTORICAL_PROJECTION_PENDING，findingCount=0，引用产品不变，schema与resultHash有效。该探针不调用数据库、模型或Provider。
- 原请求 groundingId 摘要 db91c4f43f2fc06676bf03fc924c0e07355617674987bc3c79cc9edc37183c5f 的请求记录仍在，但检查点已不存在。因此原检查点重组尝试未完成，不能声称完整现场请求重放通过。未修改原结果。

## 部署

包SHA256：f19110a152f2fa1a25a968240aee7647d933c1f5b9dc74e95b19e0656345c2c8。
镜像：wsgs:dev-f19110a152f2fa1a。
镜像ID：sha256:3b28539659bff825ad5dfd17d25c8ee4e294955940422b0078a8ef5f7ed1c86f。
发布目录：/mnt/data/wsgs-live/releases/f19110a152f2fa1a/wsgs-development，current已切换。

仅更新grounding-api/grounding-worker，initialJobs=0，均healthy。新旧实际环境变量、挂载、网络与声明依赖一致，原WSGS数据库容器保留，kimi-k3、120秒预算、匿名访问及GOWM数据范围不变。没有操作GOWM容器或迁移，没有提交业务请求。

发布过程中先由配置差异校验阻止了相对挂载路径漂移。一次切换因Compose secrets相对路径缺失失败并自动回滚；补齐旧绝对secret来源后，另一次严格挂载列表比较受顺序影响触发回滚。最终按挂载目标排序后进行严格等值比较，所有检查通过。部署覆盖文件显式保留原绑定，旧发布目录和镜像保留用于回滚；没有复制或输出私钥内容。

远端rollout-evidence.json及rollout.log位于该发布目录的上一级。此次定向上线脚本与离线探针保存在本报告目录中供复核。

## 验收边界

WSGS漏报等待已修复上线，但这不代表GOWM物化或完整历史分析通过。继续等待GOWM的085/086修复、负载验证及上线完成，再协调一次正常SACS→WSGS请求，验收有效轨迹Finding并保留真实PROVISIONAL/缺口。此前约定的端到端暂停仍有效。
