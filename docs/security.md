# Security and Authority Notes

- SACS owns conversation intent and routing. WSGS returns neutral grounding products only.
- GOWM owns ReferenceKeys, world facts, operational reality, snapshots, and evidence. WSGS reads only through the locked World Capability Gateway.
- Model output is untrusted semantic structure. It cannot select providers, operation IDs, URLs, plans, ReferenceKeys, evidence, or final answers.
- Identity, actor, permissions, and data scope come from verified JWT or trusted deployment context, never request JSON.
- Public input is schema-closed and bounded. Raw text is hash-verified, Unicode-abuse checked, retained only under policy, and never placed in metrics.
- Database reads and idempotency keys are scope-bound. Prior grounding bytes are loaded server-side and checked against the caller's exact hash.
- Public errors are frozen, typed, and redacted. Structured logging redacts authorization, bodies, internal messages, and stacks.
- Cancellation is durable and terminal. Late model or Gateway results cannot overwrite it.
- No arbitrary URL fetch, SQL, provider endpoint, MCP discovery, free tool calling, mutation, merge, tag, release, or deployment is authorized by this repository.
