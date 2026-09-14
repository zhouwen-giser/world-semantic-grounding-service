# 重新打包与远程更新

已按服务器重部署后的实际现场重新核对、生成部署包并更新 sz-gowm 的 WSGS API/Worker。包含此前的任务引用类型/解析修复、投影等待原因输出和可信主体引用产品修复。

包：output/deployment/wsgs-development.tar.gz，3,635,017字节。
SHA256：058af22632a850d0432fca71b59a5192d0f41615cc9d96389ac2656dadc45b17。
旧包已按原摘要保留。

发布目录：/mnt/data/wsgs-live/releases/058af22632a850d0/wsgs-development，current已切换。远程原包及.sha256保存在其上一级目录。
镜像：wsgs:dev-058af22632a850d0。
镜像ID：sha256:9ff3943cd6e5132a9be343981807cc15d6ef8f17143cceefdc0887fc99f94f61。

验证：TypeScript通过，128项运行时/Compose环境配置模板覆盖通过，上游契约检查PASS（packageVersion=0.7.1，85个schema）。包内关键修复文件与源码一致，包含.env.example，不含实际.env、私钥或密钥文件。远程包摘要匹配，镜像构建成功。

定向上线initialJobs=0，仅替换API/Worker，均healthy；实际环境变量、挂载、网络和声明依赖保持一致，原WSGS数据库容器未替换。保留kimi-k3、匿名STATIC_TRUSTED访问及历史开关。没有执行迁移、重置数据或修改GOWM服务。

上线检查：/health/ready HTTP200；匿名/v1/capabilities按1.2协商HTTP200，requiredCapabilitiesReady=true，HISTORICAL_TRACE、ROAD_ASSOCIATION、TEMPORAL_EVENT、CROSS、METRIC_RANKING、ACTION_TARGET_CANDIDATE均available=true。首次核验脚本误从worldAnalysis内部读取requiredCapabilitiesReady，修正为契约顶层字段后通过；原始字段路径检查记录保留在远端。

本轮仅验证部署就绪和能力发现，没有提交新的业务分析请求，不能将能力可用状态等同于所有高级分析业务验收。

证据：rollout-evidence.json、readiness-evidence.json；定向更新及回滚流程见rollout.py。旧发布目录和镜像保留。
