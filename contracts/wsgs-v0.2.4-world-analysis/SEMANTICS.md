# World Analysis Contract Decisions

Release state is recorded exclusively in contract-freeze.json and verified by
the release lock. This document is part of W01 and does not enable runtime
behavior. Passing full contract/semantic checks and a separate freeze commit
are required before runtime work. No public 1.2 identity existed at W00.

## Identity and Transport

The exact pair is `sacs-wsgs-grounding/1.2` and
`wsgs-world-analysis-findings/1.0`. Keep `schemaVersion: "1.0"` in the existing
request/result/Job envelopes. New schemas are complete closed outer objects,
not allOf extensions of closed legacy objects. Legacy files remain byte-identical.

Every valid 1.2 GroundingResult includes worldAnalysisFindings, including empty
findings/choices/gaps with their true hash. geospatialFindings is optional and,
when present, conforms to the unchanged geospatial profile. Only the exact
header pair plus a generic server-owned principal allowlist enables 1.2.
No headers, or explicit 1.0 without a profile, retains 1.0. Exact authorized
1.1 retains existing behavior. Unknown, single-sided, duplicate, comma-joined,
whitespace-altered or mismatched headers fail with HTTP 406 and
WSGS_CONSUMER_CONTRACT_MISMATCH for the new protocol. Old error behavior stays
unchanged. User-Agent, Accept and request content never authorize a profile.

POST uses the selected request validator. GET and cancel must match the stored
selection or return 406; they never reproject an old result. Same idempotency key
with different complete semantic input (including profile or selections) is
409 IDEMPOTENCY_CONFLICT, before mismatch or new-work readiness checks. Identity
and data-scope checks precede disclosure. Missing/out-of-scope prior results use
the same selection-unavailable business gap, not an existence oracle.

## Identifiers and Sources

findingId identifies one public finding. choiceId identifies a bounded choice.
candidateId identifies a candidate within that choice/finding; rank is never an
identity. All must be unique in their declared namespaces. References to other
findings/candidates/events must resolve within the emitted result. Historical
selection may copy an authorized prior source finding into the new result to
preserve this closure; it may not emit a dangling cross-result ID.

subjectReferenceProductIds and any referenceProductId refer exclusively to
actual result.referenceProducts[].productId. The latter contains only real
Gateway reference keys, never analysis/event/H3 identifiers. Opaque legal world
IDs such as ugv1 are accepted. Road feature/junction IDs are explicitly opaque
network-local identifiers with network version/hash context, not reference keys.

Finding evidenceIds link to result.evidenceItems[].evidenceProductId. The
evidence item's own evidenceIds and receiptIds retain upstream evidence/receipt
identities and are not assumed to be local products. Successful historical
findings require validated server-side evidence. Provenance metadata is bounded;
1.2 does not forward raw safePayload, payloadRef or arbitrary snapshot objects.
Public snapshot summaries retain their full-source canonical hash and known
capture/version fields. Validated complete authority remains private for reuse.

## Time, Coordinates and Missing Data

TimeRange contains original timezone-qualified start/end and explicit bounds:
`[)`, `[]`, `(]`, `()`, or `UNSPECIFIED`. GOWM historical ranges declaring `[)`
retain it. GSAP's locked TimeRange has only start/end, so it maps to UNSPECIFIED;
WSGS must not invent endpoint inclusivity. Preserve source instants and precision,
including offsets. Validate start <= end; do not derive a new interval across gaps.

Instant events retain the whole source time window. An estimate is optional;
when present it must fall within the source window. Interval duration is a
source statistic, not an invitation to bridge gaps. Unknown values are omitted
or represented by a typed gap, never substituted with 0, false or empty IDs.

Public Point is exactly 2D EPSG:4326 longitude, latitude. Each coordinate is finite
and within [-180,180]/[-90,90]. No altitude is synthesized. Public line previews
have bounded complete positions and are never navigation geometry. Confidence,
when present, is a source-reported value in [0,1], not a synthesized probability.

## Finding Semantics

HISTORICAL_TRACE preserves separate requested/selected/active/paused/defined/
excluded/gap periods, execution number/lifecycle, real interval and trajectory
products, completeness and finalization. No interpolation or ALL-execution merge.
PROVISIONAL/SEALED/CONFLICTED remain distinct; trajectory sealing does not prove
metric sampling completeness.

ROAD_ASSOCIATION fixes networkRole=REFERENCE_MODEL_NOT_PHYSICAL_TRUTH. Off-network,
ambiguity and network-issue candidates remain uncertain categories. Network
topology is CURRENT_ACTIVE_TOPOLOGY, not proof of historical physical conditions.
The last confirmed road is CONFIRMED_IN_AVAILABLE_DATA, never an absolute final
road. Missing suffix, off-network or ambiguity is retained, not normalized away.

TEMPORAL_EVENT supports the six actual types. FIRST/LAST retains confirmed,
selectedEventId, confirmation scope, reason and blocking periods. Display
truncation alone does not invalidate an independent upstream selection proof
when the selected event and complete proof are retained. If either is lost,
remove the dependent selection and emit a truncation/incomplete-proof gap.

METRIC_RANKING fixes PAST_OBSERVED_LOCATIONS and
metricTemporalCompletenessKnown=false. Current locked GSAP ranks by MEDIAN.
Public rankingBasis declares MEDIAN, direction, median rankingValue and bounded
tie-breakers. representativeValue remains the value of the representative
measurement, not the median. Unknown ranking basis is unsupported, not "best".
Retain original ranks, series identity, unit, observed time/measurement/position,
sample count and source statistics. No unit conversion, absolute RSSI, zero-sample
zero value, mixed-series ranking, combined score or H3-center target.

ACTION_TARGET_CANDIDATE is only MOVE_TO_LOCATION from a selected historical
metric candidate. It requires an explicit action-candidate intent and exact
source finding/candidate/rank, measurement ID/time and evidence. Its Point equals
the representative visited Point byte-for-byte as JSON values. All three
requirements are true: currentValidationRequired, routePlanningRequired and
executionConfirmationRequired. executionAuthorized is always false. Ordinary
Top-K requests do not produce an action. No control parameters, tools, topics,
missions, device bindings or execution protocol appear in this model.

## Choices and Selections

Choice kinds: REFERENCE_SELECTION, TASK_SELECTION, METRIC_SERIES_SELECTION,
RANKED_LOCATION_SELECTION, EVENT_SELECTION. Their candidate summaries are closed
typed unions, never arbitrary Provider objects. Choices are not authorization.
Each has a server-assigned validUntil, bounded by source validity and a 60-second
choice lifetime. GET/retry does not refresh it or regenerate IDs.

Only 1.2 requests accept top-level analysisSelections, at most 8. Each supplies
priorGroundingId, priorResultHash, findingSetHash, choiceId and candidateId and
must match a contextCapsule.priorGroundings anchor. Duplicate/conflicting choice
selections fail request semantics with INVALID_GROUNDING_REQUEST (400). Client
coordinates/rank/summaries cannot be supplied as selection authority.
selectedProductIds remains reserved for real ReferenceProducts, including in 1.2.

Resolve selections only from server-owned saved bytes under actor/data scope,
stored profile, result integrity, finding-set integrity, TTL and complete source
relationships. Invalid/expired/missing selections become typed blocking gaps and
require clarification/requery. Text ordinals can select only within one unique
valid choice. Explicit text contradicting structured selection must clarify.

Changing task, execution, subject, phase, metric, unit, series or target is a new
semantic query and invalidates old derived action targets. Do not relabel old
results. A candidate removed from public preview may be resolved from separately
retained private validated authority, but only under the same checks. If not
retained, requery or clarify rather than calculate a replacement position.

## Status and Gaps

Finding status is COMPLETED/PARTIAL/NO_DATA/INDETERMINATE. Result keeps existing
terminal states, without PENDING. Real running WSGS jobs use ACCEPTED/RUNNING.
Upstream projection pending finishes this query PARTIAL with a typed pending gap.

Deterministic aggregation for 1.2: cancellation wins; unresolved required choices
yield AMBIGUOUS while preserving independent findings; upstream failure/timeout/
contract mismatch yields FAILED if no independent usable finding, otherwise
PARTIAL; missing required context yields UNRESOLVED if none is usable, otherwise
PARTIAL; input incompleteness or loss of required output yields PARTIAL; remaining
successful analyses, including proven empty data, yield COMPLETED. An unknown
period never proves real-world absence. Action-use requirements are INFO gaps
and do not turn a completed read-only analysis into FAILED.

Gap kinds/reasons are finite vocabularies covering capability/reference/context,
metric, pending/incomplete data, truncation, selection, upstream failure and
action-use limits. Details are bounded typed fields. No stack trace, secret,
local path, raw payload or unconstrained exception message is public.

## Hashes and Limits

Artifact locks hash exact UTF-8 bytes (SHA-256), not Git blob identities.
findingSetHash hashes canonical JSON of {profile,findings,choices,gaps}, excluding
itself. Object keys sort by JavaScript UTF-16 code-unit order; arrays preserve
order; JSON serialization uses ECMAScript number/string encoding; finite numbers
only, -0 becomes 0, undefined object members are omitted, and cycles/non-JSON
objects are rejected. No locale-sensitive comparison or sorting of ranked arrays.

For 1.2 resultHash preserve the pipeline's preimage shape
{runFingerprint,status,value}, excluding top-level resultHash and
execution.elapsedMs from value. execution.runFingerprint makes this context
explicit and independently verifiable; it is included in value. The new public
canonical ordering above applies only to 1.2. Legacy 1.0/1.1 algorithms/bytes stay
unchanged. New extensions are present before hashing and persistence. Hashes
prove integrity, never authorization. Raw stored-byte hashes are separate
private integrity metadata and cannot be compared to this resultHash.

Public limits: 32 findings, 32 choices, 100 candidates per choice, 100 rank/event/
road entries, 100 periods/segments, 256 line positions, 64 gaps, 32 local source
IDs per finding, 100 warnings/unknowns, 256-character IDs/codes, 512-character
labels, 8 selections and 1048576 total public result bytes. The caller's smaller
maxResultBytes wins. Inherited request limits stay unchanged. No recursive public
business payloads are allowed. Limits are maximum previews, not source totals.

Validate source and identity closure before trimming. Retain selected entries,
their evidence/subject/source finding and completeness metadata; never slice a
coordinate tuple. If closure cannot fit, remove dependent derived objects and
return a valid compact RESULT_TRUNCATED gap. If even a compact valid result cannot
fit, fail with RESULT_TOO_LARGE under the existing terminal Job error mechanism;
never return an unvalidated oversized object. Do not repeatedly query to fill a
display budget. Private authority retention and public preview are separate.

## Capabilities and Freeze

1.2 capabilities declares five finding kinds and five choice kinds, structural
selection support, the two component profiles, limits, and per-capability
supported versus available with bounded reason codes. Availability is derived
from opt-in flags, principal authorization, fresh trusted snapshots, exact
operation/schema/semantic versions and permission. CROSS depends on trace/T2/T3;
historical action depends on trace/T4. Missing optional providers affects only
dependent capabilities. Contract negotiation support does not imply deployment.

Freeze covers schemas, semantic validator, vectors, limits/vocabulary, public
types, examples and OpenAPI. No runtime Provider code belongs in the consumer
package. A manifest excludes itself from its hash input to avoid cycles. A
post-freeze change requires explicit withdrawal/refreeze before distribution or
a new contract version after handoff. W01 validation is not runtime readiness.
