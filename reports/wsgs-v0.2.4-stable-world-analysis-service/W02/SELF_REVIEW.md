# W02 Normalization Self-Review

The implementation is a projection layer, not an analysis engine. It consumes
the existing validated historical foundation and revalidates complete Provider
envelopes. It never decodes the cropped legacy safePayload as authority.

Reviewed scope/reference/metric relationships before projection; CROSS requires
the exact validated T2 result hash and matching network context. Source failures
roll back their findings, choices, evidence and incidental truncation gaps while
preserving independent history. Metric concepts, fields, stage and units must
match the trusted catalog; explicit query direction is separately retained.

Checked the byte-size path: selected action candidates and exact coordinates
are pinned. Removing display entries removes dependent choice entries as well.
An independent FIRST/LAST proof survives unrelated display clipping. If a
dependency-complete result cannot fit, the result becomes an explicit compact
Gap; below the valid envelope floor it raises RESULT_TOO_LARGE. No coordinates
are sliced and no query is repeated to fill a preview.

Optional ranking menus are not unresolved required inputs. The aggregate helper
receives only required choices (series/task/reference); the full public component
retains optional follow-up menus. No public schema/validator lock was changed.

Issues corrected during this phase:

- Source rollback initially removed evidence but could leave its finding; all
  per-source projections now roll back together.
- Generic Provider latency sample did not match the deployed metric catalog.
  The controlled test projection is now explicitly adapted to the actual catalog
  fields and verified, without altering the original upstream fixture.
- A 120-event test used invalid source IDs and failed the upstream validator.
  Corrected to its actual tse_<32 hex> contract; the valid case demonstrates
  100-event public display with LAST selected event and proof retained.
- Multi-interval rejection now prevents downstream analysis projection, rather
  than merely omitting the trace finding.
- Snapshot summaries now preserve source capturedAt when provided, as well as
  the complete source hash. Golden vectors were intentionally updated for it.

Final evidence: 28 new projection tests, 157 related regression tests, nine
fixed golden pairs, full build and frozen-contract checks PASS. Earlier failing
attempts were diagnostic and are not reported as passes. No live service or HTTP
production assembly has been used to support this W02 conclusion.
