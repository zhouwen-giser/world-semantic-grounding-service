# W17 Completion Report

## Decision

**BLOCKED** — 0.1.0 version, documentation, root checks, frozen contracts, real PostgreSQL, and hardened container evidence are complete, but 59 required cases remain blocked and two are not applicable/not run. The Draft PR must remain Draft.

## Candidate deliverables

- Root/workspace versions and `VERSION` agree on 0.1.0; the changelog records the blocked-candidate qualification.
- Runbook and security/authority documentation describe configuration, recovery, resumption, and protected-action boundaries.
- The Node 22.14.0 Bookworm Slim base is pinned to `sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b`.
- The executable image runs UID/GID 10001, read-only, non-privileged, no-new-privileges, and bounded noexec tmpfs with graceful signal handling.
- Liveness returns 200; readiness deliberately returns 503 while the production grounding pipeline and required external capabilities are unavailable.
- The generated ledger covers all 206 required matrix entries: 145 PASS, 0 FAIL, 2 NOT_RUN, 59 BLOCKED.

## Actual validation

| gate | result |
|---|---|
| `npm run check` | PASS: contract locks, acceptance coverage, architecture, strict TypeScript, 107 unit/contract/security tests; 9 DB cases conditionally skipped in no-DB root invocation |
| real PostgreSQL 17.10 | PASS: 9/9 |
| `docker build --tag wsgs:0.1.0 .` | PASS: pinned base, clean npm install, build, zero audit findings reported |
| restricted container | PASS: healthy, UID/GID 10001, read-only, privileged false, no-new-privileges, bounded tmpfs |
| container HTTP | PASS: live 200; readiness 503 fail-closed |
| required ledger | PASS: exactly 206 classified, no duplicate/missing/deferred IDs |
| real model/GOWM/provider E2E | BLOCKED: required environment absent |

## PR and protected actions

Draft PR #1 remains Draft because AC-FN011 and the completion-marker gate are blocked. The W17 commit is pushed and exact local/remote SHA equality is checked after push. No merge, tag, release, production deployment, other-repository change, force-push, or secret commit was performed.

## Required next work

1. Compose the production deployment backend from the durable store and implemented parser/model/Gateway/grounding/compiler/normalizer components.
2. Provide the real model and locked GOWM Gateway/provider environment described in the runbook.
3. Rerun all 59 blocked cases and the two not-run applicability cases.
4. Only after a 206/206 PASS ledger, update the candidate report, emit both success markers, and mark the Draft PR Ready. Merge/tag/release/deploy still require separate authorization.

## Final marker

```text
WSGS_V0_1_GROUNDING_CORE_BLOCKED
```
