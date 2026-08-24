# W13 Completion Report

## Scope completed

Implemented bounded context-capsule loading, same-scope retained-result lookup, exact byte-hash verification, selected product extraction, TTL revalidation flags, Map revision checks, unknown/full-history rejection, and a real-DB retention acceptance case.

## Context behavior

- The top-level capsule accepts only the five frozen context arrays.
- Prior pointers accept only grounding ID, SHA-256 result hash, and selected product IDs.
- Result content is loaded from the scoped WSGS store; caller-supplied content is forbidden.
- Stored bytes are decoded only after their computed SHA-256 matches the pointer.
- Selected IDs must exist in retained reference/evidence products.
- Expired KnownReference and prior products are marked for revalidation.
- Map selections receive CURRENT/STALE/NOT_FOUND revision status from a scoped revision reader.
- Unknown fields, full conversation history, excess counts, and excess serialized bytes are rejected with bounded HTTP-oriented codes.

## Tests actually run

| command | result | evidence |
|---|---|---|
| context-loader suite | PASS | 7/7 hash/scope, substitution, history/size, Map revision, KnownReference TTL, selected ID tests |
| `npm run check` | PASS | 90 passed; 9 real-DB tests skipped without `TEST_DATABASE_URL` |
| new result-retention PostgreSQL case | NOT_RUN | added to real DB suite for W16 |

## Acceptance cases

- PASS: AC-P001, AC-P002, AC-P005, AC-P006.
- NOT_RUN: AC-P003, AC-P004, AC-P007 require real alias/ReferenceKey/Map sources in W16.
- NOT_RUN: AC-P008 now has a real PostgreSQL acceptance case but was not executed in this environment during W13; it remains deferred rather than claimed.

## Authority and security review

Data scope is a trusted loader parameter, never a capsule field. Cross-scope results return not found. Raw prior result content, conversation history, fabricated selected products, and hash mismatches fail closed. External hints/predicates remain bounded opaque objects.

## Failed attempts

None. Strict build, focused context tests, and root gate passed on the first W13 run.

## Commit/push/PR

Recorded in the W13 semantic commit and Draft PR #1 update.

## Blockers

Real alias, Map revision, expired ReferenceKey, and PostgreSQL retained-audit evidence remain deferred to W16.

## Next phase

W14 implements the frozen authenticated sync/async northbound API, capabilities/readiness, polling, and cancellation.

