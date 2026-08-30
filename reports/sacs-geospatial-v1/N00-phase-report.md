# N00 Phase Report — Source Reconciliation and Consumer Baseline

Decision: **PASS for N00 only**

Marker: `WSGS_V021_BASELINE_LOCKED`

G1: `NOT_RUN`

v0.3 branch allowed: `false`

productionQualified: `false`

## Scope completed

- Read and checksum-verified the task package and machine phase manifest.
- Fetched all WSGS remotes and audited current branches, open PRs, main CI, and merged PR #6/#7/#8.
- Reconciled current WSGS/GOWM/GDPS/SACS sources without synthesizing a runtime tuple.
- Audited the exact SACS PR #17 consumer code and exact 18-case corpus.
- Audited SACS PR #18 only as a pre-G1 source/corpus observation and confirmed 28 current cases.
- Created the N00 execution plan, 14-row acceptance matrix, 14-row traceability map, evidence template, source report, and consumer compatibility baseline.

## Current online heads

| Authority | Exact head | State |
|---|---|---|
| WSGS main | `318e02a0d77ceb696d46503ab1884ce5d4d17efd` | tree `afa91150…`; main CI SUCCESS; zero open PRs before this delivery |
| GOWM main | `d69db9b137061f73e07fb75205b0c1fdaa506045` | `0.7.0`; current source only |
| GDPS main | `bad1de09d15e0145d08f16647ed067964420b8cb` | `0.2.1`; FINAL_B delivery merged |
| SACS main | `a957cdaa60dec5a2b3d291f2a97a2ff96a72a182` | PR #17 base |
| SACS PR #17 | `951a1d81d640d24de60ce6eacc8bb6f95eb6ac35` | OPEN Draft, CLEAN/MERGEABLE, 2/2 checks SUCCESS, 18 cases |
| SACS PR #18 | `06c286433dedc8c5887eb887238628d9e588efef` | OPEN Draft, CLEAN/MERGEABLE, 2/2 checks SUCCESS, 28 cases; observation only |

## Existing qualified tuples

| Tuple | Exact binding | Honest boundary |
|---|---|---|
| WSGS ↔ GOWM 0.6.4 | WSGS `b3315cbb…`, GOWM `fceed923…`, runtime `0.6.4`, Gateway contract `0.6.3` | DEVELOPMENT_READY; formal/direct R1–R5 5/5; not production |
| GDPS FINAL_B | GDPS implementation `42e06e73…`, evidence `712abb35…`, GOWM lock `7a3600cf…`, WSGS lock `bcad5b05…`, bundle `sha256:93ebb1fd…` | upstream development evidence; W43/W44 NOT_RUN; not this branch's runtime evidence |

The tuples are retained independently. The report does not combine GOWM `fceed…` with `7a3600…`, current main heads with old runtime reports, or `bcad…` evidence with the new branch.

## Non-main FINAL_B WSGS materialization

`codex/wsgs-v0.2-descriptor-gdps-closure-resume@14abec44e104c8f1b600a9a8d282ed5a1212bfde` has merge base `65c3716f956c688f48e08a43322548b75af849b8` with current main and is not a main ancestor. It is implementation/reconciliation input only. No old evidence is promoted to the new source head.

## Source drift decisions

| System | Decision |
|---|---|
| WSGS | task generation and observed main both `318e02a…`; no source drift |
| GOWM | main advanced from qualified `fceed923…`/0.6.4 to `d69db9b…`/0.7.0; do not silently upgrade runtime lock |
| GDPS | FINAL_B is now in `bad1de0…` main, while WSGS FINAL_B materialization is non-main |
| SACS PR #17 | advanced `6bbd16b…` → `951a1d8…`; exact current consumer is the target |
| SACS PR #18 | advanced `34ffb2f…` → `06c2864…`; only P00 may consume it after G1 |

## Version inconsistency and repair plan

The selected WSGS base has `VERSION=0.2.0` while root `package.json` and `package-lock.json` are `0.2.1`. N01 will align mutable package/workspace, OCI, capabilities, handoff, README, and CHANGELOG surfaces to `0.2.1`. It will not rewrite frozen `contracts/wsgs-v0.1/**`, historical reports, or upstream contract/provider versions. `sacs-wsgs-grounding/1.1` is an additive release; the 1.0 byte lock remains `sha256:25d70b9b85b356f116a5ee2a881bae2b07ad41aa73a0e4786b77fba24876bc40`.

## SACS v0.4 compatibility baseline

The consumer authorizes `RESULT_EXTENSION` and `geospatialFindings`, and its result parser can validate the extension profile. The current producer does not yet emit the extension or contract 1.1.

There is also a current consumer-side hard mismatch that WSGS cannot hide:

- PR #17 accepts exactly four legacy request operations.
- Its preflight requires that exact four-operation capabilities array.
- The required `VALIDATE_SOURCE_CURRENTNESS` fifth operation would currently fail with `WSGS_REQUIRED_OPERATION_SET_MISMATCH` and cannot be submitted by the consumer parser.
- PR #17 parses one provisional consumer lock, not the authoritative 8+`CHECKSUMS.json` inventory.
- Its S24 preflight attempts zero business POSTs; there is no real 18-case runner.

Therefore N00 requirements are locked, but producer/consumer/runtime compatibility remain false and G1 remains NOT_RUN. WSGS must not hide the fifth operation, relabel `VALIDATE_REFERENCES`, or substitute preflight/static evidence.

Exact v0.4 cases: E2E-01–E2E-10, NEG-01–NEG-07, HYBRID-01. Canonical corpus hash: `sha256:5db86aa4975eb5ef1972942a47c12bb3a56df17d285c38af881a2fc172a74b52`.

## Commands and observations

| Command | Result | Evidence summary |
|---|---|---|
| `git status --short --branch` | PASS | original main was dirty/ahead/behind and left untouched; isolated task worktree was created clean from current origin/main |
| `git remote -v` | PASS | origin is `zhouwen-giser/world-semantic-grounding-service` |
| `git fetch --all --prune` | PASS | online refs refreshed before reconciliation |
| GitHub PR/CI API reads | PASS | WSGS PR #6/#7/#8 MERGED; SACS PR #17/#18 OPEN Draft and green; WSGS main CI green |
| `npm ci` on untouched selected base | PASS, exit 0 | dependency installation baseline succeeded |
| `npm run check` on untouched selected base | FAIL, exit 2 | PREEXISTING_BASELINE_FAILURE at typecheck TS7016; earlier contract/GOWM/GDPS/architecture/63-of-63 gates passed |

The initial failing diagnostic is `services/grounding-api/src/production.integration.test.ts:6:33`, module `@wsgs/runtime`, TS7016. It is preserved in the machine-readable source reconciliation report and is not attributed to N00.

## Acceptance snapshot

- V21-G01: PASS.
- V21-G02–V21-G14: NOT_RUN.
- Qualified v0.2.1 source SHA: unset.
- Runtime identity: unset.
- G1: NOT_RUN.

## N00 artifact inventory

Hashes use normalized-LF UTF-8 bytes.

| Artifact | SHA-256 |
|---|---|
| `execplans/EP-wsgs-v0.2.1-sacs-geospatial-handoff.md` | `sha256:247edcab326be4bd9be143d4b34bf74f7513cf6829237464231cd3eb933e1f18` |
| `acceptance/sacs-geospatial-v1/acceptance-matrix.csv` | `sha256:9907a03e28882f9ff481aa058a2cc94170e6bdc9bf654dbb3764cf34c9bbfe83` |
| `acceptance/sacs-geospatial-v1/traceability.csv` | `sha256:27affd52a138db010904101db43af5e99265f357f8d805ebc1a9b090c403f917` |
| `acceptance/sacs-geospatial-v1/evidence-map.template.json` | `sha256:75a04deb82236f70f4b84186334a44dfe4a2a27561c009b7debe5b4abcdc7441` |
| `reports/sacs-geospatial-v1/N00-source-reconciliation.json` | `sha256:b51e6629dbf72cf7c130de238c01f95b97628da4abc7004ce8d74d6e42935f28` |
| `reports/sacs-geospatial-v1/N00-consumer-compatibility-baseline.json` | `sha256:e12d0e10669995da8646028e3c1633a96539d7414626fdd39d3dfe22561ac3a8` |

The phase report intentionally does not hash itself. Git binds all seven artifacts after commit.

## Git and delivery

- Branch: `codex/wsgs-v0.2.1-sacs-geospatial-handoff`.
- Base: `318e02a0d77ceb696d46503ab1884ce5d4d17efd`.
- Draft PR title: `feat: publish authoritative SACS geospatial handoff`.
- Draft PR URL: pending the required N00 commit and first push; it will be recorded by an immediate N00 metadata update.

## Safety and non-claims

No shared instance was changed or restarted. No SACS/GOWM/GDPS source was modified. No credentials, internal topology, raw reference IDs, or raw business messages are present. No v0.3 branch/content exists. No merge, tag, release, deploy, or production qualification occurred.

Open work before G1 includes the pre-existing type declaration failure, version-surface alignment, N01–N11 implementation, an updated exact SACS consumer head supporting contract 1.1 and the fifth operation, authoritative bundle intake, and the real 18/18 runtime gate. The next permitted phase is N01 only.
