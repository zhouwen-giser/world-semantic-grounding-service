export type CapabilityMaturity = "PLANNED" | "EXPERIMENTAL" | "PREVIEW" | "STABLE" | "DEPRECATED" | "RETIRED";

export interface CapabilityPort {
  name: string;
  schemaUri: string;
  schemaHash: string;
  valueKind: string;
  unitSemantics: string;
  path?: string;
}

export interface CapabilityDescriptor {
  operationId: string;
  operationVersion: string;
  providerId?: string;
  maturity: CapabilityMaturity;
  inputSchemaHash: string;
  outputSchemaHash: string;
  ports: { inputs: CapabilityPort[]; outputs: CapabilityPort[] };
  [key: string]: unknown;
}

export interface CapabilityCatalog {
  registryVersion: string;
  capabilities: CapabilityDescriptor[];
}

export interface OperationLock {
  operationId: string;
  operationVersion: string;
  providerId: string;
  maturity: "PREVIEW" | "STABLE";
  inputSchemaHash: string;
  outputSchemaHash: string;
}

export interface OptionalOperationLock {
  operationId: string;
  operationVersion: string;
}

export interface CapabilityMismatch {
  operationId: string;
  reason:
    | "NOT_REGISTERED"
    | "VERSION_MISMATCH"
    | "PROVIDER_ID_UNAVAILABLE"
    | "PROVIDER_MISMATCH"
    | "MATURITY_NOT_ALLOWED"
    | "SCHEMA_MISMATCH"
    | "PORTS_MISSING";
  expected?: string;
  actual?: string;
}

export interface CatalogValidation {
  registryVersion: string;
  requiredReady: boolean;
  requiredMismatches: CapabilityMismatch[];
  optionalCapabilities: Array<{ operationId: string; available: boolean; reason?: string }>;
}

export interface GatewayRequestContext {
  signal?: AbortSignal;
  deadlineAt?: Date;
  traceparent?: string;
}

export type GatewayJson = null | boolean | number | string | GatewayJson[] | { [key: string]: GatewayJson };

