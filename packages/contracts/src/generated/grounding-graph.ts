/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */

export interface GroundingGraph {
  schemaVersion: "1.0";
  /**
   * @maxItems 256
   */
  nodes: {
    nodeId: string;
    kind:
      | "MENTION"
      | "KNOWN_REFERENCE"
      | "RESOLVED_REFERENCE"
      | "DERIVED_REFERENCE"
      | "REFERENCE_SET"
      | "SEMANTIC_OPERATION"
      | "WORLD_QUERY"
      | "FINDING"
      | "UNKNOWN";
    payload: {};
  }[];
  /**
   * @maxItems 512
   */
  edges: {
    edgeId: string;
    from: string;
    to: string;
    relation:
      | "RESOLVES_TO"
      | "DERIVED_FROM"
      | "SCOPED_BY"
      | "FILTERS"
      | "RELATES_TO"
      | "OBSERVER_OF"
      | "TARGET_OF"
      | "PRODUCES"
      | "SUPPORTED_BY"
      | "CONTRADICTED_BY";
  }[];
}
