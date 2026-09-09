# 工具说明

三个工具都只用 Node.js 内建模块，无需安装依赖，不访问网络，不修改 WSGS 源码。

- `verify-package.mjs [包路径]`：校验任务包所有文件字节 hash、目录完整性、8 阶段依赖、72 项矩阵 CSV/JSON 一致性、24 个用例及 NOT_RUN 模板。通过只表示任务规范完整。
- `validate-report.mjs 报告.json --repo-root 仓库目录 [--require-ready]`：校验最终报告格式和实际证据文件的 SHA-256；Required 的 PASS 不允许缺证据。不能验证日志所述测试是否真实、不能代替 review。
- `self-test.mjs`：在临时目录做 7 项自测：原包通过，篡改/缺文件/多文件失败，NOT_RUN 模板合法但无法宣称 ready，全 PASS 无证据失败。最后清理临时目录。

```bash
node WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/tools/verify-package.mjs
node WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/tools/self-test.mjs
```

执行进度、最终报告和 WSGS 生成的合同写入仓库既定 reports/contracts/execplans 目录，**不要原地修改本任务包的 NOT_RUN 模板或 checksums**。包完整性校验会拒绝额外文件/修改，避免混淆设计输入和执行结果。

验收 WA-072 的证据可引用独立的台账汇总/门检查输出；不要让 FINAL_REPORT.json 把自己的最终字节 hash 填回自身，造成自引用循环。合同 lock 同样遵守此原则。
