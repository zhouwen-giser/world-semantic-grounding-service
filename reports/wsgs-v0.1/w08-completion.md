# W08 Completion Report

## Scope completed

Implemented semantic-frame invariant validation, deterministic/model mention merging, typed grounding-graph construction, explicit conflict preservation, graph validation/limits, canonical hashing, and the model-outage degraded product path.

## Semantic invariants

- Every mention must be an exact UTF-16 source slice.
- Mention, expression, and temporal IDs must be unique and referenced IDs must exist.
- Spatial distances must be finite; relation endpoints and aggregation targets must exist.
- Empty time constraints and reversed absolute time bounds are rejected.
- The frame has no intent, route, answer decision, provider, operation URL, ReferenceKey, fact, or evidence fields.

## Merge and graph behavior

- Priority remains Client Map / KnownReference, then deterministic, then model.
- A compatible exact model span may enrich expected kinds but cannot replace the deterministic ID.
- Map/text, incompatible context/type, and different namespace claims remain visible ambiguities.
- Supplied reference candidates become `KNOWN_REFERENCE`; all unvalidated deterministic candidates remain `UNKNOWN`.
- Model-only products become only `MENTION` or `SEMANTIC_OPERATION`, never `FINDING` or `RESOLVED_REFERENCE`.
- All endpoints and IDs are validated; 256-node/512-edge limits are enforced.
- Stable sorting and canonical serialization produce a deterministic SHA-256 graph hash.

## Tests actually run

| command | result | evidence |
|---|---|---|
| semantic-frame suite | PASS | 4/4 valid semantics, exact spans, unique/dangling IDs, time constraints |
| grounding-graph suite | PASS | 8/8 validity, conflicts, no hidden fact, priority merge, retry/hash stability, namespace ambiguity, degraded Partial, limits |
| first W08 typecheck | FAIL | one literal-union collection widened to `string[]` |
| `npm run check` after the narrow type fix | PASS | 48 passed; 8 real-DB tests skipped without `TEST_DATABASE_URL` |

## Acceptance cases

- PASS: AC-F005..AC-F010, AC-D011, AC-M014.
- NOT_RUN: AC-F001..AC-F004 are classified as model acceptance and require actual compatible-model outputs in W16; constructed unit frames are not counted as real-model proof.

## Authority and security review

Neither graph construction nor degraded operation reaches a provider, URL, database, or GOWM endpoint. Reference-shaped deterministic candidates remain marked for upstream validation. Ambiguities remain data rather than an automatic winner. A model outage cannot turn lexical or deterministic parsing into a fabricated natural-language result.

## Failed attempts

The first strict build identified one TypeScript inference widening for extraction-source literals. The source was narrowed without compiler suppression. No behavior or acceptance criterion was weakened.

## Commit/push/PR

Recorded in the W08 semantic commit and Draft PR #1 update.

## Blockers

Real model semantic examples remain deferred to W16 because the required `MODEL_*` environment is absent.

## Next phase

W09 resolves bounded mention candidates exclusively through locked GOWM Gateway reference operations.

