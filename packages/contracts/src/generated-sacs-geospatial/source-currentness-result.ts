/* Generated from the authoritative WSGS v0.2.1 SACS geospatial JSON Schemas. Do not edit directly. */

export type SACSSourceCurrentnessResult10 =
  | {
      schemaVersion: "sacs-source-currentness/1.0";
      productId: Identifier;
      previousContentHash: Sha256;
      currentContentHash: Sha256;
      status: "CURRENT";
      checkedAt: string;
      validationGroundingId: Identifier;
      validationResultHash: Sha256;
    }
  | {
      schemaVersion: "sacs-source-currentness/1.0";
      productId: Identifier;
      previousContentHash: Sha256;
      currentContentHash: Sha256;
      status: "CHANGED";
      checkedAt: string;
      validationGroundingId: Identifier;
      validationResultHash: Sha256;
    }
  | {
      schemaVersion: "sacs-source-currentness/1.0";
      productId: Identifier;
      previousContentHash: Sha256;
      status: "NOT_AVAILABLE";
      checkedAt: string;
      validationGroundingId: Identifier;
      validationResultHash: Sha256;
    }
  | {
      schemaVersion: "sacs-source-currentness/1.0";
      productId: Identifier;
      previousContentHash: Sha256;
      status: "UNKNOWN";
      checkedAt: string;
      validationGroundingId: Identifier;
      validationResultHash: Sha256;
    };
export type Identifier = string;
export type Sha256 = string;
