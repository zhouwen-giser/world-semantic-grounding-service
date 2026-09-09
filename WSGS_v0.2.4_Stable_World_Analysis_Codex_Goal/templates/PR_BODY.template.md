# WSGS v0.2.4 — Stable Generic World Analysis Service (Draft)

## Summary

填写真正完成的公开合同、五类 Finding、Choice/Gap、协商、结果复用和消费者交接。

## Contract-first evidence

填 freeze commit、manifest/hash；说明冻结在新运行时实现之前。说明 1.0/1.1 和旧 geospatial 工件不可变。明确 1.2 selection 回传方式。

## Scope

仅 WSGS。无 GOWM+/GDPS/GSAP/SACS/SDAR/SMPP 实现改动，无 Native Analysis Control，无设备控制。世界主体 opaque ID 不作为设备控制字段。

## Verification

逐命令填写实际 PASS/FAIL/NOT_RUN。L0、L1 controlled-dependency HTTP、真实 Gateway/PG/模型/消费者分别列出。Required 总数 72，不能把 optional NOT_RUN 当作 PASS。

## Limitations

无真实验证的部分保持 NOT_RUN。历史目标只是候选，executionAuthorized=false。v0.2.4 为工作项编号，不声称发布。

## Delivery status

保持 Draft。No automatic merge, tag, release or deployment. No production-readiness, strict-replay or full SACS/UGV acceptance claim.
