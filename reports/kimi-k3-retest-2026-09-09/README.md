# kimi-k3 模型切换与基础业务复测

按用户指定将 sz-gowm 当前 WSGS API/Worker 的 MODEL_NAME 改为 kimi-k3。停止API接入、排空队列（initialJobs=0）后，仅重建两个服务，均 healthy，实际容器环境确认模型已更新。复用现有模型地址和凭据、GOWM、数据库；保留120000ms请求/适配器预算和60000ms模型就绪缓存。

使用现有授权上下文，仅运行一次 SACS BASIC 真实复测。模型就绪探测首次HTTP200，headers=7873ms、parse=7881ms、attempts=1，未重试。完整脱敏联调证据为同目录 INTEGRATION_EVIDENCE.json。

## 复测结果

业务请求摘要：869fbc744d82d873e5f9f3ec0c72f3c30a5796e5a17ea98dbb334818b4c16630。POST HTTP202/ACCEPTED、1618ms，实际deadlineMs=120000。模型有效预算88146ms；一次尝试、HTTP200响应头32962ms，解析总32970ms、SUCCEEDED，无重试、无MODEL_BUDGET_EXCEEDED。

终态PARTIAL，gapKinds=[REFERENCE_AMBIGUOUS]，findingCount=0、choiceCount=0；结果摘要sha256:158a1376a82b38e2bb61ed8d727fa431dc952d6fe2d1b9f367c4a11d06ca56e0。AG-UI正常RUN_FINISHED，无RUN_ERROR，临时数据库cleanup=PASS。本次解决了测试请求中的模型超时阻塞，但尚未取得完整业务分析结果；剩余对象引用歧义需另行分析，不能把模型成功当作业务PASS。
