# W01 Completion Report

## Scope completed

Vendored the exact GOWM 0.4.0 contract boundary at commit `db575f79c874a69f65a2043a7e463338524b713d`, preserved upstream bytes, and generated a resolved required-operation lock.

## Source state

The GOWM worktree contains unrelated user changes on another branch. Intake used only Git objects addressed by the exact commit and did not checkout, stage, or modify that worktree.

## Upstream contract state

- Source package lock Git blob: `97b118737f82bfe49c7741b2787da9d72e2d7400` (PASS).
- Gateway OpenAPI Git blob: `120f1f3ca2d65f5d7a73422718b6aa152794abed` (PASS).
- Source package: 33/33 SHA-256 artifacts (PASS).
- Required providers: 4/4 with exact operation counts (PASS).
- Required operations: 28/28, version `1.0`, maturity PREVIEW/STABLE, typed schema hashes resolved (PASS).

## Code/contracts/migrations

- `contracts/upstream/gowm-v0.4`
- `contracts/upstream/gowm-platform`
- `contracts/upstream/provider-manifests`
- `contracts/upstream/required-operation-lock.json`
- `validation/scripts/verify-gowm-intake.mjs`

No GOWM business source or database code was vendored.

## Tests actually run

| command | result | evidence |
|---|---|---|
| task package intake script | FAIL | partial clone could not materialize promised blobs; retained as failed attempt |
| first local exact-commit archive | FAIL | CRLF conversion changed Git blob bytes |
| `node validation/scripts/verify-gowm-intake.mjs --write-lock` | PASS | exact commit, 33 artifacts, 4 providers, 28 operations |
| `node validation/scripts/verify-gowm-intake.mjs` | PASS | generated lock is current and all byte/schema checks pass |

## Acceptance cases

- PASS: AC-U001..AC-U009, AC-U011..AC-U013.
- NOT_RUN: AC-U010 requires a live Gateway catalog and remains deferred to W16.

## Authority and security review

Intake is explicit-commit only; the default branch is never resolved. Vendored content is contract-only. Runtime policy fails required schema/provider/maturity drift closed and treats optional absence as a non-readiness capability gap.

## Failed attempts

The remote partial clone and first CRLF-transformed archive are documented above. Neither was accepted as evidence; exact byte verification passed only after disabling checkout line-ending conversion for the archive.

## Commit/push/PR

Recorded in the W01 semantic commit and Draft PR #1 update.

## Blockers

Live catalog equality (AC-U010) cannot be claimed until real Gateway execution in W16.

## Next phase

W02 northbound JSON Schema/OpenAPI freeze and forbidden-decision-field validation.

