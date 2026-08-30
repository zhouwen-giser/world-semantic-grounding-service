export type DriverDigest = `sha256:${string}`;

export type GdpsV021DriverCaseId =
  | "NEG-DATA-GAP"
  | "NEG-RECIPE-DRIFT"
  | "NEG-TRUNCATED"
  | "NEG-CURRENTNESS";

export type GdpsV021DriverKind =
  | "CURRENT_PRODUCT_ABSENT"
  | "RECIPE_SEMANTIC_HASH_ALTERED"
  | "UPSTREAM_TRUNCATED_TRUE"
  | "STORED_HASH_DIFFERS_FROM_CURRENT";

export type JsonObject = Record<string, unknown>;

export interface GdpsV021DriverRuntimeIdentity {
  readonly schemaVersion: "wsgs-gdps-driver-runtime-identity/1.0";
  readonly gateRunId: string;
  readonly databaseIdentityHash: DriverDigest;
  readonly wsgsRuntimeHash: DriverDigest;
  readonly gowmGatewayRuntimeHash: DriverDigest;
  readonly gdpsProviderRuntimeHash: DriverDigest;
}

export interface GdpsV021DriverSqlResult<Row extends object> {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
}

/**
 * The orchestrator intentionally depends on the narrow query surface shared by
 * pg.Pool and pg.PoolClient. It never accepts already-normalized case facts.
 */
export interface GdpsV021DriverSqlClient {
  query<Row extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<GdpsV021DriverSqlResult<Row>>;
}

export type GdpsV021DriverRuntimeVariant =
  | Readonly<{ kind: "BASELINE_READ_ONLY" }>
  | Readonly<{
      kind: "ISOLATED_RECIPE_LOCK_DRIFT";
      recipeLockPath: string;
      recipeLockHash: DriverDigest;
      consumerSnapshotPath: string;
      consumerSnapshotHash: DriverDigest;
    }>
  | Readonly<{
      kind: "ISOLATED_UPSTREAM_TRUNCATED";
      runtimeAttestationPath: string;
      runtimeAttestationHash: DriverDigest;
    }>
  | Readonly<{
      kind: "ISOLATED_CURRENTNESS_EPOCH_A";
      runtimeAttestationPath: string;
      runtimeAttestationHash: DriverDigest;
    }>
  | Readonly<{
      kind: "ISOLATED_CURRENTNESS_EPOCH_B";
      barrierAttestationPath: string;
      barrierAttestationHash: DriverDigest;
    }>;

export interface GdpsV021NaturalLanguageDriverRequest {
  readonly gateRunId: string;
  readonly caseId: GdpsV021DriverCaseId;
  readonly phase: "PRIMARY" | "CURRENTNESS_SEED" | "CURRENTNESS_REPLAY";
  readonly body: JsonObject;
  readonly runtimeVariant: GdpsV021DriverRuntimeVariant;
}

/**
 * The adapter may submit the public request and run the production worker, but
 * it may not return a claimed terminal status, product, stage, or execution.
 * Every such fact is subsequently re-read by the orchestrator from PostgreSQL.
 */
export interface GdpsV021NaturalLanguageDriverExecution {
  readonly groundingId: string;
  readonly requestHash: DriverDigest;
}

export type ExecuteGdpsV021NaturalLanguageDriver = (
  request: GdpsV021NaturalLanguageDriverRequest,
) => Promise<GdpsV021NaturalLanguageDriverExecution>;

export interface GdpsV021CurrentnessBarrierRequest {
  readonly gateRunId: string;
  readonly caseId: "NEG-CURRENTNESS";
  readonly productId: string;
  readonly initialContentHash: DriverDigest;
  readonly sourceGroundingIdHash: DriverDigest;
  readonly sourceResultHash: DriverDigest;
  readonly initialEpochAttestationHash: DriverDigest;
}

export interface GdpsV021CurrentnessBarrierArtifact {
  readonly attestationPath: string;
  readonly attestationHash: DriverDigest;
}

export type CrossGdpsV021CurrentnessBarrier = (
  request: GdpsV021CurrentnessBarrierRequest,
) => Promise<GdpsV021CurrentnessBarrierArtifact>;

export type GdpsV021IsolatedRuntimeState = "UPSTREAM_TRUNCATED" | "INITIAL_A";

export interface GdpsV021IsolatedRuntimePreparationRequest {
  readonly gateRunId: string;
  readonly caseId: "NEG-TRUNCATED" | "NEG-CURRENTNESS";
  readonly targetState: GdpsV021IsolatedRuntimeState;
  readonly runtimeIdentityHash: DriverDigest;
  readonly sharedRuntimeBeforeHash: DriverDigest;
}

export interface GdpsV021IsolatedRuntimePreparationArtifact {
  readonly attestationPath: string;
  readonly attestationHash: DriverDigest;
}

export type PrepareGdpsV021IsolatedRuntime = (
  request: GdpsV021IsolatedRuntimePreparationRequest,
) => Promise<GdpsV021IsolatedRuntimePreparationArtifact>;

export interface GdpsV021DriverOrchestratorInput {
  readonly repositoryRoot: string;
  readonly outputDirectory: string;
  readonly manifestPath: string;
  readonly gateRunId: string;
  readonly sourceCommit: string;
  readonly handoffBundleHash: DriverDigest;
  readonly operationLockHash: DriverDigest;
  readonly provenanceHash: DriverDigest;
  readonly runtimeIdentity: GdpsV021DriverRuntimeIdentity;
  readonly runtimeRecipeLockPath: string;
  readonly runtimeRecipeLockHash: DriverDigest;
  readonly runtimeConsumerSnapshotPath: string;
  readonly runtimeConsumerSnapshotHash: DriverDigest;
  readonly providerRecipeLockPath: string;
  readonly providerRecipeLockHash: DriverDigest;
  readonly sql: GdpsV021DriverSqlClient;
  readonly executeNaturalLanguageCase: ExecuteGdpsV021NaturalLanguageDriver;
  /**
   * Proves that a same-run isolated Gateway/Provider fixture reached the exact
   * requested state. Baseline behavior is never accepted as a substitute.
   */
  readonly prepareIsolatedRuntime?: PrepareGdpsV021IsolatedRuntime;
  /**
   * Advances only an isolated real GDPS fixture from INITIAL_A to CURRENT_B.
   * Absence is a truthful NOT_RUN boundary; the orchestrator never fabricates
   * a stale prior product or mutates the shared Provider/Gateway.
   */
  readonly crossCurrentnessBarrier?: CrossGdpsV021CurrentnessBarrier;
  /** Must sample the same shared 18063 public identity before and after. */
  readonly sampleSharedRuntimeHash: () => Promise<DriverDigest>;
}

export interface GdpsV021DriverArtifactSummary {
  readonly caseId: GdpsV021DriverCaseId;
  readonly driverKind: GdpsV021DriverKind;
  readonly attestationPath: string;
  readonly attestationHash: DriverDigest;
  readonly implementationPath: string;
  readonly implementationHash: DriverDigest;
  readonly evidencePath: string;
  readonly evidenceHash: DriverDigest;
}

export interface GdpsV021DriverOrchestratorResult {
  readonly schemaVersion: "wsgs-gdps-driver-orchestration-result/1.0";
  readonly gateRunId: string;
  readonly runtimeIdentityHash: DriverDigest;
  readonly manifestPath: string;
  readonly manifestHash: DriverDigest;
  readonly drivers: readonly GdpsV021DriverArtifactSummary[];
}

export interface PersistedStageEvidence {
  readonly stage: string;
  readonly status: string;
  readonly inputHash: DriverDigest;
  readonly outputHash: DriverDigest | null;
  readonly recordHash: DriverDigest;
  readonly errorCode: string | null;
  readonly elapsedMs: number;
}

export interface PersistedExecutionEvidence {
  readonly executionKind: string;
  readonly operationKey: string | null;
  readonly requestHash: DriverDigest;
  readonly resultHash: DriverDigest | null;
  readonly normalizedStatus: string;
  readonly upstreamStatus: string;
  readonly gatewayQueryIdHash: DriverDigest | null;
  readonly gatewayJobIdHash: DriverDigest | null;
  readonly dataSnapshot: JsonObject | null;
  readonly computeSnapshot: JsonObject | null;
  readonly snapshotAdherence: JsonObject | null;
  readonly receiptIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface GdpsV021ProviderRecipeBinding {
  readonly providerRecipeId: string;
  readonly providerRecipeLockHash: DriverDigest;
  readonly operationKey: string;
  readonly inputSchemaHash: DriverDigest;
  readonly outputSchemaHash: DriverDigest;
  readonly semanticProfileHash: DriverDigest;
}

export interface PersistedDriverRun {
  readonly groundingIdHash: DriverDigest;
  readonly requestHash: DriverDigest;
  readonly sourceTextHash: DriverDigest;
  readonly requestRowHash: DriverDigest;
  readonly terminalStatus: string;
  readonly jobStatus: string;
  readonly resultHash: DriverDigest;
  readonly resultDocument: JsonObject;
  readonly resultDocumentHash: DriverDigest;
  readonly stageEvidence: readonly PersistedStageEvidence[];
  readonly executionEvidence: readonly PersistedExecutionEvidence[];
  readonly operationKeys: readonly string[];
  readonly planDocuments: readonly JsonObject[];
  readonly planHashes: readonly DriverDigest[];
  readonly operationLockHash: DriverDigest;
  readonly recipeLockHash: DriverDigest | null;
  readonly descriptorLockHash: DriverDigest | null;
  readonly consumerSnapshotHash: DriverDigest | null;
  readonly gdpsSourceEvidence: readonly JsonObject[];
}

export interface GdpsV021DerivedDriverCase {
  readonly caseId: GdpsV021DriverCaseId;
  readonly driverKind: GdpsV021DriverKind;
  readonly implementationPath: string;
  readonly precondition: JsonObject;
  readonly persistedFacts: JsonObject;
}

export class GdpsV021DriverEvidenceError extends Error {
  constructor(readonly code: string) {
    super(`GDPS v0.2.1 driver evidence invalid: ${code}`);
  }
}

export class GdpsV021DriverExternalContractError extends Error {
  constructor(
    readonly caseId: GdpsV021DriverCaseId,
    readonly code: string,
    readonly requiredContract: string,
  ) {
    super(`GDPS_DRIVER_EXTERNAL_CONTRACT_REQUIRED_${caseId}_${code}`);
  }
}
