# W06 Completion Report

## Scope completed

Implemented a conservative, deterministic reference parser for caller-supplied KnownReference, MapSelection, focused GeoJSON/WKT, explicit GOWM ReferenceKey objects, valid H3 candidates, explicit lon/lat, device/object codes, and prior-grounding pointers.

## Source state

The parser consumes only the bounded source text and context capsule. It does not access a model, provider, URL, database, or full conversation.

## Upstream contract state

H3, coordinate, geometry, code, KnownReference, and map candidates are explicitly marked for upstream validation as appropriate. H3 remains approximate and no deterministic candidate becomes a world fact.

## Code/contracts/migrations

- Native JavaScript string indices are used as UTF-16 code-unit positions.
- Every emitted mention revalidates the exact source slice.
- Map and KnownReference priorities outrank deterministic text candidates.
- Equal-priority overlaps produce ambiguity; lower-priority overlaps are not allowed to overwrite.
- Prior grounding includes only the frozen pointer/hash/product IDs.
- ReferenceKey exists only when supplied by an accepted context/focus object.

## Tests actually run

| command | result | evidence |
|---|---|---|
| parser suite before final no-fabrication case | PASS | 8/8 |
| parser suite after final case | PASS | included in root W06 check |
| first `npm install --package-lock-only` | FAIL | sandbox registry connect EACCES |
| approved package-lock retry | PASS | audited lock, zero vulnerabilities reported |

## Acceptance cases

- PASS: AC-D001, AC-D002, AC-D004..AC-D010, AC-D012; AC-C009 is now closed by exact runtime slice validation.
- NOT_RUN: AC-D003 requires real upstream H3 validation in W16; AC-D011 namespace/incompatible-type graph merge belongs to W08.

## Authority and security review

Dates and version strings are not parsed as coordinates because coordinates require an explicit marker. Focus geometry is parsed only inside a caller-declared bounded span. Invalid H3-like hex strings are ignored. No arbitrary plan, URL, SQL, tool, provider, or ReferenceKey generation exists.

## Failed attempts

The package-lock network denial is retained above and was not counted as successful until the approved retry completed.

## Commit/push/PR

Recorded in the W06 semantic commit and Draft PR #1 update.

## Blockers

Real H3 validation and cross-namespace semantic merge remain deferred to their mandated phases.

## Next phase

W07 real OpenAI-compatible domain semantic model adapter.

