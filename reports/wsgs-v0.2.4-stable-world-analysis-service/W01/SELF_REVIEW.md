# W01 Contract Self-Review

Scope: public contract only; no new API/worker execution code is enabled.

Reviewed the closed five-kind union, five choices, bounded gaps, full outer
request/result/job/capabilities closure, and real server.ts route envelopes.
The existing 1.0 and 1.1 schema bytes were compared to the 68-file W00 baseline;
the 29 bundled public dependency schemas are compared directly to their source.

Issues found and fixed before freeze:

- Strict Ajv rejected conditional minItems without array types. Added explicit
  types in the conditional schema, without weakening strict validation.
- json-schema-to-typescript did not understand 2020-12 prefixItems and ignored
  if/then required fields. Added schema-driven in-memory tuple/status expansion;
  generated coordinates are [number, number] and successful findings require
  real source fields. No generated TypeScript was hand-edited.
- Initial validator used shortened names for minimum/maximum and estimatedAt.
  Corrected to schema property names, with negative statistics/window examples.
- JS millisecond date comparison could overlook reversed sub-ms instants.
  Added fractional-precision comparison and a rejection example.
- Shared fixture object identity made an initial mutation change both source
  and target positions. Replaced only the target object; the negative example
  now proves ACTION_SOURCE_MISMATCH independently of hash mismatch.
- Initial TypeScript invocation inherited the repository config despite explicit
  file arguments. Used the installed TypeScript 7 --ignoreConfig option and
  independently compile both generated types and public declaration entrypoint.

The result hash preimage retains runFingerprint/status/value and excludes
elapsedMs. 1.2 makes the fingerprint public for independent verification and
uses explicitly portable code-unit ordering; legacy hash implementations are
unchanged. This is a new-profile design decision, not a legacy byte migration.

No pending W01 defect is being waived. Runtime conversion, private authority,
HTTP integration, capabilities availability and multi-turn authorization remain
W02-W06 work. The 44 examples are artificial, not evidence of field execution.
