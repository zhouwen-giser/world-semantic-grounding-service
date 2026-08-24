export interface GroundingIdentity {
  principalId: string;
  actor: string;
  dataScope: string;
  permissions: string[];
}

export type ApiAuthConfig =
  | {
      mode: "STATIC_TRUSTED";
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
  capabilities(identity: GroundingIdentity): Promise<unknown>;
  create(
    identity: GroundingIdentity,
    idempotencyKey: string,
    request: Record<string, unknown>,
    preferAsync: boolean
  ): Promise<{ kind: "RESULT"; value: unknown } | { kind: "JOB"; value: unknown }>;
  get(identity: GroundingIdentity, groundingId: string): Promise<unknown | null>;
  cancel(identity: GroundingIdentity, groundingId: string): Promise<unknown | null>;
}

export interface GroundingApiConfig {
  auth: ApiAuthConfig;
  backend: GroundingApiBackend;
  schemas: Record<string, unknown>;
  bodyLimitBytes?: number;
  logger?: boolean;
}

