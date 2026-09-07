# Limitations

- L0 contracts/unit and L1 actual local HTTP with controlled dependencies only; real Gateway/providers, PostgreSQL, model, SACS and devices are NOT_RUN; production is DEFERRED.
- HTTP uses the actual production backend/stage factory/pipeline/worker/projector and AES checkpoints, with a controlled signed Gateway and in-memory SQL adapter. This is not real PostgreSQL recovery or deployed data acceptance.
- Twenty-nine skipped tests remain explicitly skipped. Earlier failed timeout attempts are retained in W06; no assertion or request deadline was weakened to claim success.
- Historical action candidates never authorize execution; current validation, route planning and explicit execution confirmation remain mandatory.
- The standalone consumer verifies artificial complete examples and sample linkage, not live SACS authorization or currentness. Node filesystem isolation is not a network sandbox.
- Vendored dependency versions/integrity metadata match package-lock and copied bytes are hashed; registry tarball contents were not independently reverified.
- Final source review is a separate pass by the implementing agent, not a second reviewer sign-off. No merge, tag, release, deployment or device action was performed.
