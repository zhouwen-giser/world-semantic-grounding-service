# SACS PR #17 provisional compatibility snapshot

Status: `NON_AUTHORITATIVE_COMPATIBILITY_SNAPSHOT`

These two schemas are semantic test inputs copied from SACS PR #17 head
`951a1d81d640d24de60ce6eacc8bb6f95eb6ac35`:

- `contracts/v0.4/geospatial/provisional-wsgs-consumer/world-finding.schema.json`
- `contracts/v0.4/geospatial/provisional-wsgs-consumer/source-product.schema.json`

Their JSON text is normalized to repository LF/final-newline policy while the
parsed JSON remains identical to the SACS source files. They exist only for
bidirectional compatibility validation. They are not WSGS
authority, are not part of the authoritative ten-schema set, and must not be
published in the SACS geospatial handoff inventory.

`consumer-fixtures.json` is a literal JSON projection of the six exported
finding fixtures and source-product fixture in the locked PR #17 source. Its
source path and normalized-LF source hash are recorded inside the projection;
the contract gate validates these consumer-owned values against both the PR
#17 provisional schemas and the WSGS authoritative schemas.
