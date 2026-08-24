# Semantic model adapter

The domain model is an untrusted semantic parser. It may produce only the frozen
`WorldSemanticFrame`; it cannot select a provider or operation, create a
ReferenceKey, assert world facts/evidence, or call tools.

## Environment

| variable | purpose |
|---|---|
| `MODEL_BASE_URL` | OpenAI-compatible API base, normally ending in `/v1` |
| `MODEL_API_KEY` | bearer credential; never placed in receipts or errors |
| `MODEL_NAME` | deployment model name; receipts retain only its SHA-256 |
| `MODEL_TIMEOUT_MS` | overall request/retry deadline, 100..300000 |
| `MODEL_MAX_RETRIES` | additional transport/repair attempts, 0..5 |
| `MODEL_OUTPUT_MODE` | `RESPONSES_STRICT`, `CHAT_COMPLETIONS_STRICT`, or `CHAT_COMPLETIONS_JSON` |

`RESPONSES_STRICT` is the default. It sends `POST /responses` with
`text.format.type=json_schema`, `strict=true`, `temperature=0`, and `store=false`.
The compatible Chat Completions modes use either strict JSON Schema or JSON-only
output. All modes revalidate the response locally with AJV against the bundled,
byte-frozen `WorldSemanticFrame` schema.

## Failure behavior

The adapter has one overall abortable deadline. Only HTTP 429 and 500/502/503/504
or transport failures are retried, with bounded exponential jitter. Invalid JSON
or schema output receives at most the configured bounded repair attempts. A
refusal, terminal HTTP response, exhaustion, timeout, or invalid result raises a
typed `SemanticModelError`; there is no keyword fallback.

Receipts contain status, timing, prompt version, attempt count, failure code, and
SHA-256 hashes of the model name, prompt, schema, input, output, and request ID.
They never contain source text, output text, credentials, reasoning, or
chain-of-thought.

