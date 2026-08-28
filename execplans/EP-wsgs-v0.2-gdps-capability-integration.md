# WSGS v0.2 GDPS capability grounding integration

## Scope

Extend the existing WSGS semantic frame, requirement planner, capability matcher, typed query compiler,
Gateway executor, evidence normalizer, and replay policy so PREVIEW GDPS capabilities can be consumed only
through the GOWM World Capability Gateway. Runtime code must not call GDPS HTTP, Provider Protocol, database,
or product files directly.

## Ordered delivery

1. W20 locks the current WSGS, GOWM, GDPS, public Gateway, and Provider-manifest baseline.
2. W21-W25 add the trusted GDPS capability snapshot, semantic vocabulary, semantic requirements,
   explicit PREVIEW recipes, and typed query plans.
3. W26-W31 prove real Gateway execution, normalized product evidence, a combined integration instance,
   natural-language cases, current-only replay, ambiguity, data-gap, partial, truncation, drift, and scope safety.
4. W32 runs the complete regression and audits the evidence set before publication.

## Non-claims

- No direct GDPS client or Provider adapter is part of WSGS.
- No product identifier is inferred or hard-coded when the user did not state it.
- No product-version or historical GDPS semantics are introduced.
- No merge, tag, release, or deployment is authorized by this plan.
