# Typed World Query compiler

The compiler accepts a semantic pattern selected inside the WSGS runtime, one
bounded operation-input object, a trusted live capability snapshot, byte-locked
operation metadata, and execution budgets. It does not accept a public DAG,
operation ID, URL, SQL fragment, provider choice, or arbitrary binding.

The versioned rule table maps only the WSGS v0.1 patterns to exact operations.
Each operation must match its locked version, provider, maturity, input hash,
output hash, and named typed ports before a plan is produced. Missing or drifted
operations return a blocking `CapabilityGap`; the compiler never substitutes a
similar operation.

Plans use `WorldQueryPlanV2` nodes and `REQUEST_PATH`/`NODE_OUTPUT` bindings.
Reference, correlation, and H3 chains name the exact typed source port and
target path. H3 neighborhood output remains explicitly approximate. A
boundary-sensitive H3 rule always adds an exact Spatial verification node.
Discrete H3 units cannot be relabeled as angular degrees or linear meters.

Node budgets are integer partitions of the caller's aggregate row, candidate,
byte, and execution-time budgets. Plan validation checks aggregate totals,
depth/node limits, unique IDs, and every binding/output endpoint. Canonical
sorting/serialization yields a stable SHA-256 plan hash.

