# Public World Analysis Contract

Exact authorized transport: `WSGS-Contract-Version: sacs-wsgs-grounding/1.2`
and `WSGS-Result-Profile: wsgs-world-analysis-findings/1.0`.

This directory is the public contract source, not a running service and not a
claim of live GSAP/GOWM/SACS acceptance. `SEMANTICS.md` specifies the normative
cross-field rules and the boundary between historical evidence and future use.
`openapi.json` specifies existing HTTP routes, including distinct sync Result
and async/stored/cancel Job envelopes. No selection endpoint is introduced.

`validator.mjs` exports an offline `createPublicValidator()` for request, result,
job and capabilities. It uses only Node.js, Ajv 8 and ajv-formats 3. It does not
import WSGS runtime or Provider code, fetch schemas, or authorize a caller.
Use JSON parsing before validation. Only `valid: true` means both full schema
and applicable cross-field checks passed. Hashes never replace server-side
actor, scope, retention, currentness, expiry or source-authority checks.

The 44 examples are explicitly artificial contract-design samples, not live
measurements. Positive/negative expectations are recorded in their manifest.
`request-selection.json` follows `ranking.json`; the selected candidate is a
choice candidate and not a ReferenceProduct ID. Ranking sample sets can be
represented by [-50,-42,-40,-40,-40] and [-55,-50,-50,-45,-43]; their medians are
not the representative sample values. None of the example reference keys is
an authority to query a deployed world.

Generated TypeScript and the embedded schema registry come only from the JSON
schemas via `validation/scripts/generate-world-analysis-contract.mjs`. The type
generator's draft-07 input adaptation preserves the 2020-12 fixed coordinate
tuples and expands status conditions into discriminated unions. Runtime schema
validation still uses the unmodified draft-2020-12 schema closure.

`npm run verify:world-analysis-contract` verifies examples, references, fixed
hash vectors, semantic rejection cases, generated output drift, TypeScript,
unchanged legacy bytes and exact release lock/checksums. It uses no live service
and does not require Docker. Frozen files must not be silently regenerated with
different bytes. The separate W01 report records the actual freeze commit to
avoid a self-referential commit/hash lock.
