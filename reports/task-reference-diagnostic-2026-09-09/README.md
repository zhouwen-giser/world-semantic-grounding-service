# 任务引用 UNRESOLVED 只读诊断

本轮仅只读分析既有请求、检查点、回执、配置与代码。没有修改/重启共享服务，没有重发模型、业务或Provider调用，没有回填索引/数据。数据库使用 BEGIN READ ONLY、statement_timeout=5s；GOWM查询明确设置 SET LOCAL gowm.data_scope_key='default'。私有QUERY只提取必要哈希/跨度进行比对，不输出实际任务ID、wrf或原文。

## 结论

当前失败有两项独立障碍：WSGS模型把任务ID与任务wrf分别解析为WORLD_OBJECT提及；实际目标是OPERATIONAL_TASK，而GOWM resolver会按expectedKinds先过滤。与此同时，目标OPERATIONAL_TASK虽有scope可见的描述符，却没有任何reference_search_projection行；整个default范围内OPERATIONAL_TASK搜索行数也是0。仅修正模型类型提示不足以解决索引缺失；仅补索引也无法绕过错误的WORLD_OBJECT类型过滤。

没有证据表明SACS改写或截断原文、发生模型超时、鉴权拒绝或数据scope错配。不能沿用未设置scope时零行所导出的“无历史数据”结论。数据库候选存在也不能替代公开解析成功。

## 请求与阶段证据

- 请求摘要：f1d5893347c206f2f0c94f0247a3cbca5781fda80765ed96acca7d911139ff6d。
- SACS证据时间窗：2026-09-09T07:31:45.152Z–07:32:30.173Z。
- POST实际deadlineMs=120000，202/ACCEPTED，1677ms。
- 私有QUERY长度134，SHA-256=1db9618bc8dbe5db801a5ffea3d1ee0601fd0bac0df860909f2408111b617b75，等于WSGS保存的source_text_sha256，故未见文本提取差异。
- 私有文本本身含两个不同字符串：任务ID跨度[5,32)，wrf跨度[47,83)。它们没有被SACS转成可信结构化引用。
- DETERMINISTIC_PARSE mentions=[]；SEMANTIC_MODEL_PARSE产生两个提及，跨度及surface哈希与以上两串逐一一致，expectedKinds均为[WORLD_OBJECT]。
- SEMANTIC_FRAME_VALIDATE及GROUNDING_GRAPH_BUILD保留相同两个提及，没有合并或修正类型。
- REFERENCE_RESOLVE：两项均UNRESOLVED、candidateCount=0，resolverVersion=gowm-reference-v1/1.0、worldVersion=83228；不是NO_DATA fallback，也不是UPSTREAM_RESULT_MISSING。
- REFERENCE_VALIDATE未获得可验证候选，结果仍零产品、两项未解析。
- 同时间窗GOWM既有reference.resolve执行回执SUCCEEDED，duration=12ms，generated_at=07:32:27.147Z；DIRECT_EXECUTION审计SUCCEEDED、无reason_code。此条按时间窗/操作关联，未取得其与任务的独立输入哈希绑定；准确任务归属证据来自哈希匹配且完整性校验通过的WSGS检查点。
- 终态UNRESOLVED，2 unresolvedMentions、0 referenceProducts/findings/choices，gapKinds=[]；结果hash=sha256:63c65a86d4a9f239e5cd252c6a18ee86fdf235fcfdcdfc3bc31d4df148683d0a。SACS正常RUN_FINISHED、无RUN_ERROR，临时DB cleanup=PASS。高级场景未运行。

“拆成两个提及”是WSGS模型阶段发生的，但输入本就同时包含任务ID及wrf。拆分本身不必然错误：正确解析后两个别名可以指向同一实体。当前零候选直接与类型过滤及索引缺失相关，不能只用合并提及解决。

## 类型、归属、版本和公开路径

已授权default范围内，所选任务ID恰有两种不同身份：WORLD_OBJECT（reference_type=Mission）和OPERATIONAL_TASK，分别具有不同wrf；私有输入给出的wrf确切属于OPERATIONAL_TASK。operational_task中所选ID与所选wrf联合匹配1行。两个描述符在gowm_reference_v1.current_descriptor均可见。

本次只读快照中，OPERATIONAL_TASK descriptor_version/effective_reference_version=297/297，WORLD_OBJECT为296/23242；描述符会继续更新，这不是请求发生时的版本快照。文本没有传递namespace/kind/version组成的结构化ReferenceKey，因此本轮尚未发生目标版本校验失败，不能把当前版本差异当作此次UNRESOLVED原因。

搜索投影：目标OPERATIONAL_TASK为0行；同ID的WORLD_OBJECT有2行（DISPLAY_LABEL、REFERENCE_KEY），均不等于任务ID，任务ID相似度分别约0.012048、0，低于resolver的0.3阈值。数据库内部ID并非默认公开可搜索别名。修复后需要明确将任务ID作为受管公开别名/外部标识，或使用已支持的完整引用验证入口，不应隐式信任数据库内部ID。

WSGS实际匿名身份为principal=actor=compose-runtime、dataScope=default，API为STATIC_TRUSTED。GOWM实际为STATIC_SERVICE、GATEWAY_DATA_SCOPE_CLAIM=default、datasetScope=airport2-task-network。代码在此模式使用静态transport主体和配置scope，而不是直接信任任意调用者声明。Reference provider设置gowm_reference_v1数据scope后读描述符/索引。本次没有发现scope错配，也没有扩大授权；带scope可见描述符仅证明读契约可见性，不声称新的HTTP解析已验证。

## 代码/现场函数依据

- WSGS services/grounding-worker/src/production-module.ts 的 REFERENCE_RESOLVE（约3418行）将surfaceText和expectedKinds原样传到reference.resolve，不把裸wrf自动提升为ReferenceKey；anchorReferenceKeys=[]。
- packages/semantic-model/src/adapter.ts 的系统提示示例明确车辆/设备用WORLD_OBJECT、道路/区域用LAYER_FEATURE，未给出任务OPERATIONAL_TASK规则。语义schema的expectedKinds允许字符串，没有阻止OPERATIONAL_TASK；本次错误提示来自实际模型输出，不能仅归因于schema不支持。
- packages/deterministic-parser/src/parser.ts:292 对knownWorldReferences做确定性别名提取并要求上游验证；此次没有走该路径。候选数据库引用不能直接塞入该字段并宣称可信。
- GOWM services/providers/grounding-catalog-provider/src/repository.ts:178 将surfaceText、expectedKinds送入gowm_reference_v1.resolve；之后只从scope可见current_descriptor构造候选。
- 现场pg_get_functiondef确认resolve使用reference_search_projection且有entity_kind=ANY(p_expected_kinds)过滤。对应database/migrations/021_reference_resolution_exact_match_precedence.sql:24–35。它没有在索引未命中时直接按identity表查裸wrf的兜底。
- 现场project_operational_task函数既不更新reference_search_projection，也不调用其重建。对应027_operational_task_projection.sql:313起创建OPERATIONAL_TASK identity/descriptor/name并更新任务快照，缺少索引维护。
- 077_world_object_catalog_projection.sql:64维护WORLD_OBJECT索引；其重建函数:116起会纳入各类identity的REFERENCE_KEY及名称，但本次未执行重建。搜索记录缺失何时形成、是否历史上曾删除，需要额外审计才能确定；现存任务投影维护缺口和当前0行事实已确认。

## 最小修复建议（本轮未执行）

1. GOWM修复OPERATIONAL_TASK投影的索引维护：与任务identity/descriptor/name同事务维护受管REFERENCE_KEY和合法名称/外部ID搜索项；确保范围、类型及版本语义一致。对既有任务制定可审计、幂等、限定scope的补建计划，先展示影响范围，不能用全局随意回填掩盖长期同步缺口。
2. WSGS补任务类型提示与回归，避免明确任务对象被固定引导为WORLD_OBJECT；显式裸引用候选可通过既有受支持公开查验入口确认kind、归属、当前版本后再解析/归并。不得让模型凭字符串编造可信ReferenceKey，不得取消expectedKinds过滤或直接从数据库注入可信候选。
3. SACS保留用户原文，并区分同一ID的WORLD_OBJECT/Mission与OPERATIONAL_TASK；在未获得唯一公开可验证引用前继续保持高级场景门禁。仅省略其中一个字符串可能减少提及数，不能保证解决类型/索引问题。
4. 测试同时覆盖：任务新建及更新立即可搜索、scope隔离、裸wrf候选、任务ID受管别名、同内部ID的两种类型、两个别名归并、过期版本校验，以及索引空/类型不匹配的明确结果。修复后单独授权最小公开解析验证，获得唯一OPERATIONAL_TASK引用再进入历史分析。

上游报告：/home/zhouwen/web-download/single-agent-chat-server/reports/v0.6/history-fixed-retest-20260909/README.md 与 reference-probe/INTEGRATION_EVIDENCE.json。SACS关于scope修正及模拟器来源的说明已纳入解释：现有历史来自真实开发业务库记录，不能声称物理设备采集。本轮没有重新统计全部历史或读取轨迹。
