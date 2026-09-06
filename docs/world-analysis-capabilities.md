# World Analysis Capability Discovery

The API accepts the exact pair `WSGS-Contract-Version: sacs-wsgs-grounding/1.2`
and `WSGS-Result-Profile: wsgs-world-analysis-findings/1.0` only for authenticated
service principals in `WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON` (default `[]`).
The existing 1.0 and 1.1 projections and authentication policies are unchanged.

## Configuration

- `WSGS_HISTORY_TRACE_ENABLED=NO`: existing history opt-in, unchanged.
- `WSGS_ADVANCED_HISTORY_ENABLED=NO`: existing GSAP analysis opt-in, unchanged.
  Advanced history requires history enabled. Its three verified provider locks
  are selectively authorized; this does not enable global PREVIEW execution.
- `WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON=[]`: independent northbound
  profile allowlist. Adding a principal does not grant upstream operations.
- `WSGS_READINESS_TIMEOUT_MS`: existing Gateway discovery deadline, default
  15000 ms. Existing Gateway URL, delegation signing and identity configuration
  are reused. No second authentication system or direct provider URL is added.

## Support and Availability

Five finding kinds and five structured choice kinds are implemented. `supported`
does not assert deployment or permission. Each of six capability entries reports
`available` and bounded public reason codes. Discovery reads schema-validated
Gateway catalogs and a freshly signed, caller-filtered availability response;
the readiness principal's cached view is not reused for caller authorization.
No semantic model is invoked by the discovery probe. The existing aggregate
`requiredCapabilitiesReady` retains its existing meaning and is not a new
production qualification gate.

History requires the locked task find/get/interval and history trajectory
operations. Road association requires history and T2; temporal events require
history and T3; metric ranking requires history and T4. CROSS requires both T2
and T3. Action targets require T4 and history. Only
`HISTORICAL_METRIC_CANDIDATE` is advertised as an action source: no arbitrary
current/user location, device execution authorization or planning approval.

Checks include exact operation version, maturity, input/output hashes, semantic
profile hash and recomputation, catalog/binding revisions, caller-filtered grant,
runtime state and validity times. Discovery expires after at most five seconds,
or the earliest accepted upstream expiry. A positive discovery response does
not bypass execution-time validation or authorize later device actions.

Missing or invalid discovery returns a schema-valid 1.2 document with unavailable
entries, not a 500 caused by a legacy capability document. Local optional failures
propagate only to dependent entries. Unknown upstream diagnostic strings are not
published. The response carries the frozen public limits; configurable internal
limits may be lower and do not enlarge the public contract.

## Verification Boundary

W05 component tests exercise production projection, dependency propagation,
contract drift, permission omission, freshness and the complete public validator.
They are not real Gateway, PostgreSQL, model or SACS end-to-end evidence. W06
owns production-path local HTTP integration and failure-isolation evidence.
