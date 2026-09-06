# 证据格式和工具边界

FINAL_REPORT.json 的 acceptance 每项 evidence 示例：

```json
{
  "path": "reports/wsgs-v0.2.4-stable-world-analysis-service/W06/logs/http-e2e.log",
  "sha256": "sha256:<实际文件的64位小写十六进制SHA256>",
  "locator": "CASE-17 / async create-worker-get"
}
```

path 相对 WSGS 仓库根目录；sha256 必须通过真实文件计算，不可保留占位符。locator 指向日志中命令/用例或 JSON 中 assertion。只需为实际证据记录 hash，不构造每一行一个报告的文档工程。

commands 每项至少填 command、status（PASS/FAIL/NOT_RUN/BLOCKED）、exitCode（已运行时的数字）、evidence（上述数组）。若多个阶段复用一个日志，要有 locator。工具不会运行命令或验证日志语义。

contract.freezeManifestPath 与 handoff.manifestPath 也相对 WSGS 根目录，其 hash 使用相同 sha256: 前缀。源码提交记录用于定位测试版本；有未提交被测代码必须记录 diff hash。最终补报告本身不要求重新 build 镜像。

结构检查：

```bash
node WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/tools/validate-report.mjs \
  reports/wsgs-v0.2.4-stable-world-analysis-service/FINAL_REPORT.json \
  --repo-root .
```

最终开发完成资格格式检查追加 `--require-ready`。该模式检查所有 Required PASS、L0/L1 PASS、实际日志文件/hash、合同冻结/交接记录、被测提交与禁止声明，不能替代真正的代码评审和运行验证。模板必须被判定为 NOT_READY。
