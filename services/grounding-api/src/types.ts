import type { GroundingIdentityV2 } from "@wsgs/delegated-identity";
import type { GroundingContractSelection } from "@wsgs/grounding-pipeline";

import type { ContractNegotiationConfig } from "./contract-negotiation.js";

export type GroundingIdentity = GroundingIdentityV2;

export type ApiAuthConfig =
  | {
      mode: "STATIC_TRUSTED";
      identity: GroundingIdentity;
    }
  | {
      mode: "BEARER_PRESENT";
      identity: GroundingIdentity;
    }
  | {
      mode: "JWT_SERVICE";
      key: Uint8Array;
      issuer: string;
      audience: string;
    };

export interface GroundingApiBackend {
  readiness(): Promise<{ ready: boolean; reasons: string[] }>;
  capabilities(identity: GroundingIdentity, contractSelection?: GroundingContractSelection): Promise<unknown>;
  create(
    identity: GroundingIdentity,
    idempotencyKey: string,
    request: Record<string, unknown>,
    preferAsync: boolean,
    contractSelection?: GroundingContractSelection
  ): Promise<{ kind: "RESULT"; value: unknown } | { kind: "JOB"; value: unknown }>;
  get(
    identity: GroundingIdentity,
    groundingId: string,
    contractSelection?: GroundingContractSelection
  ): Promise<unknown | null>;
  cancel(
    identity: GroundingIdentity,
    groundingId: string,
    contractSelection?: GroundingContractSelection
  ): Promise<unknown | null>;
  resolveWorldSelection?(
    identity: GroundingIdentity,
    request: Readonly<Record<string, unknown>>
  ): Promise<unknown>;
  validateSourceCurrentness?(
    identity: GroundingIdentity,
    idempotencyKey: string,
    request: Readonly<Record<string, unknown>>,
    signal?: AbortSignal
  ): Promise<unknown>;
}

export interface GroundingApiConfig {
  auth: ApiAuthConfig;
  backend: GroundingApiBackend;
  schemas: Record<string, unknown>;
  contractNegotiation?: ContractNegotiationConfig;
  bodyLimitBytes?: number;
  logger?: boolean;
  rateBudget?: {
    requests: number;
    windowMs: number;
    maxTrackedKeys?: number;
    now?: () => number;
  };
}
