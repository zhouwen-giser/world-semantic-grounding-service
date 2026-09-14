# GOWM development integration

These fragments register `gowm.analysis.map-matching`, `gowm.analysis.temporal-events`, and `gowm.analysis.metric-ranking` without modifying the upstream GOWM repository.

1. Run `npm run sync:gowm-contracts` and `npm run generate:gowm-registry-fragment`.
2. Copy the three files under `contracts/manifests/` to the matching `contracts/manifests/providers/` paths named in the registry entries, in a temporary integration worktree.
3. Append all three `*-provider-registry-entry.json` objects to the selected development Gateway registry's `providers` array.
4. Set `MAP_MATCHING_PROVIDER_TRANSPORT_TOKEN`, `TEMPORAL_EVENTS_PROVIDER_TRANSPORT_TOKEN`, and `METRIC_RANKING_PROVIDER_TRANSPORT_TOKEN` to the same configured `PROVIDER_TRANSPORT_TOKEN` used by each process. GOWM's HTTP client requires at least 32 bytes.
5. Set each `endpoint` to a URL reachable from the Gateway. Generated Docker-network examples use `http://map-matching-provider:18120`, `http://temporal-events-provider:18130`, and `http://metric-ranking-provider:18140`; source-run Providers commonly use the matching `host.docker.internal` ports.
6. Point `GATEWAY_CANONICAL_SCHEMA_LOCK_PATH` at `analysis-providers-canonical-schema-lock.json` and `GATEWAY_CANONICAL_SCHEMA_ROOT_PATH` at this repository root (or copy the six schema files while preserving their `contracts/...` paths). The combined document is directly loadable by GOWM 0.7.1 and covers all three operations. Each `*-schema-lock-fragment.json` is also a standalone loadable lock; the T3 lock includes the matching T2 result schema snapshot under `supportingSchemas` so its inline `MAP_MATCH_RESULT` `$ref` resolves fail-closed.

GOWM 0.7.1 binds every input port to the whole operation input and its semantic validator rejects selector paths on input ports. Accordingly, the T4 manifest uses `valueKind: ANY` with no `/trajectoryReferenceKey` path; the request schema still requires that exact historical-trajectory ReferenceKey.

Registry manifest hashes and operation schema hashes are canonical-JSON digests of parsed documents, exactly as computed by the GOWM 0.7.1 Provider SDK and canonical schema-lock loader. They are not pretty-printed file-byte hashes. Re-run the generator after any manifest or operation-schema change.

These are handoff assets only. This repository never edits or commits into GOWM.

## Coordinated 0.1 contract update (2026-09-07)

This repair directly revises the existing operation version 0.1. T2 now allows Point off-network previews and mutually exclusive valid/raw rejected coordinates; T3 STOP adds the frozen anchor field. The output hashes and implementation/manifest digests therefore change while schema URIs and operation versions remain 0.1. This is an explicit coordinated contract replacement.

Switch the T2/T3 service binaries, their generated manifests and registry entries, the Gateway canonical schema lock, and the T3 supporting T2 schema together. Keep all files from the same generated set. Old output locks must receive `SCHEMA_MISMATCH`; do not suppress that error or mix old T2 validation with new T3 inline inputs. Roll back the entire set if needed. T4's operation Schema is unchanged, but its implementation/manifest/registry digest is refreshed for the runtime and alignment repair.

Local acceptance commands are `npm run check`, `npm run verify:service-startup`, and `npm run verify:local-conformance`. The last command uses the installed sibling GOWM source (or `GOWM_REPO_PATH`), its real HTTP Provider client, conformance kit, and envelope validators against Fastify injection. It does not attest that a deployed Gateway has loaded these registrations. Real database/Gateway acceptance remains a separate requirement; see the repair acceptance report under `reports/`.
