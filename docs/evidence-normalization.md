# Evidence normalization

Only a validated GOWM capability result envelope can create a
`GroundingEvidenceItem`. The envelope's operation/version, provider, output
schema, compute snapshot, and every execution receipt must match trusted locks.
Unknown envelope fields fail closed.

Execution receipt IDs and authoritative evidence-reference IDs are collected
into separate arrays. Receipts describe how computation ran; they never become
world evidence. Model receipts are outside this input contract and cannot enter
either evidence authority or evidence IDs.

The upstream status is preserved exactly. `NO_DATA`, `INDETERMINATE`, and
`PARTIAL` create explicit unknown markers; `NO_DATA` is never converted to
false, and `FAILED` returns a failed normalization result without an evidence
item. Data and compute snapshots remain separate objects.

Payload schema URI/hash and GOWM authority are preserved. Payloads within the
configured byte bound are copied as safe payloads. Larger geometry/row/object
results are replaced by a byte count, SHA-256, bounded key/item summary, and an
authoritative payload reference when one exists. Raw large content is not
retained in the WSGS result.

