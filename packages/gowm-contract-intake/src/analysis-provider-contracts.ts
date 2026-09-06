import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { ANALYSIS_SOURCE_HASH } from "./analysis-source.generated.js";
import type { MapMatchProviderResultV01 } from "./analysis-models/trajectory.js";
import type { TemporalSpatialEventResultV01, SpatialEventTarget } from "./analysis-models/temporal-events.js";
import type { MetricLocationRankingResultV01 } from "./analysis-models/metric-ranking.js";

export type AnalysisDigest = `sha256:${string}`;
export const ANALYSIS_OPERATION_IDS = ["trajectory.map-match", "temporal-spatial.find-events", "spatiotemporal-metric.rank-locations"] as const;
export type AnalysisOperationId = typeof ANALYSIS_OPERATION_IDS[number];
export interface VersionedOperationKey { operationId: string; operationVersion: string }
export interface AnalysisProviderAuthorization extends VersionedOperationKey {
  providerId: string;
  operationVersion: "0.1";
  inputSchemaUri: string;
  inputSchemaHash: AnalysisDigest;
  outputSchemaUri: string;
  outputSchemaHash: AnalysisDigest;
  semanticProfileHash: AnalysisDigest;
  contractSourceCommit: string;
}
export interface AnalysisProviderResultTypes {
  "trajectory.map-match": MapMatchProviderResultV01;
  "temporal-spatial.find-events": TemporalSpatialEventResultV01;
  "spatiotemporal-metric.rank-locations": MetricLocationRankingResultV01;
}
export interface ValidatedAnalysisEnvelope<T> {
  operation: VersionedOperationKey;
  status: string;
  output: { schemaUri: string; schemaHash: AnalysisDigest; value: T };
  execution: { providerId: string; providerVersion: string; resultHash: AnalysisDigest };
  dataSnapshot: Record<string, unknown>;
  computeSnapshot: Record<string, unknown>;
  receipts: Array<{ receiptId: string; operationId: string; operationVersion: string; providerId: string; inputHash: AnalysisDigest; outputHash: AnalysisDigest; computeSnapshotHash: AnalysisDigest }>;
  evidenceReferences: Array<{ evidenceId: string }>;
  warnings: string[];
}

export function analysisCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(analysisCanonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${analysisCanonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function analysisHash(value: unknown): AnalysisDigest {
  return bytesHash(analysisCanonical(value));
}
function bytesHash(value: string | Buffer): AnalysisDigest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
const authorized = new WeakSet<AnalysisProviderAuthorization>();
export function isVerifiedAnalysisAuthorization(value: AnalysisProviderAuthorization): boolean {
  return authorized.has(value);
}
export class AnalysisContractError extends Error {
  constructor(readonly code: "ANALYSIS_PROVIDER_CONTRACT_INVALID" | "ANALYSIS_PROVIDER_CONTRACT_DRIFT" |
    "ANALYSIS_INPUT_SCHEMA_MISMATCH" | "ADVANCED_HISTORY_RESULT_INVALID") { super(code); }
}
function assert(value: unknown, code: ConstructorParameters<typeof AnalysisContractError>[0]): asserts value {
  if (!value) throw new AnalysisContractError(code);
}
interface Source {
  schemaVersion: string; repository: string; branch: string; commit: string; tree: string; capturedAt: string;
  files: Array<{ path: string; sha256: AnalysisDigest }>;
}
interface Manifest {
  provider: { providerId: string; providerVersion: string; implementationDigest: string };
  capabilities: Array<{
    operationId: string; operationVersion: string; maturity: string;
    inputSchemaUri: string; inputSchemaHash: AnalysisDigest;
    outputSchemaUri: string; outputSchemaHash: AnalysisDigest;
    semanticProfile: Record<string, unknown>;
  }>;
}

export class AnalysisProviderContracts {
  readonly source: Source;
  readonly authorizations: readonly AnalysisProviderAuthorization[];
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #envelope: ValidateFunction;
  readonly #target: ValidateFunction;

  constructor(root = fileURLToPath(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url))) {
    try {
      const sourceBytes = readFileSync(join(root, "source.json"));
      assert(bytesHash(sourceBytes) === ANALYSIS_SOURCE_HASH, "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
      this.source = JSON.parse(sourceBytes.toString()) as Source;
      const documents = new Map<string, Record<string, unknown>>();
      for (const entry of this.source.files) {
        assert(/^[\w./-]+$/.test(entry.path) && !entry.path.split("/").includes(".."), "ANALYSIS_PROVIDER_CONTRACT_INVALID");
        const bytes = readFileSync(join(root, entry.path));
        assert(bytesHash(bytes) === entry.sha256, "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
        if (entry.path.endsWith(".json")) documents.set(entry.path, JSON.parse(bytes.toString()) as Record<string, unknown>);
      }
      // GOWM uses legal conditional subschemas without repeating parent types.
      const ajv = new Ajv2020Module.default({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, strictTuples: false });
      addFormatsModule.default(ajv);
      const schemas = [...documents.entries()].filter(([, doc]) => typeof doc["$id"] === "string");
      const uris = new Map(schemas.map(([path, schema]) => [basename(path), String(schema["$id"])]));
      // Upstream's relocated GOWM schemas retain relative references. Resolve them
      // in memory to their original $id; hash verification always uses source bytes.
      const resolveRefs = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(resolveRefs);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, v]) => {
          if (key !== "$ref" || typeof v !== "string" || v.startsWith("#") || v.startsWith("urn:")) return [key, resolveRefs(v)];
          const [path, fragment] = v.split("#");
          const uri = uris.get(basename(path!));
          assert(uri, "ANALYSIS_PROVIDER_CONTRACT_INVALID");
          return [key, uri + (fragment === undefined ? "" : `#${fragment}`)];
        }));
      };
      for (const [, schema] of schemas) {
        assert(ajv.validateSchema(schema), "ANALYSIS_PROVIDER_CONTRACT_INVALID");
        ajv.addSchema(resolveRefs(schema) as Record<string, unknown>);
      }
      const validateManifest = ajv.getSchema("urn:gowm:v0.2:capability-provider-manifest");
      assert(validateManifest, "ANALYSIS_PROVIDER_CONTRACT_INVALID");
      const authorizations: AnalysisProviderAuthorization[] = [];
      for (const [index, name] of ["map-matching", "temporal-events", "metric-ranking"].entries()) {
        const manifest = documents.get(`contracts/manifests/${name}-provider.json`) as unknown as Manifest;
        assert(validateManifest(manifest) && manifest.capabilities.length === 1, "ANALYSIS_PROVIDER_CONTRACT_INVALID");
        const operation = manifest.capabilities[0]!;
        assert(operation.operationId === ANALYSIS_OPERATION_IDS[index] && operation.operationVersion === "0.1" && operation.maturity === "PREVIEW", "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
        const registry = documents.get(`integration/gowm/${name}-provider-registry-entry.json`)!;
        assert(registry["providerId"] === manifest.provider.providerId && registry["providerVersion"] === manifest.provider.providerVersion &&
          registry["implementationDigest"] === manifest.provider.implementationDigest && registry["manifestHash"] === analysisHash(manifest), "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
        const lock = documents.get(`integration/gowm/${name}-provider-schema-lock-fragment.json`)!;
        assert(lock["providerId"] === manifest.provider.providerId && lock["schemaVersion"] === "gowm-canonical-schema-lock/1.0", "ANALYSIS_PROVIDER_CONTRACT_INVALID");
        for (const entry of [...lock["schemas"] as Array<Record<string, string>>, ...lock["supportingSchemas"] as Array<Record<string, string>>]) {
          const schema = documents.get(entry["schemaPath"]!);
          assert(schema && schema["$id"] === entry["schemaUri"] && analysisHash(schema) === entry["schemaHash"], "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
        }
        for (const direction of ["input", "output"] as const) {
          const uri = operation[`${direction}SchemaUri`];
          const expected = operation[`${direction}SchemaHash`];
          const schema = schemas.find(([, doc]) => doc["$id"] === uri)?.[1];
          assert(schema && analysisHash(schema) === expected && (lock["schemas"] as Array<Record<string, string>>)
            .some(entry => entry["schemaUri"] === uri && entry["schemaHash"] === expected), "ANALYSIS_PROVIDER_CONTRACT_DRIFT");
          const validator = ajv.getSchema(uri);
          assert(validator, "ANALYSIS_PROVIDER_CONTRACT_INVALID");
          this.#validators.set(uri, validator);
        }
        const authorization: AnalysisProviderAuthorization = Object.freeze({
          providerId: manifest.provider.providerId, operationId: operation.operationId, operationVersion: "0.1",
          inputSchemaUri: operation.inputSchemaUri, inputSchemaHash: operation.inputSchemaHash,
          outputSchemaUri: operation.outputSchemaUri, outputSchemaHash: operation.outputSchemaHash,
          semanticProfileHash: analysisHash(operation.semanticProfile), contractSourceCommit: this.source.commit
        });
        authorized.add(authorization);
        authorizations.push(authorization);
      }
      this.authorizations = Object.freeze(authorizations);
      const envelope = ajv.getSchema("urn:gowm:v0.2:capability-result-envelope");
      assert(envelope, "ANALYSIS_PROVIDER_CONTRACT_INVALID");
      this.#envelope = envelope;
      this.#target = ajv.compile({ $ref: "urn:gowm:analysis:temporal-events:request:0.1#/$defs/spatialTarget" });
    } catch (error) {
      if (error instanceof AnalysisContractError) throw error;
      throw new AnalysisContractError("ANALYSIS_PROVIDER_CONTRACT_INVALID");
    }
  }

  authorization(operationId: AnalysisOperationId): AnalysisProviderAuthorization {
    return this.authorizations.find(entry => entry.operationId === operationId)!;
  }
  validateInput(operationId: AnalysisOperationId, value: unknown): void {
    const auth = this.authorization(operationId);
    assert(this.#validators.get(auth.inputSchemaUri)!(value), "ANALYSIS_INPUT_SCHEMA_MISMATCH");
  }
  validateTarget(value: unknown): SpatialEventTarget {
    assert(this.#target(value), "ANALYSIS_INPUT_SCHEMA_MISMATCH");
    return structuredClone(value) as SpatialEventTarget;
  }
  validateResult<K extends AnalysisOperationId>(operationId: K, value: unknown): AnalysisProviderResultTypes[K] {
    const auth = this.authorization(operationId);
    assert(this.#validators.get(auth.outputSchemaUri)!(value), "ADVANCED_HISTORY_RESULT_INVALID");
    return value as AnalysisProviderResultTypes[K];
  }
  validateEnvelope<K extends AnalysisOperationId>(operationId: K, value: unknown, expectedInput?: unknown): ValidatedAnalysisEnvelope<AnalysisProviderResultTypes[K]> {
    assert(this.#envelope(value), "ADVANCED_HISTORY_RESULT_INVALID");
    const envelope = value as ValidatedAnalysisEnvelope<AnalysisProviderResultTypes[K]>;
    const auth = this.authorization(operationId);
    assert(envelope.operation.operationId === operationId && envelope.operation.operationVersion === auth.operationVersion &&
      envelope.execution.providerId === auth.providerId && envelope.output?.schemaUri === auth.outputSchemaUri &&
      envelope.output.schemaHash === auth.outputSchemaHash && envelope.dataSnapshot && envelope.receipts.length > 0, "ADVANCED_HISTORY_RESULT_INVALID");
    this.validateResult(operationId, envelope.output.value);
    const computeOperation = envelope.computeSnapshot["operation"] as Record<string, unknown>;
    const computeProvider = envelope.computeSnapshot["provider"] as Record<string, unknown>;
    const computeSchemas = envelope.computeSnapshot["schemas"] as Record<string, unknown>;
    assert(computeOperation?.["operationId"] === operationId && computeOperation["operationVersion"] === auth.operationVersion &&
      computeProvider?.["providerId"] === auth.providerId && computeSchemas?.["inputSchemaHash"] === auth.inputSchemaHash &&
      computeSchemas["outputSchemaHash"] === auth.outputSchemaHash, "ADVANCED_HISTORY_RESULT_INVALID");
    assert(envelope.output.value.status === envelope.status && envelope.execution.resultHash === analysisHash(envelope.output.value), "ADVANCED_HISTORY_RESULT_INVALID");
    for (const receipt of envelope.receipts) assert(receipt.operationId === operationId && receipt.operationVersion === auth.operationVersion &&
      receipt.providerId === auth.providerId && (expectedInput === undefined || receipt.inputHash === analysisHash(expectedInput)) && receipt.outputHash === envelope.execution.resultHash &&
      receipt.computeSnapshotHash === analysisHash(envelope.computeSnapshot), "ADVANCED_HISTORY_RESULT_INVALID");
    return structuredClone(envelope);
  }
}
