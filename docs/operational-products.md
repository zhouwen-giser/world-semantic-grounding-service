# Operational products

Operational products are read-only projections of already normalized GOWM
evidence. The assembler filters only the caller's requested product kinds and
never reaches an external provider, database, or mutation endpoint.

Operational task payloads retain four independent dimensions: control state,
activity state, outcome verification, and observability. A completed report is
not treated as verified. Correlation exact/possible/conflicting/no-match
relations, predicate support/no-data/negative evidence, timeline order and
truncation, and observability assessments remain unchanged.

External correlation authority, kind, and value are opaque strings. WSGS does
not infer the external system's internal task, step, command, route, or state
model. The returned products are deep clones, so assembly cannot mutate the
authoritative normalized evidence.

When a requested optional operational product has no matching evidence, the
result becomes `PARTIAL` with a non-blocking `NOT_REGISTERED` CapabilityGap and
`substituted=false`. No different operation or product is used as a fallback.

