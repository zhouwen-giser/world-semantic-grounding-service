/* Generated from the frozen WSGS JSON Schemas. Do not edit directly. */

export interface WorldSemanticFrame {
  schemaVersion: "1.0";
  /**
   * @maxItems 32
   */
  mentions: {
    mentionId: string;
    surfaceText: string;
    span: TextSpan;
    /**
     * @maxItems 32
     */
    expectedKinds?: string[];
    semanticRole?: string;
    anchorMentionId?: string;
  }[];
  /**
   * @maxItems 32
   */
  spatialExpressions: {
    expressionId: string;
    operator:
      | "NEAR"
      | "WITHIN"
      | "CONTAINS"
      | "INTERSECTS"
      | "ALONG"
      | "BUFFER"
      | "NORTH_OF"
      | "SOUTH_OF"
      | "EAST_OF"
      | "WEST_OF";
    /**
     * @minItems 1
     * @maxItems 4
     */
    arguments: string[];
    distanceM?: number;
    approximate?: boolean;
  }[];
  /**
   * @maxItems 32
   */
  relationExpressions: {
    expressionId: string;
    relationType: string;
    subjectMentionId: string;
    objectMentionId?: string;
  }[];
  /**
   * @maxItems 16
   */
  temporalConstraints: {
    constraintId: string;
    from?: string;
    to?: string;
    relativeExpression?: string;
  }[];
  /**
   * @maxItems 16
   */
  aggregationExpressions: {
    expressionId: string;
    operator: "COUNT" | "GROUP" | "SUMMARIZE" | "COMPARE";
    targetExpressionId?: string;
  }[];
  /**
   * @maxItems 16
   */
  rankingExpressions: {
    expressionId: string;
    metric?: string;
    direction: "ASC" | "DESC";
    limit?: number;
  }[];
}
export interface TextSpan {
  encoding: "UTF16_CODE_UNIT";
  start: number;
  end: number;
}
