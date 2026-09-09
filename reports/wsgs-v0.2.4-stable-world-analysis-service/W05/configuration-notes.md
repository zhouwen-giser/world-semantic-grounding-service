# W05 Configuration Evidence

Canonical explanation: `docs/world-analysis-capabilities.md`.
The existing `.env.example` already specifies history and advanced flags as
`NO` and the independent world-analysis principal list as `[]`; no default
configuration changes were needed. No secret values were read or added.

Discovery follows the existing signed Gateway path with the actual authenticated
principal's data/dataset scopes. It never directly invokes GSAP providers or
queries their databases. Local schema availability cannot establish remote
availability. The maximum public discovery lifetime is five seconds and is
clamped by the earliest accepted upstream operation lease.

The older aggregate readiness function and all public 1.0/1.1 projection values
remain unchanged. This phase adds neither a total platform readiness gate nor
an implicit model fallback. Missing discovery is explicit unavailability while
the legal 1.2 capability response remains usable.

See `capabilities-report.json` for exact source identity, command evidence,
skipped tests and unexecuted infrastructure scopes. This is an in-progress
phase report, not WA-046 through WA-054 completion or a release qualification.
