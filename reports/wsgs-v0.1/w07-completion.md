# W07 Completion Report

## Scope completed

Implemented a real HTTP adapter for OpenAI-compatible Responses and Chat Completions endpoints. The default path requests strict structured output, all paths apply the frozen `WorldSemanticFrame` schema again with local AJV, and no tool/function surface is sent.

## Source state

The prompt is versioned as `wsgs-domain-semantic-frame/1.0.0`. Source text is serialized only inside a separate untrusted user-data payload. The stable system instructions prohibit intent/routes, provider/operation/URL/SQL/MCP/EPSG, ReferenceKey/object IDs, candidates, world facts, evidence, reasoning, and chain-of-thought.

## Runtime behavior

- Loads exactly the six required `MODEL_*` settings with bounded numeric validation.
- Supports Responses strict JSON Schema, Chat Completions strict JSON Schema, and Chat Completions JSON-only compatibility.
- Uses temperature zero, no tools/functions, an overall deadline, caller abort, bounded output bytes, and bounded jitter retries.
- Retries transport, 429, and 500/502/503/504; terminal authorization/client errors are not retried.
- Invalid envelope/JSON/schema output receives only configured bounded repair attempts.
- Refusal, timeout, exhaustion, invalid output, and unavailability are explicit typed errors; no keyword fallback exists.
- Success and failure receipts retain hashes/metadata only, never raw model/input/output/request identifiers or reasoning.

## Tests actually run

| command | result | evidence |
|---|---|---|
| `npm run typecheck` (first run) | FAIL | NodeNext CJS interop types and one exact-optional test initializer |
| semantic model suite | PASS | 12/12 strict-format/null normalization, injection isolation, exact-span rejection, repair, retry, abort, receipt, compatibility, unavailable/config tests |
| `npm run check` after fixes | PASS | 36 passed; 8 real-DB tests skipped without `TEST_DATABASE_URL` |
| real compatible model call | NOT_RUN | all six `MODEL_*` variables absent; no mock evidence counted as real |

## Acceptance cases

- PASS: AC-M002..AC-M013.
- NOT_RUN: AC-M001 requires configured real-model acceptance in W16.
- NOT_RUN: AC-M014 requires the W08/W14 product path to combine deterministic success with an explicit natural-language Partial result.

## Authority and security review

The bundled schema removes external `$ref` resolution without widening any allowed field. OpenAI strict transport makes frozen optional properties required-and-nullable, strips only those transport nulls on return, then validates the normalized value against the unchanged frozen schema. Mention spans must exactly slice the original UTF-16 input and cannot overlap excluded deterministic spans. Both strict and JSON-only transports remain untrusted. Prompt injection stays user data, the adapter sends no tool definitions, and receipt serialization contains hashes rather than secrets or content.

## Standards basis

The Responses request shape and strict schema placement follow the official OpenAI Responses API and Structured Outputs documentation checked during W07. Compatible endpoint support remains an explicit configuration choice rather than being inferred.

## Failed attempts

The first strict typecheck exposed module-interop typing for AJV/AJV Formats and an exact-optional test initializer. Both were corrected without weakening compiler settings. The architecture scan then rejected a test-only literal matching the forbidden agent-surface token; the redundant assertion was removed while the stronger absence checks for tools/functions remain.

## Commit/push/PR

Recorded in the W07 semantic commit and Draft PR #1 update.

## Blockers

Real model acceptance is unavailable until deployment supplies the six `MODEL_*` variables. This is deferred to W16 and does not have simulated PASS evidence.

## Next phase

W08 validates semantic frames beyond schema rules and merges deterministic/model products into a typed grounding graph.
