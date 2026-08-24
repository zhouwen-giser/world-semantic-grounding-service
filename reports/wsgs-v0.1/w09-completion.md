# W09 Completion Report

## Scope completed

Implemented bounded reference grounding through only the locked GOWM Gateway `reference.resolve` and `reference.validate` operations, including sync/async handling, authority/schema checks, normalization, ambiguity preservation, and revalidation state.

## Locked call behavior

- Injected locks must name exactly `reference.resolve` and `reference.validate`.
- Gateway wrappers carry the locked version/input/output hashes, deterministic phase idempotency keys, deadline, byte/candidate budgets, and no body authority.
- Successful envelopes must match provider protocol, operation/version, provider ID, output schema hash, and terminal status.
- Async acceptance must supply a bounded job ID and terminate `COMPLETED` or `PARTIAL` before output is read.

## Normalization behavior

- Upstream `RESOLVED_EXACT`, `SUGGESTED_UNIQUE`, `AMBIGUOUS`, `UNRESOLVED`, and `INVALID` are preserved.
- No candidate is selected for ambiguity and provider order is retained.
- `matchedBy`, `matchScore`, and `stateConfidence` remain separate.
- Candidate descriptor worldVersion takes precedence over the enclosing resolver version and remains `sourceWorldVersion`.
- NO_DATA, missing resolution rows, and zero candidates become explicit unresolved products.
- Validation status and warnings remain separate; stale/expired results mark revalidation rather than becoming current.

## Tests actually run

| command | result | evidence |
|---|---|---|
| reference-grounding suite | PASS | 8/8 suggestion, ambiguity, unresolved/NO_DATA, stale, limits, authority drift, async, deadline tests |
| `npm run check` | PASS | 56 passed; 8 real-DB tests skipped without `TEST_DATABASE_URL` |

## Acceptance cases

- PASS: AC-R004..AC-R008, AC-R012.
- NOT_RUN: AC-R001..AC-R003 and AC-R009..AC-R011 require the real locked GOWM deployment, catalog data, and scope context in W16. Fault fixtures are not counted as real E2E evidence.

## Authority and security review

Operation IDs are constructor-locked and cannot be supplied by user/model input. Identity and scope remain transport context. Provider identity and output schema drift fail closed. The model cannot reorder or synthesize candidates, ReferenceKeys, scores, versions, or validation state.

## Failed attempts

None. The first strict typecheck and the focused suite passed.

## Commit/push/PR

Recorded in the W09 semantic commit and Draft PR #1 update.

## Blockers

Real reference names, ambiguous road data, stale prior references, Map conflicts, and cross-scope isolation remain dependent on W16 infrastructure.

## Next phase

W10 compiles only approved typed templates into byte-locked GOWM World Query v2 plans.

