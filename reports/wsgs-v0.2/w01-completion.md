# W01 Completion Report

## Phase

W01 — GOWM 0.6.3 Consumer Contract Intake

## Outcome

The exact `@gowm/world-gateway-contracts@0.6.3` artifact was built from GOWM commit
`17dd221330d9af540ec815a39eca96550690299a`, retained as a tarball, extracted into the
repository, and verified fail-closed by the WSGS intake package. AC-C001–AC-C020 pass.

## Supply-chain evidence

- Locked upstream logical package integrity: `sha512-Z2mLu+us4NM8hqthMSo48H33cFpzxK9zxyx8UeB04F7LdWN0e6Vz5q++fB7ohyRikbXdgYCrT8+SMqwcuWEBLA==`.
- Independent tarball byte evidence: 52,931 bytes; SHA-256 `da86ab50c2cf4a925f958003a132902770bb2e6d2082cd0aaffb44d70e226501`; SHA-512 `sha512-UP91UrKaxuwDwN31zzh452f4iQYfiuXEukfcJ/Ken0+JSKyVnCTWemWs+6ELErb+xR3oInEly1oigzFRxbwLpg==`.
- Bundle MANIFEST: 62 canonical LF records verified by byte count and SHA-256.
- Tar archive and extracted package: 64/64 regular files byte-identical.
- Three independent `npm pack` runs from the exact-commit materialization produced the same tarball SHA-256.

The task helper treats the locked `Z2m...` value as the raw tarball SHA-512. GOWM's own
0.6.3 build defines that value as SHA-512 over canonical pre-lock file records. Those values
are intentionally different, so the committed evidence records both without weakening either
check or claiming that the unmodified helper can pass.

## Contract checks

- Contract catalog, binding, semantic catalog, availability, snapshot, delegation, and southbound-lock revisions match the exact GOWM bundle.
- Southbound lock schema v2 validates with 31 default and 89 preview operations.
- The retained compatibility report is `ADDITIVE`, with zero breaking changes and ten promoted operations.
- The packaged generated TypeScript contracts are MANIFEST-locked and pass strict standalone TypeScript compilation.
- Runtime validation no longer references the historical hand-vendored GOWM 0.4 contract directory.

## Tests actually run

| command | result |
|---|---|
| `npm run contracts:check` | PASS: 25 intake checks; frozen WSGS schemas/examples/types also pass |
| focused intake/workspace tests | PASS: 7/7 |
| intake package TypeScript | PASS |
| packaged generated contracts strict TypeScript | PASS |
| exact-source materialization repeated three times | PASS: identical SHA-256 |

The negative tests reject an unpinned source value, an absent tarball, corrupted archive bytes,
and changed extracted contract bytes.

## Authority and security

The intake consumes only the published consumer bundle. It introduces no provider URL, token,
private key, provider database topology, GOWM application source, or unpinned branch authority.
The frozen northbound contract is unchanged.

## Commit/push/PR

Semantic commit `8ec61c9b61729d52a8adff73239e6dce817b3404` is pushed to Draft PR #2.

## Blockers

None for W01. The task-helper integrity-semantics defect is retained as a documented package
inconsistency, not hidden as a passing raw-tar check.

## Next phase

W02 — Gateway client v2.
