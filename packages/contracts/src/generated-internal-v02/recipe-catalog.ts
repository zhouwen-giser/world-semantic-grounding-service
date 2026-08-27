/* Generated from the locked WSGS v0.2 internal JSON Schemas. Do not edit directly. */

export interface RecipeCatalog {
  schemaVersion: "1.0";
  /**
   * @minItems 1
   */
  recipes: {
    recipeId: string;
    maturity: "STABLE" | "PREVIEW";
    /**
     * @minItems 1
     */
    requirements: string[];
    /**
     * @minItems 1
     */
    requestedProducts: string[];
    defaultSnapshotPolicy: "LATEST_AT_START" | "PINNED" | "BEST_EFFORT";
    allowApproximation: boolean;
    notes?: string[];
  }[];
}
