/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface DelegatedGowmRequestContext {
  servicePrincipalId: string;
  actorId: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  dataScopes: string[];
  /**
   * @maxItems 32
   */
  datasetScopes: string[];
  /**
   * @minItems 1
   * @maxItems 64
   */
  allowedOperations: string[];
  authorizationContextHash: string;
  requestId: string;
}
