# Explicit Candidate Withdrawal

The first undistributed, uncommitted W01 candidate is WITHDRAWN.
Its exact original lock, freeze record and checksums are retained here.
Reason: SEMANTICS.md still declared DRAFT/NOT_FROZEN even though the release
record declared a frozen candidate. No runtime was implemented and no consumer
handoff, commit, push or distribution occurred. Replace that stale state text
with the release record as the single lifecycle authority, then run all W01
checks and produce a fresh candidate. This is an explicit withdrawal/refreeze,
not a silent hash update.
