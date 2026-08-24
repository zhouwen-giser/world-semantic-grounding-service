# Semantic frame and grounding graph

`WorldSemanticFrame` is validated twice: first against the frozen JSON Schema in
the model adapter, then against semantic invariants before graph construction.
The second layer verifies exact UTF-16 source slices, unique mention/expression
IDs, valid mention/expression references, non-empty and ordered time bounds, and
finite spatial distance values.

The graph merger uses this fixed precedence:

1. client Map selections;
2. caller-supplied KnownReference values;
3. deterministic parser candidates;
4. domain-model mentions and semantic expressions.

A compatible model mention may add semantic types to an exact deterministic
span, but it cannot replace its identity or source. Incompatible Map/text,
context/type, or namespace interpretations become explicit `UNKNOWN` ambiguity
nodes with `CONTRADICTED_BY` edges. Model-only data can create only `MENTION` or
`SEMANTIC_OPERATION` nodes; it cannot create a finding, resolved reference,
world fact, or evidence.

Every edge endpoint must exist, node/edge IDs are unique, self-edges are
rejected, and the frozen limits of 256 nodes and 512 edges are enforced. Nodes
and edges are sorted by stable IDs and the complete graph receives a canonical
`sha256:` hash, making retries byte-stable.

When the model is unavailable, an empty semantic frame is combined with the
deterministic parse. Explicit H3, coordinate, map, geometry, KnownReference, and
code candidates therefore remain available, but the product is marked
`PARTIAL` with a typed model-unavailable warning. No natural-language semantic
completion is fabricated.

