# 模型观测与就绪缓存最小修复

已部署至 sz-gowm，API 地址 http://17.26.1.20:18082，继续使用 qwen3.8-flash。

- 模型就绪成功缓存独立为 WSGS_MODEL_READINESS_CACHE_MS=60000（0–300000ms，已在 .env.example 说明并正确加载）。按成功完成时间计时，过期等待刷新，失败不使用旧成功；并发未命中合并为一次探测。
- GOWM authority 缓存保持5000ms，并合并并发获取。模型探测先完成，再获取最新 GOWM authority；高级能力响应仍独立捕获调用者范围内新鲜快照。
- 模型诊断记录尝试开始、HTTP状态与响应头耗时、响应体完成耗时、受控失败码、最终回执及请求ID摘要。业务关联仅使用 grounding ID SHA-256，不记录原文、响应内容、凭据或隐含推理。
- 外层模型预算取消时同步生成失败观测；即使适配器 transport 尚未返回，MODEL_REQUIRED 抛错也保留失败回执，并在有效 Worker fence 下持久化。任务预算和后续30秒预留保持有效。

验证：类型检查、环境变量覆盖128项通过；相关单元/配置测试48项、HTTP契约测试15项通过。新增测试覆盖并发冷探测、慢探测完成后TTL、失败刷新、模型/GOWM缓存独立、429内部重试元数据、隐私字段排除、transport未结束时取消回执、REQUIRED/OPTIONAL预算错误回执。

部署包 SHA-256：3fda537a74396769261f4d799a37a248a456ee6731d978c63dabed1ba90d919c。
发布目录：/mnt/data/wsgs-live/releases/3fda537a74396769/wsgs-development。
镜像：wsgs:dev-3fda537a74396769；config SHA-256 c07c1e75fd84dd4dae84c86f1179d77f867efbeecc004c9a9f0f6b9dd582687a。
停止API接入后排空，initialJobs=0；仅重建API/Worker，均healthy，未修改GOWM、数据库和数据卷。

## 真实验证结果

两条并发冷能力请求均 HTTP200、ready=true、六项available=true，总耗时122999/123193ms。API日志只出现一次模型尝试：响应头等待116226ms、HTTP200，响应体116231ms完成，解析总116239ms、attempts=1。冷探测依旧很慢，此修复没有声称改善供应商响应时间。

等待6秒使GOWM authority缓存过期，第三次能力请求耗时4918ms，ready=true、六项available=true，生成新的有效快照，未再次调用模型。见 capabilities.json。现场两个容器均加载 MODEL_NAME=qwen3.8-flash、MODEL_TIMEOUT_MS=120000、WSGS_MODEL_READINESS_CACHE_MS=60000、WSGS_READINESS_CACHE_MS=5000。GOWM容器ID仍为15824f0df349c212f4936b783ece9d3739c181e17f730b8c67be331d3796c7d4。

基础业务仅重测一次，证据在 business-retest/INTEGRATION_EVIDENCE.json。请求摘要0f9dc8290c7973bf736f53468ff6fdd8fb2fa889563bb8b86455b509a891f52e；POST deadlineMs=120000、202/ACCEPTED、1781ms；终态FAILED/MODEL_BUDGET_EXCEEDED。模型开始remainingMs=117956、reserveMs=30000、budgetMs=87956。只有一次MODEL_ATTEMPT_STARTED，预算到期前没有MODEL_HEADERS、没有HTTP失败或内部重试事件；87956ms同步生成FAILED回执。数据库核验1行FAILED model_receipt、elapsed_ms=87956，模型阶段记录elapsed_ms=87970（含失败落库开销）。这验证了真实预算超时下的诊断和失败落库，但不代表业务成功。SACS临时数据库cleanup=PASS。

目前可以将本次失败缩小到单次HTTP请求等待响应头超出有效预算，排除内部重试累计；尚不能区分供应商排队/生成与网络路径延迟，也不能证明供应商启用了推理模式。没有贸然添加未经确认支持的模型参数、更换用户指定模型或取消预算保护。后续需要供应商请求级证据或受控的模型参数对照，才能有依据地解决模型响应延迟。
