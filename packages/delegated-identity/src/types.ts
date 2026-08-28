export interface GroundingIdentityV2 {
  servicePrincipalId: string;
  actorId: string;
  dataScopes: string[];
  datasetScopes: string[];
  permissions: string[];
  authorizationContextHash: string;
}

interface DelegationRequestBase {
  identity: GroundingIdentityV2;
  requestId: string;
  dataScopes?: string[];
  datasetScopes?: string[];
  ttlSeconds?: number;
}

export type DelegationRequest =
  | (DelegationRequestBase & {
      kind: "DIRECT_OPERATION";
      operation: { operationId: string; operationVersion: string };
    })
  | (DelegationRequestBase & {
      kind: "WORLD_QUERY";
      plan: unknown;
    });

export interface SignedDelegation {
  token: string;
  jtiHash: string;
  authorizationContextHash: string;
  allowedOperations: string[];
  dataScopes: string[];
  datasetScopes: string[];
  issuedAt: number;
  expiresAt: number;
}

export interface DelegationSignerConfig {
  issuer: string;
  audience: string;
  servicePrincipalId: string;
  privateKeyPkcs8: string;
  trustedOperationKeys: readonly string[];
  maximumTtlSeconds?: number;
  defaultTtlSeconds?: number;
  now?: () => number;
  newJti?: () => string;
}
