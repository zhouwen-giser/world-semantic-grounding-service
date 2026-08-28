import {
  buildTrustedCapabilitySnapshot,
  TrustedCapabilitySnapshotError,
  verifyPersistedTrustedCapabilitySnapshot
} from "./snapshot.js";
import type {
  TrustedCapabilitySnapshot,
  TrustedCapabilitySnapshotInput,
  TrustedCapabilitySnapshotStore
} from "./types.js";

const jobIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function assertJobId(jobId: string): void {
  if (!jobIdPattern.test(jobId)) {
    throw new TrustedCapabilitySnapshotError("INVALID_JOB_ID", "Job identifier is invalid");
  }
}

/**
 * Owns the new-job versus restart trust boundary. Recovery has no live-input
 * argument by design, so callers cannot accidentally swap in current GOWM
 * metadata for the job's persisted snapshot.
 */
export class TrustedCapabilitySnapshotCoordinator {
  constructor(private readonly store: TrustedCapabilitySnapshotStore) {}

  async captureForNewJob(
    jobId: string,
    input: TrustedCapabilitySnapshotInput
  ): Promise<TrustedCapabilitySnapshot> {
    assertJobId(jobId);
    const candidate = buildTrustedCapabilitySnapshot(input);
    const persisted = await this.store.insertIfAbsent(jobId, candidate);
    const verified = verifyPersistedTrustedCapabilitySnapshot(persisted.snapshot);
    if (!persisted.inserted && verified.snapshotHash !== candidate.snapshotHash) {
      throw new TrustedCapabilitySnapshotError(
        "JOB_SNAPSHOT_CONFLICT",
        `Job ${jobId} is already bound to a different trusted capability snapshot`
      );
    }
    return verified;
  }

  async loadForRestart(jobId: string): Promise<TrustedCapabilitySnapshot> {
    assertJobId(jobId);
    const persisted = await this.store.load(jobId);
    if (persisted === null) {
      throw new TrustedCapabilitySnapshotError(
        "JOB_SNAPSHOT_MISSING",
        `Job ${jobId} has no persisted trusted capability snapshot`
      );
    }
    return verifyPersistedTrustedCapabilitySnapshot(persisted);
  }
}
