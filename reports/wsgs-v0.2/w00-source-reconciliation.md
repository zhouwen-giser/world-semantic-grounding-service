# W00 Source Reconciliation

## Decision

`PASS`

The fetched WSGS and GOWM+ refs exactly match the task-package baselines. No forward drift was present, no unrelated tracked state was changed, and the WSGS 0.1.0 baseline passes with a real PostgreSQL 17.10 instance.

## Exact source state

| source | local HEAD | fetched `origin/main` | version | result |
|---|---|---|---|---|
| WSGS | `2fdefe3769189fa8e8be4302a9e98ca55cf686d4` | `2fdefe3769189fa8e8be4302a9e98ca55cf686d4` | 0.1.0 | PASS |
| GOWM+ | `17dd221330d9af540ec815a39eca96550690299a` | `17dd221330d9af540ec815a39eca96550690299a` | 0.6.3 | PASS |

The target branch `codex/wsgs-v0.2-gowm-0.6.3-integration` was created from the exact fetched WSGS baseline in an independent worktree. The original `main` checkout was not switched, reset, or stashed.

## Package and preflight

- Package manifest and schema validation: `TASK_PACKAGE_VALID schemas=12 stableRecipes=9 previewRecipes=5 examples=13 acceptance=279`.
- Unmodified preflight logic: `PREFLIGHT_PASS` after a process-local `python3` mapping bypassed the non-executable Windows Store alias.
- The package contains 279 unique acceptance IDs, all marked Required.

## Baseline validation

| command/gate | result | evidence |
|---|---|---|
| `npm ci` | PASS | 143 packages installed from the locked dependency graph |
| `npm run check` without DB | PASS with expected integration skip | 15 files passed, 1 skipped; 107 passed, 9 skipped |
| `npm run check` with isolated PostgreSQL 17.10 | PASS | 16 files and all 116 tests passed |
| frozen northbound tree | PASS | Git tree `55169cf5157ecb3a9e440d109cebf4ccc82bacbf` |
| architecture boundary scan | PASS | no SDAR, A2A, SMPP, GOWM DB, provider route, or LangGraph dependency |

The old v0.1 acceptance generator still truthfully reports its own historical `145 PASS / 2 NOT_RUN / 59 BLOCKED` ledger. That ledger is not reused as WSGS v0.2 acceptance evidence.

## Intake discrepancies discovered during reconciliation

The supplied SHA-512 `sha512-Z2m...` is GOWM's logical package integrity over canonical pre-lock bundle file records. It is not the byte digest of an npm `.tgz`. The supplied materialization helper compares it to raw tarball bytes and therefore cannot pass for the exact source. W01 will:

1. materialize exact Git-blob bytes from the locked commit;
2. verify every bundle MANIFEST entry;
3. recompute GOWM's logical package integrity exactly as its build does;
4. retain independent tarball SHA-256/SHA-512 evidence; and
5. record the helper mismatch without weakening either check.

GOWM 0.6.3 also supports asynchronous World Queries but not asynchronous direct operations. No real direct-202 PASS will be claimed against this locked upstream.

## Protected actions

No merge, tag, release, package publication, production deployment, force-push, or GOWM modification was performed.

## Publication evidence

- Initial W00 commit: `d1da280`.
- Remote branch: `origin/codex/wsgs-v0.2-gowm-0.6.3-integration`.
- Draft PR: https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/2
- AC-B001 through AC-B010: PASS.
