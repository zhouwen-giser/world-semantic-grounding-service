# W04 Selection Authority Preparation

Status: IN_PROGRESS, not a completed acceptance phase.

`packages/prior-grounding/src/validator.ts` now has a separate analysis selection
entry point that reuses the existing identity and scope checks. It accepts only
the frozen five-field selection plus its priorGroundings pointer. It parses
server-stored bytes, runs the complete public 1.2 validator (including the public
result hash and finding closure), checks stored hash and principal/actor/scope,
then resolves the exact saved candidate. No safeSummary, coordinates, rank or
display label supplied by the client can replace that candidate.

TTL checks include server retention, Choice expiry and linked finding/reference
expiry when present. selectedProductIds may be empty for analysis selection;
nonempty values must still identify real ReferenceProducts. Pretty-printed
stored JSON remains valid under the frozen canonical result hash, unlike the
old raw-byte-hash decoder.

The initial checkpoint recorded below predates production wiring. No W04
Required row is marked PASS solely on this helper's tests.

Implementation commit: a211c55. `selection-tests.json` records 41 passing tests
across the existing prior validator, new selection validator and Worker recovery
adapter. `selection-build.json` records a passing independent build. The W03
`recovery-check.json` records the complete check: 852 passing and 29 skipped
tests, no failures, 836 frozen contract assertions and 68 legacy byte checks.
Real PostgreSQL, Gateway, model and SACS remain NOT_RUN.

## Production Wiring Increment

The Worker now passes its existing encrypted checkpoint journal to the stage
factory. For a single structured selection, LOAD_CONTEXT reads the prior result
through principal/actor/scope/authorization-context restrictions, validates the
public Choice, then restores the matching encrypted checkpoint using its actual
run fingerprint. Both the decrypted state hash and the assembled result hash
must match. Missing/corrupt source authority is not reconstructed from summaries.

Rank selections can reuse complete source envelopes and carry real prior
ReferenceProducts into the new result. Explicit action intent uses the selected
rank's actual visited point; ordinary selection never inherits an old action
request. Metric/series/catalog/phase/execution/update changes do not reuse old
rankings. Series selection triggers a new query. Text/structured rank conflicts
and unrelated text are clarified. Choice expiry is checked again before reuse.

Tests exercise real encryption/journal restoration against scripted SQL and
two-round complete public projections. They do not yet exercise a real HTTP
listener or the entire production stage factory. Open: event/reference/task
choices, multiple structured selections, natural-language-only ordinal selection,
requery reference propagation, and L1 production HTTP multiround evidence.
W03 and W04 remain IN_PROGRESS.

Wiring implementation commit: a2b321d. `followup-check.json` records 863 passing
tests and 29 skipped tests, with frozen contracts/architecture/type checks PASS.
`followup-action-tests.json` records 43 passing focused tests and
`followup-build.json` records the independent build. The initial two-turn test
incorrectly named the action point `position`; it was corrected to the frozen
contract's `target` field, with no contract/schema changes.

## Ordinal and Event Increment

Natural-language ordinals are now inferred only after full stored-result and
scope validation, and only when exactly one Choice exists. Missing ranks,
multiple Choices and conflicts with an explicit candidate are rejected. The
production context loader derives this ordinal internally; no public request
field was added. Multiple contradictory ordinals in the same text are clarified.

Runtime temporal findings now emit the already-frozen EVENT_SELECTION menu.
Selecting an event resolves its stable public ID against the original native
event in the private full envelope. Projection filters display entries only;
upstream envelopes, completeness and FIRST/LAST proof are not manufactured.
Existing proof is omitted if it refers to a different event. Missing native
events yield SELECTION_INVALID rather than replacement coordinates.

Six runtime event hash snapshots changed because their components now include
event menus. The W01 frozen artifacts and historical W02 evidence were not
rewritten. This change closes an implementation omission discovered while
testing event choices; previous reports must not be read as proof that the old
runtime emitted those menus.

Remaining: reference/task Choice consumption, combined selections, requery
reference propagation and full production HTTP multiround evidence. W03/W04
completion is still unproven.

Ordinal/event implementation commit: 5ae13b5. `event-selection-check.json`
records the complete check with 872 passing tests and 29 skipped tests.
`event-selection-tests.json` records 65 passing focused tests;
`event-selection-build.json` records the independent build. All commands exited
zero. None of this evidence is a real HTTP or live PostgreSQL qualification.

## Reference and Task Increment

Existing reference ambiguities now generate REFERENCE_SELECTION or TASK_SELECTION
menus bound to actual ReferenceProduct IDs. Menu limits yield explicit truncation
gaps. The prior loader accepts an ordinary reference Choice without fabricating
historical analysis; when an advanced intent exists it restores that intent from
the encrypted execution/compilation state.

The selected stored product enters the existing KnownWorldReference parsing and
reference.validate path. Task/subject changes build a new query and do not reuse
old rankings or action intent. For target-dependent temporal events, an authorized
selected spatial key drives geometry lookup after successful reference validation
instead of resolving the ambiguous alias again. Target versus subject is inferred
from stored ambiguity/event links, not solely WORLD_OBJECT kind; the tests cover
a WORLD_OBJECT area remaining distinct from the historical subject and preserve
the ordinary opaque product ID ugv1.

Requeries propagate prior real ReferenceProducts so new normalized findings can
resolve their actual source links. A failed/expired selected reference stops
advanced execution. These stage connections are implemented and compile, but
their full production execution still requires W06 HTTP evidence. Combined
selections and final W04 acceptance mapping remain open.

The first full reference-selection check exposed a legacy recovery regression:
REFERENCE_VALIDATE had newly required LOAD_CONTEXT for old isolated recovered
stages. The implementation now reads the original request capsule for 1.0/1.1,
while 1.2 still requires the authorized loaded state. The failing full log is
retained as `reference-selection-check.log`; it must not be reported as PASS.
