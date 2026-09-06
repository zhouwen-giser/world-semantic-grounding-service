# 验收记账

72 项 Required 按 W00–W07 分组；CSV 与 required-requirements.json 同源，禁止为凑通过删项。development-cases.json 有 24 个用例设计，不是已经构造好的 HTTP payload，也不是执行报告。W01/W06 将其映射为实际合同 fixture 与测试。

每项记录 PASS / FAIL / BLOCKED / NOT_RUN，PASS 必须有本次相关证据；多个要求可共享同一实际测试日志/报告，但必须有精确 case/assertion 定位。源码静态检查和合同冻结要求可以使用实际 diff/hash/validator 输出，不必为了每一行创建一份重复报告。

开发 E2E 使用受控依赖并明确列出替换边界。optional-checks.json 不参与 72 项总分，真实 Gateway、数据库、模型、SACS、设备各自单列。旧集成测试因环境跳过要保留并记录，不得在 Required 中用 SKIP 当 PASS。

用 tools/validate-report.mjs 做最终报告格式和本地证据文件完整性检查；它不能证明日志陈述真实，也不能替代代码 review/实际测试。必须先完成测试再填报告。
