# 历史轨迹主体引用产品修复与验收

已修复并上线。正常SACS→WSGS单次请求现在生成1个有效HISTORICAL_TRACE，关联此次验证有效的WORLD_OBJECT主体产品；REFERENCE_MISSING消失。保留真实PROVISIONAL和1处轨迹缺口，结果正确保持PARTIAL。

## 实施

仅WSGS新鲜1.2历史执行路径增加主体接纳：确认轨迹主体、执行上下文、任务快照及actor归属一致；已有完整引用相同、验证有效且租期未过期的产品直接复用。否则通过原授权Gateway执行reference.get/reference.validate，严格检查返回身份和版本，STALE最多刷新一次；SCOPE_DENIED等拒绝状态不能通过刷新绕过。

新增主体产品为DERIVED_REFERENCE，通过现有publicReferenceProducts合入。明确使用已接纳的主体作为Finding规范主体；历史轨迹内的原始主体版本保持不变。相同完整引用去重，续验同版本时保留原productId，并以新验证产品覆盖过期副本。接纳和验证记录保存在加密检查点；公开层继续使用字段白名单。

复用统一验证租期计算；验证失败不生成可信主体或Finding，保留gap。保留PENDING原因修复、公开引用检查和旧结果复用行为。不新增公开接口、环境变量、迁移，不修改GOWM、轨迹事实或设备状态。

## 验证与部署

- 5个相关测试文件169项通过，新增13项主体接纳与组合装配回归；覆盖过期、STALE上限、返回版本不匹配、跨范围/错误类型/错误任务归属、身份替换、历史版本不变及真实完整性语义。
- 最终补充保存验证记录后，受影响的主体与生产模块64项测试重跑通过；TypeScript、128项环境配置覆盖、diff空白检查通过。
- 组合测试初次因夹具未提供契约要求的证据关联被拒绝，补齐夹具已有证据ID后通过，未放宽生产schema。
- 部署包SHA256：5a14773927a4c6ea077e686bb52f622430eb1944336f1804d3ccbedb563ee5e8。
- 镜像：wsgs:dev-5a14773927a4c6ea；镜像ID：sha256:6985f5806445d1f83adfce65a57258b6a2a2634770bbc5627e702d9ed373636c。
- 发布目录：/mnt/data/wsgs-live/releases/5a14773927a4c6ea/wsgs-development，current已切换。
- initialJobs=0；仅API/Worker定向更新，均healthy。实际环境变量、挂载、网络/声明依赖及原数据库保留，kimi-k3、120秒预算、匿名访问不变。旧版本及镜像保留，部署脚本rollout.py附后。

## 单次正常业务验收通过

时间：2026-09-09T12:42:18.506Z–12:43:30.350Z。使用原私有输入、正常SACS AG-UI路径，契约1.2，唯一一次POST，deadline120000ms。未自动补发或扩大高级测试。

SACS HTTP200/RUN_FINISHED，无RUN_ERROR，持久化状态快照通过其契约验证，临时数据库cleanup PASS。原harness为传输观察程序，始终保留INCOMPLETE/OBSERVED与退出码2；没有改写原证据。另行完成语义断言，semantic-acceptance.json中16项检查均PASS。

只读解密检查点完整性通过，最终schema无错误、resultHash正确。结果包含任务、轨迹、主体、执行区间4个引用产品；1个HISTORICAL_TRACE，0个Choice，0个未解析提及，公开阻塞gaps为空。

任务引用与新增主体均VALID、revalidationRequired=false。主体验证租期截至12:44:28.493Z，Finding租期截至12:43:40.462Z，均晚于响应完成时间。Finding唯一主体指向本次接纳产品，证据关联有效。历史主体与当前主体版本不同但逻辑身份一致，原历史版本没有被覆盖；租期为响应时有效，不应在后续请求中复用过期验证。

真实轨迹保留9806个样本、1处缺口、PROVISIONAL，覆盖率约0.9999991429；公开Finding和整体结果均PARTIAL。这是有效轨迹Finding验收通过，不是无缺口/已封存轨迹声明。

groundingIdHash：sha256:49870c823bb25fbab500cbb5871f862ee760dd569bfe2d662618da62a0f7807c。
resultHash：sha256:e4c127fbba3ed52da40d953a806a6ab4210530ea1c61a8fbf1295c8c75d20fea。

证据位于acceptance/：INTEGRATION_EVIDENCE.json、checkpoint-summary.json、semantic-acceptance.json、checkpoint-inspect.mjs。未输出原文、业务标识、轨迹坐标或密钥。

本轮未验收排名、道路或其他高级分析；现有历史输入仍为LATEST + EXECUTION_ENVELOPE，不宣称自由时间窗功能已经实现。
