# W10 Completion Report

## Scope completed

Implemented the versioned WSGS v0.1 typed-template compiler for current state, geometry, provenance, event timeline, nearby, in-area, containing-area, H3 neighborhood, H3 exact verification, operational correlation timeline, and external predicate evaluation.

## Compiler boundaries

- Only fixed semantic-pattern rules can name operations.
- Every rule requires an exact trusted lock and live descriptor match for operation version, provider, maturity, input/output hashes, and ports.
- Plans contain only World Query v2 operation refs and typed request/node-output bindings.
- Unsupported terrain/visibility and any missing/drifted requirement return a blocking CapabilityGap with `substituted=false`.
- H3 candidate use stays approximate; boundary-sensitive use adds an exact Spatial node.
- Public operation input has no plan or operation-ID surface.

## Budget and determinism

Every node receives an integer share of aggregate row/candidate/output-byte/execution-time limits. Validation rejects aggregate overflow, missing endpoints, duplicate IDs, node/depth overflow, and invalid H3 unit semantics. The same bounded input produces the same query ID, plan bytes, and SHA-256 plan hash.

## Tests actually run

| command | result | evidence |
|---|---|---|
| first focused compiler suite | FAIL | 12/13; one test inspected internal catalog/locks instead of only the public operation input |
| focused compiler suite after assertion correction | PASS | included in final root check; 13/13 |
| `npm run check` | PASS | 69 passed; 8 real-DB tests skipped without `TEST_DATABASE_URL` |

## Acceptance cases

- PASS: AC-Q006, AC-Q007, AC-Q011..AC-Q016.
- NOT_RUN: AC-Q001..AC-Q005 and AC-Q008..AC-Q010 require a live catalog plus actual Gateway World Query execution in W16. Synthetic typed descriptors prove compiler policy, not real deployment availability.

## Authority and security review

The model and public request cannot provide a DAG, operation, provider, URL, SQL, schema hash, or port binding. The compiler does not widen data scope and places no authority claims in parameters. Exact missing capabilities remain gaps rather than best-effort substitutions.

## Failed attempts

The first suite's public-boundary assertion serialized the whole internal CompileInput, which necessarily contains trusted live capability and lock operation IDs. The assertion was corrected to inspect only `operationInput`; compiler behavior was unchanged.

## Commit/push/PR

Recorded in the W10 semantic commit and Draft PR #1 update.

## Blockers

Live World Query compilation/execution and unsupported-capability evidence remain dependent on W16 Gateway readiness.

## Next phase

W11 normalizes actual Gateway envelopes into bounded evidence products without turning model output into evidence.

