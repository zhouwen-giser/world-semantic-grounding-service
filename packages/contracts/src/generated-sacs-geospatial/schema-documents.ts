/* Generated from authoritative WSGS JSON Schemas. Do not edit directly. */

export interface EmbeddedJsonSchemaDocument {
  readonly name: string;
  readonly schema: Record<string, unknown>;
}

export const sacsGeospatialSchemaDocuments: readonly EmbeddedJsonSchemaDocument[] =
[
  {
    "name": "capabilities-response-v1.1.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:capabilities-response:1.1",
      "title": "WSGS Capabilities Response for Grounding Contract 1.1",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "service",
        "version",
        "contractVersion",
        "supportedOperations",
        "supportedProducts",
        "supportedResultProfiles",
        "geospatialTransportMode",
        "currentness",
        "gowmContract",
        "requiredCapabilitiesReady",
        "optionalCapabilities"
      ],
      "properties": {
        "service": {
          "const": "world-semantic-grounding-service"
        },
        "version": {
          "const": "0.2.1"
        },
        "contractVersion": {
          "const": "sacs-wsgs-grounding/1.1"
        },
        "supportedOperations": {
          "type": "array",
          "minItems": 6,
          "maxItems": 6,
          "uniqueItems": true,
          "items": {
            "enum": [
              "GROUND_REFERENCES",
              "COMPILE_WORLD_QUERY",
              "EXECUTE_WORLD_QUERY",
              "VALIDATE_REFERENCES",
              "RESOLVE_WORLD_SELECTION",
              "VALIDATE_SOURCE_CURRENTNESS"
            ]
          },
          "contains": {
            "enum": [
              "GROUND_REFERENCES",
              "COMPILE_WORLD_QUERY",
              "EXECUTE_WORLD_QUERY",
              "VALIDATE_REFERENCES",
              "RESOLVE_WORLD_SELECTION",
              "VALIDATE_SOURCE_CURRENTNESS"
            ]
          },
          "minContains": 6,
          "maxContains": 6
        },
        "supportedProducts": {
          "type": "array",
          "maxItems": 256,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
          }
        },
        "supportedResultProfiles": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "uniqueItems": true,
          "items": {
            "const": "sacs-wsgs-geospatial-findings/1.0"
          },
          "contains": {
            "const": "sacs-wsgs-geospatial-findings/1.0"
          },
          "minContains": 1,
          "maxContains": 1
        },
        "geospatialTransportMode": {
          "const": "RESULT_EXTENSION"
        },
        "currentness": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mode",
            "operation"
          ],
          "properties": {
            "mode": {
              "const": "DEDICATED_OPERATION"
            },
            "operation": {
              "const": "VALIDATE_SOURCE_CURRENTNESS"
            }
          }
        },
        "gowmContract": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "softwareVersion",
            "gatewayContractVersion",
            "commit",
            "sourcePackageArtifacts",
            "contractCatalogRevision",
            "semanticCatalogHash",
            "operationLockHash"
          ],
          "properties": {
            "softwareVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "gatewayContractVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "commit": {
              "type": "string",
              "pattern": "^[0-9a-f]{40}$"
            },
            "sourcePackageArtifacts": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100000
            },
            "contractCatalogRevision": {
              "$ref": "#/$defs/sha256"
            },
            "semanticCatalogHash": {
              "$ref": "#/$defs/sha256"
            },
            "operationLockHash": {
              "$ref": "#/$defs/sha256"
            }
          }
        },
        "requiredCapabilitiesReady": {
          "type": "boolean"
        },
        "optionalCapabilities": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "operationId",
              "available"
            ],
            "properties": {
              "operationId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:@/-]*$"
              },
              "available": {
                "type": "boolean"
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 4096
              }
            }
          }
        }
      },
      "$defs": {
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        }
      }
    }
  },
  {
    "name": "geospatial-findings.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:geospatial-findings:1.0",
      "title": "SACS Geospatial Findings Profile 1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "profile",
        "profileSchemaHash",
        "findings",
        "sourceProducts",
        "gaps",
        "findingSetHash",
        "sourceProductSetHash"
      ],
      "properties": {
        "profile": {
          "const": "sacs-wsgs-geospatial-findings/1.0"
        },
        "profileSchemaHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "findings": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "$ref": "urn:wsgs:v0.2.1:sacs-geospatial:world-finding:1.0"
          }
        },
        "sourceProducts": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "urn:wsgs:v0.2.1:sacs-geospatial:source-product:1.0"
          }
        },
        "gaps": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "$ref": "urn:wsgs:v0.2.1:sacs-geospatial:typed-gap:1.0"
          }
        },
        "findingSetHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "sourceProductSetHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        }
      }
    }
  },
  {
    "name": "grounding-result-extension.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:grounding-result:1.1",
      "title": "GroundingResult 1.1 with SACS Geospatial Findings",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "requestId",
        "groundingId",
        "status",
        "source",
        "mentions",
        "referenceProducts",
        "evidenceItems",
        "ambiguities",
        "unresolvedMentions",
        "capabilityGaps",
        "warnings",
        "execution",
        "resultHash"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "requestId": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
        },
        "groundingId": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
        },
        "status": {
          "enum": [
            "COMPLETED",
            "PARTIAL",
            "AMBIGUOUS",
            "UNRESOLVED",
            "FAILED",
            "CANCELLED"
          ]
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "messageId",
            "originalTextSha256"
          ],
          "properties": {
            "messageId": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "originalTextSha256": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
            }
          }
        },
        "mentions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "urn:wsgs:v0.1:grounded-mention"
          }
        },
        "semanticFrame": {
          "$ref": "urn:wsgs:v0.1:world-semantic-frame"
        },
        "groundingGraph": {
          "$ref": "urn:wsgs:v0.1:grounding-graph"
        },
        "referenceProducts": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "$ref": "urn:wsgs:v0.1:reference-product"
          }
        },
        "evidenceItems": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "$ref": "urn:wsgs:v0.1:grounding-evidence-item"
          }
        },
        "geospatialFindings": {
          "$ref": "urn:wsgs:v0.2.1:sacs-geospatial:geospatial-findings:1.0"
        },
        "gowmQueries": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "queryId",
              "status",
              "resultHash"
            ],
            "properties": {
              "queryId": {
                "type": "string",
                "maxLength": 256
              },
              "status": {
                "enum": [
                  "COMPLETED",
                  "PARTIAL",
                  "FAILED",
                  "CANCELLED"
                ]
              },
              "resultHash": {
                "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
              }
            }
          }
        },
        "ambiguities": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "urn:wsgs:v0.1:grounding-ambiguity"
          }
        },
        "unresolvedMentions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mentionId",
              "surfaceText",
              "reason"
            ],
            "properties": {
              "mentionId": {
                "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
              },
              "surfaceText": {
                "type": "string",
                "maxLength": 512
              },
              "reason": {
                "type": "string",
                "maxLength": 128
              }
            }
          }
        },
        "capabilityGaps": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "urn:wsgs:v0.1:capability-gap"
          }
        },
        "warnings": {
          "type": "array",
          "maxItems": 256,
          "items": {
            "type": "string",
            "maxLength": 4096
          }
        },
        "execution": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "parserVersion",
            "semanticModelReceiptIds",
            "queryCompilerVersion",
            "normalizerVersion",
            "elapsedMs"
          ],
          "properties": {
            "parserVersion": {
              "type": "string"
            },
            "semanticModelReceiptIds": {
              "type": "array",
              "maxItems": 16,
              "items": {
                "type": "string"
              }
            },
            "queryCompilerVersion": {
              "type": "string"
            },
            "normalizerVersion": {
              "type": "string"
            },
            "elapsedMs": {
              "type": "number",
              "minimum": 0
            }
          }
        },
        "validUntil": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
        },
        "resultHash": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
        },
        "error": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/error"
        }
      }
    }
  },
  {
    "name": "source-currentness-request.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:source-currentness-request:1.0",
      "title": "Validate Source Currentness Request 1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "sourceProductId",
        "productId",
        "previousContentHash"
      ],
      "properties": {
        "schemaVersion": {
          "const": "wsgs-source-currentness-request/1.0"
        },
        "sourceProductId": {
          "$ref": "#/$defs/identifier"
        },
        "productId": {
          "$ref": "#/$defs/identifier"
        },
        "previousContentHash": {
          "$ref": "#/$defs/sha256"
        }
      },
      "$defs": {
        "identifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        }
      }
    }
  },
  {
    "name": "source-currentness-result.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:source-currentness-result:1.0",
      "title": "SACS Source Currentness Result 1.0",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "schemaVersion",
            "productId",
            "previousContentHash",
            "currentContentHash",
            "status",
            "checkedAt",
            "validationGroundingId",
            "validationResultHash"
          ],
          "properties": {
            "schemaVersion": {
              "const": "sacs-source-currentness/1.0"
            },
            "productId": {
              "$ref": "#/$defs/identifier"
            },
            "previousContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "currentContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "status": {
              "const": "CURRENT"
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            },
            "validationGroundingId": {
              "$ref": "#/$defs/identifier"
            },
            "validationResultHash": {
              "$ref": "#/$defs/sha256"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "schemaVersion",
            "productId",
            "previousContentHash",
            "currentContentHash",
            "status",
            "checkedAt",
            "validationGroundingId",
            "validationResultHash"
          ],
          "properties": {
            "schemaVersion": {
              "const": "sacs-source-currentness/1.0"
            },
            "productId": {
              "$ref": "#/$defs/identifier"
            },
            "previousContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "currentContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "status": {
              "const": "CHANGED"
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            },
            "validationGroundingId": {
              "$ref": "#/$defs/identifier"
            },
            "validationResultHash": {
              "$ref": "#/$defs/sha256"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "schemaVersion",
            "productId",
            "previousContentHash",
            "status",
            "checkedAt",
            "validationGroundingId",
            "validationResultHash"
          ],
          "properties": {
            "schemaVersion": {
              "const": "sacs-source-currentness/1.0"
            },
            "productId": {
              "$ref": "#/$defs/identifier"
            },
            "previousContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "status": {
              "const": "NOT_AVAILABLE"
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            },
            "validationGroundingId": {
              "$ref": "#/$defs/identifier"
            },
            "validationResultHash": {
              "$ref": "#/$defs/sha256"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "schemaVersion",
            "productId",
            "previousContentHash",
            "status",
            "checkedAt",
            "validationGroundingId",
            "validationResultHash"
          ],
          "properties": {
            "schemaVersion": {
              "const": "sacs-source-currentness/1.0"
            },
            "productId": {
              "$ref": "#/$defs/identifier"
            },
            "previousContentHash": {
              "$ref": "#/$defs/sha256"
            },
            "status": {
              "const": "UNKNOWN"
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            },
            "validationGroundingId": {
              "$ref": "#/$defs/identifier"
            },
            "validationResultHash": {
              "$ref": "#/$defs/sha256"
            }
          }
        }
      ],
      "$defs": {
        "identifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        }
      }
    }
  },
  {
    "name": "source-product.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:source-product:1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceProductId",
        "authority",
        "productId",
        "productType",
        "productProfile",
        "contentHash",
        "descriptorId",
        "descriptorHash",
        "evidenceItemIds"
      ],
      "properties": {
        "sourceProductId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "authority": {
          "const": "GDPS_CURRENT_PRODUCT"
        },
        "productId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "productType": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "productProfile": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "contentHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "descriptorId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "descriptorHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "dataTime": {
          "type": "string",
          "format": "date-time"
        },
        "qualitySummary": {
          "type": "object",
          "additionalProperties": false,
          "minProperties": 1,
          "properties": {
            "qualityClass": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "valueAccuracyDegree": {
              "type": "number",
              "minimum": 0
            },
            "horizontalAccuracyM": {
              "type": "number",
              "minimum": 0
            },
            "verticalAccuracyM": {
              "type": "number",
              "minimum": 0
            },
            "completenessRatio": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            }
          }
        },
        "evidenceItemIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
          },
          "minItems": 1,
          "maxItems": 128
        }
      }
    }
  },
  {
    "name": "structured-selection-request.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:structured-selection-request:1.0",
      "title": "Resolve World Selection Request 1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "priorGroundingId",
        "priorResultHash",
        "findingId",
        "featureId",
        "selectionRevision",
        "sourceHash"
      ],
      "properties": {
        "schemaVersion": {
          "const": "wsgs-structured-selection-request/1.0"
        },
        "priorGroundingId": {
          "$ref": "#/$defs/identifier"
        },
        "priorResultHash": {
          "$ref": "#/$defs/sha256"
        },
        "findingId": {
          "$ref": "#/$defs/identifier"
        },
        "featureId": {
          "$ref": "#/$defs/identifier"
        },
        "selectionRevision": {
          "type": "integer",
          "minimum": 1
        },
        "sourceHash": {
          "$ref": "#/$defs/sha256"
        }
      },
      "$defs": {
        "identifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        }
      }
    }
  },
  {
    "name": "structured-selection-result.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:structured-selection-result:1.0",
      "title": "Resolve World Selection Result 1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "selectionId",
        "selectionKind",
        "priorGroundingId",
        "priorResultHash",
        "findingId",
        "featureId",
        "selectionRevision",
        "sourceHash",
        "selectedAt",
        "expiresAt"
      ],
      "properties": {
        "schemaVersion": {
          "const": "wsgs-structured-selection-result/1.0"
        },
        "selectionId": {
          "$ref": "#/$defs/identifier"
        },
        "selectionKind": {
          "const": "FINDING_FEATURE"
        },
        "priorGroundingId": {
          "$ref": "#/$defs/identifier"
        },
        "priorResultHash": {
          "$ref": "#/$defs/sha256"
        },
        "findingId": {
          "$ref": "#/$defs/identifier"
        },
        "featureId": {
          "$ref": "#/$defs/identifier"
        },
        "referenceKey": {
          "$ref": "#/$defs/referenceKey"
        },
        "upstreamSelectionToken": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        },
        "selectionRevision": {
          "type": "integer",
          "minimum": 1
        },
        "sourceHash": {
          "$ref": "#/$defs/sha256"
        },
        "selectedAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "oneOf": [
        {
          "properties": {
            "referenceKey": {}
          },
          "required": [
            "referenceKey"
          ],
          "not": {
            "properties": {
              "upstreamSelectionToken": {}
            },
            "required": [
              "upstreamSelectionToken"
            ]
          }
        },
        {
          "properties": {
            "upstreamSelectionToken": {}
          },
          "required": [
            "upstreamSelectionToken"
          ],
          "not": {
            "properties": {
              "referenceKey": {}
            },
            "required": [
              "referenceKey"
            ]
          }
        }
      ],
      "$defs": {
        "identifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "referenceKey": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "namespace",
            "kind",
            "id",
            "version"
          ],
          "properties": {
            "namespace": {
              "const": "gowm"
            },
            "kind": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "id": {
              "type": "string",
              "pattern": "^wrf_[0-9a-f]{32}$"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            }
          }
        }
      }
    }
  },
  {
    "name": "typed-gap.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:typed-gap:1.0",
      "title": "SACS Geospatial Typed Gap 1.0",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "gapId",
        "gapKind",
        "severity",
        "messageCode"
      ],
      "properties": {
        "gapId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "gapKind": {
          "enum": [
            "DATA_GAP",
            "COVERAGE_GAP",
            "CAPABILITY_GAP",
            "REFERENCE_AMBIGUITY",
            "PRODUCT_SELECTION_AMBIGUITY",
            "SOURCE_CHANGED",
            "TRUNCATED",
            "UNSUPPORTED_FINDING_SCHEMA",
            "EVIDENCE_INCOMPLETE",
            "UPSTREAM_FAILURE",
            "CURRENTNESS_UNAVAILABLE"
          ]
        },
        "severity": {
          "enum": [
            "INFO",
            "WARNING",
            "BLOCKING"
          ]
        },
        "messageCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "semanticConcept": {
          "type": "string",
          "maxLength": 128
        },
        "findingIds": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
          }
        },
        "evidenceItemIds": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
          }
        },
        "safeDetail": {
          "type": "string",
          "maxLength": 2000
        }
      }
    }
  },
  {
    "name": "world-finding.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.2.1:sacs-geospatial:world-finding:1.0",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "point",
            "value",
            "unit"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "POINT_MEASUREMENT"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "point": {
              "$ref": "#/$defs/geoJsonPoint"
            },
            "value": {
              "type": "number"
            },
            "unit": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "point",
            "classCode"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "POINT_CLASSIFICATION"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "point": {
              "$ref": "#/$defs/geoJsonPoint"
            },
            "classCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "classLabel": {
              "type": "string",
              "maxLength": 256
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "returnedCount",
            "truncated",
            "features"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "SPATIAL_FEATURE_COLLECTION"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "returnedCount": {
              "type": "integer",
              "minimum": 0
            },
            "truncated": {
              "type": "boolean"
            },
            "features": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/spatialFeature"
              },
              "maxItems": 1000
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "unit",
            "samples",
            "truncated"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "PROFILE"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "unit": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "samples": {
              "type": "array",
              "maxItems": 10000,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "distanceM",
                  "value"
                ],
                "properties": {
                  "distanceM": {
                    "type": "number",
                    "minimum": 0
                  },
                  "value": {
                    "type": "number"
                  },
                  "point": {
                    "$ref": "#/$defs/geoJsonPoint"
                  }
                }
              }
            },
            "truncated": {
              "type": "boolean"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "explanationCode",
            "summary",
            "reasonCodes"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "QUALIFIED_EXPLANATION"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "explanationCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4000
            },
            "reasonCodes": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 128
              },
              "maxItems": 32
            },
            "publishedFacts": {
              "type": "object",
              "additionalProperties": false,
              "minProperties": 1,
              "properties": {
                "slopeDegrees": {
                  "type": "number"
                },
                "landcoverClass": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "classCode": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "classLabel": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "riskClass": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "traversabilityClass": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "findingId",
            "findingKind",
            "semanticConcept",
            "querySemantics",
            "status",
            "evidenceItemIds",
            "sourceProductIds",
            "returnedCount",
            "truncated",
            "items"
          ],
          "properties": {
            "findingId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "findingKind": {
              "const": "CATALOG"
            },
            "semanticConcept": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "querySemantics": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "NO_DATA",
                "INDETERMINATE"
              ]
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "maxItems": 32
            },
            "evidenceItemIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 256
            },
            "sourceProductIds": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
              },
              "minItems": 1,
              "maxItems": 64
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "unknowns": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 2048
              },
              "maxItems": 64
            },
            "returnedCount": {
              "type": "integer",
              "minimum": 0
            },
            "truncated": {
              "type": "boolean"
            },
            "items": {
              "type": "array",
              "maxItems": 256,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "productType"
                ],
                "properties": {
                  "itemId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
                  },
                  "productId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
                  },
                  "productType": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "productProfile": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "displayName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "classCode": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "classLabel": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      ],
      "$defs": {
        "referenceKey": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "namespace",
            "kind",
            "id",
            "version"
          ],
          "properties": {
            "namespace": {
              "const": "gowm"
            },
            "kind": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "id": {
              "type": "string",
              "pattern": "^wrf_[0-9a-f]{32}$"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            }
          }
        },
        "publishedAttributes": {
          "type": "object",
          "additionalProperties": false,
          "minProperties": 1,
          "properties": {
            "objectClass": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "objectType": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "categoryCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "categoryLabel": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            },
            "operationalStatus": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            }
          }
        },
        "spatialFeature": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "featureId"
          ],
          "properties": {
            "featureId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
            },
            "displayName": {
              "type": "string",
              "maxLength": 512
            },
            "referenceKey": {
              "$ref": "#/$defs/referenceKey"
            },
            "geometry": {
              "$ref": "#/$defs/geoJsonGeometry"
            },
            "payloadRef": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1024
            },
            "classCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "classLabel": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            },
            "areaM2": {
              "type": "number",
              "minimum": 0
            },
            "lengthM": {
              "type": "number",
              "minimum": 0
            },
            "distanceM": {
              "type": "number",
              "minimum": 0
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "publishedAttributes": {
              "$ref": "#/$defs/publishedAttributes"
            }
          },
          "not": {
            "allOf": [
              {
                "not": {
                  "required": [
                    "referenceKey"
                  ]
                }
              },
              {
                "not": {
                  "required": [
                    "geometry"
                  ]
                }
              },
              {
                "not": {
                  "required": [
                    "payloadRef"
                  ]
                }
              },
              {
                "not": {
                  "required": [
                    "classCode"
                  ]
                }
              },
              {
                "not": {
                  "required": [
                    "publishedAttributes"
                  ]
                }
              }
            ]
          }
        },
        "position": {
          "type": "array",
          "minItems": 2,
          "maxItems": 3,
          "items": {
            "type": "number"
          }
        },
        "lineStringCoordinates": {
          "type": "array",
          "minItems": 2,
          "maxItems": 10000,
          "items": {
            "$ref": "#/$defs/position"
          }
        },
        "linearRingCoordinates": {
          "type": "array",
          "minItems": 4,
          "maxItems": 10000,
          "items": {
            "$ref": "#/$defs/position"
          }
        },
        "polygonCoordinates": {
          "type": "array",
          "minItems": 1,
          "maxItems": 256,
          "items": {
            "$ref": "#/$defs/linearRingCoordinates"
          }
        },
        "geoJsonGeometry": {
          "oneOf": [
            {
              "$ref": "#/$defs/geoJsonPoint"
            },
            {
              "$ref": "#/$defs/geoJsonMultiPoint"
            },
            {
              "$ref": "#/$defs/geoJsonLineString"
            },
            {
              "$ref": "#/$defs/geoJsonMultiLineString"
            },
            {
              "$ref": "#/$defs/geoJsonPolygon"
            },
            {
              "$ref": "#/$defs/geoJsonMultiPolygon"
            }
          ]
        },
        "geoJsonPoint": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "Point"
            },
            "coordinates": {
              "$ref": "#/$defs/position"
            }
          }
        },
        "geoJsonMultiPoint": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "MultiPoint"
            },
            "coordinates": {
              "type": "array",
              "minItems": 1,
              "maxItems": 10000,
              "items": {
                "$ref": "#/$defs/position"
              }
            }
          }
        },
        "geoJsonLineString": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "LineString"
            },
            "coordinates": {
              "$ref": "#/$defs/lineStringCoordinates"
            }
          }
        },
        "geoJsonMultiLineString": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "MultiLineString"
            },
            "coordinates": {
              "type": "array",
              "minItems": 1,
              "maxItems": 256,
              "items": {
                "$ref": "#/$defs/lineStringCoordinates"
              }
            }
          }
        },
        "geoJsonPolygon": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "Polygon"
            },
            "coordinates": {
              "$ref": "#/$defs/polygonCoordinates"
            }
          }
        },
        "geoJsonMultiPolygon": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "coordinates"
          ],
          "properties": {
            "type": {
              "const": "MultiPolygon"
            },
            "coordinates": {
              "type": "array",
              "minItems": 1,
              "maxItems": 256,
              "items": {
                "$ref": "#/$defs/polygonCoordinates"
              }
            }
          }
        }
      }
    }
  }
];

export const sacsGeospatialDependencySchemaDocuments: readonly EmbeddedJsonSchemaDocument[] =
[
  {
    "name": "capabilities-response.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:capabilities-response",
      "title": "WSGSCapabilitiesResponse",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "service",
        "version",
        "contractVersion",
        "supportedOperations",
        "supportedProducts",
        "gowmContract",
        "requiredCapabilitiesReady",
        "optionalCapabilities"
      ],
      "properties": {
        "service": {
          "const": "world-semantic-grounding-service"
        },
        "version": {
          "const": "0.1.0"
        },
        "contractVersion": {
          "const": "sacs-wsgs-grounding/1.0"
        },
        "supportedOperations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "supportedProducts": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "gowmContract": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "softwareVersion",
            "commit",
            "sourcePackageArtifacts"
          ],
          "properties": {
            "softwareVersion": {
              "const": "0.4.0"
            },
            "commit": {
              "const": "db575f79c874a69f65a2043a7e463338524b713d"
            },
            "sourcePackageArtifacts": {
              "const": 33
            }
          }
        },
        "requiredCapabilitiesReady": {
          "type": "boolean"
        },
        "optionalCapabilities": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "operationId",
              "available"
            ],
            "properties": {
              "operationId": {
                "type": "string"
              },
              "available": {
                "type": "boolean"
              },
              "reason": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  },
  {
    "name": "capability-gap.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:capability-gap",
      "title": "CapabilityGap",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "gapId",
        "semanticCapability",
        "reason",
        "requiredForProduct",
        "blocking"
      ],
      "properties": {
        "gapId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "semanticCapability": {
          "type": "string",
          "maxLength": 128
        },
        "reason": {
          "enum": [
            "NOT_REGISTERED",
            "MATURITY_NOT_ALLOWED",
            "SCHEMA_MISMATCH",
            "PROVIDER_UNAVAILABLE",
            "UNSUPPORTED_EXPRESSION",
            "BUDGET_EXCEEDED"
          ]
        },
        "requiredForProduct": {
          "type": "string",
          "maxLength": 128
        },
        "blocking": {
          "type": "boolean"
        },
        "details": {
          "type": "object"
        }
      }
    }
  },
  {
    "name": "common.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:common",
      "$defs": {
        "identifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "dateTime": {
          "type": "string",
          "format": "date-time"
        },
        "textSpan": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "encoding",
            "start",
            "end"
          ],
          "properties": {
            "encoding": {
              "const": "UTF16_CODE_UNIT"
            },
            "start": {
              "type": "integer",
              "minimum": 0
            },
            "end": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "referenceKey": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "namespace",
            "kind",
            "id",
            "version"
          ],
          "properties": {
            "namespace": {
              "const": "gowm"
            },
            "kind": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "id": {
              "type": "string",
              "pattern": "^wrf_[0-9a-f]{32}$"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            }
          }
        },
        "error": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "message",
            "retryable",
            "stage"
          ],
          "properties": {
            "code": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "message": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4096
            },
            "retryable": {
              "type": "boolean"
            },
            "stage": {
              "enum": [
                "REQUEST_VALIDATION",
                "CONTEXT_LOADING",
                "DETERMINISTIC_PARSING",
                "SEMANTIC_MODEL",
                "SEMANTIC_MERGE",
                "REFERENCE_GROUNDING",
                "QUERY_COMPILATION",
                "GOWM_EXECUTION",
                "RESULT_NORMALIZATION",
                "PERSISTENCE"
              ]
            },
            "details": {
              "type": "object"
            }
          }
        }
      }
    }
  },
  {
    "name": "external-correlation-hint.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:external-correlation-hint",
      "title": "ExternalCorrelationHint",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "hintId",
        "externalAuthority",
        "kind",
        "value"
      ],
      "properties": {
        "hintId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "externalAuthority": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "kind": {
          "enum": [
            "EXECUTION_INTENT",
            "OPERATION_CORRELATION",
            "EXTERNAL_TASK",
            "EXTERNAL_STEP",
            "EXTERNAL_COMMAND"
          ]
        },
        "value": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "relationHint": {
          "enum": [
            "REPORTS_EXECUTION_OF",
            "REALIZES",
            "RELATED_TO"
          ]
        },
        "declarationConfidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      }
    }
  },
  {
    "name": "external-predicate-capsule.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:external-predicate-capsule",
      "title": "ExternalPredicateCapsule",
      "description": "Opaque, schema-locked GOWM external predicate input.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaUri",
        "schemaHash",
        "value"
      ],
      "properties": {
        "schemaUri": {
          "const": "urn:gowm:v0.4:external-predicate"
        },
        "schemaHash": {
          "$ref": "common.schema.json#/$defs/sha256"
        },
        "value": {
          "type": "object"
        }
      }
    }
  },
  {
    "name": "grounded-mention.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounded-mention",
      "title": "GroundedMention",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mentionId",
        "surfaceText",
        "span",
        "extractionSources",
        "status",
        "candidateProductIds"
      ],
      "properties": {
        "mentionId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "surfaceText": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "span": {
          "$ref": "common.schema.json#/$defs/textSpan"
        },
        "expectedKinds": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "string",
            "maxLength": 128
          }
        },
        "semanticRole": {
          "type": "string",
          "maxLength": 64
        },
        "extractionSources": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "enum": [
              "CLIENT_HINT",
              "CLIENT_MAP",
              "KNOWN_REFERENCE",
              "DETERMINISTIC",
              "DOMAIN_MODEL"
            ]
          }
        },
        "status": {
          "enum": [
            "RESOLVED_EXACT",
            "SUGGESTED_UNIQUE",
            "AMBIGUOUS",
            "UNRESOLVED",
            "INVALID"
          ]
        },
        "candidateProductIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/identifier"
          }
        }
      }
    }
  },
  {
    "name": "grounding-ambiguity.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-ambiguity",
      "title": "GroundingAmbiguity",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ambiguityId",
        "mentionId",
        "surfaceText",
        "candidateProductIds",
        "reason"
      ],
      "properties": {
        "ambiguityId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "mentionId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "surfaceText": {
          "type": "string",
          "maxLength": 512
        },
        "candidateProductIds": {
          "type": "array",
          "minItems": 2,
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/identifier"
          }
        },
        "reason": {
          "enum": [
            "MULTIPLE_EXACT_MATCHES",
            "MULTIPLE_PLAUSIBLE_MATCHES",
            "NAMESPACE_CONFLICT",
            "CONTEXT_CONFLICT",
            "MAP_TEXT_CONFLICT"
          ]
        }
      }
    }
  },
  {
    "name": "grounding-context-capsule.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-context-capsule",
      "title": "GroundingContextCapsule",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "knownWorldReferences",
        "priorGroundings",
        "mapSelections",
        "externalCorrelationHints",
        "externalPredicates"
      ],
      "properties": {
        "knownWorldReferences": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "known-world-reference.schema.json"
          }
        },
        "priorGroundings": {
          "type": "array",
          "maxItems": 16,
          "items": {
            "$ref": "prior-grounding-reference.schema.json"
          }
        },
        "mapSelections": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "map-selection.schema.json"
          }
        },
        "externalCorrelationHints": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "external-correlation-hint.schema.json"
          }
        },
        "externalPredicates": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "external-predicate-capsule.schema.json"
          }
        }
      }
    }
  },
  {
    "name": "grounding-evidence-item.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-evidence-item",
      "title": "GroundingEvidenceItem",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "evidenceProductId",
        "productKind",
        "authority",
        "sourceOperation",
        "upstreamStatus",
        "payloadSchemaUri",
        "payloadSchemaHash",
        "receiptIds",
        "evidenceIds",
        "unknowns",
        "warnings"
      ],
      "properties": {
        "evidenceProductId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "productKind": {
          "enum": [
            "WORLD_FACT",
            "WORLD_GEOMETRY",
            "PROVENANCE",
            "EVENT_TIMELINE",
            "OPERATIONAL_TASK",
            "CORRELATION_FINDING",
            "PREDICATE_EVALUATION",
            "OBSERVABILITY_ASSESSMENT",
            "CAPABILITY_RESULT"
          ]
        },
        "authority": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "sourceOperation": {
          "type": "string",
          "maxLength": 128
        },
        "sourceProvider": {
          "type": "string",
          "maxLength": 128
        },
        "sourceQueryId": {
          "type": "string",
          "maxLength": 256
        },
        "sourceNodeId": {
          "type": "string",
          "maxLength": 64
        },
        "upstreamStatus": {
          "enum": [
            "COMPLETED",
            "PARTIAL",
            "NO_DATA",
            "INDETERMINATE"
          ]
        },
        "payloadSchemaUri": {
          "type": "string",
          "maxLength": 512
        },
        "payloadSchemaHash": {
          "$ref": "common.schema.json#/$defs/sha256"
        },
        "safePayload": {},
        "payloadRef": {
          "type": "string",
          "maxLength": 1024
        },
        "dataSnapshot": {
          "type": "object"
        },
        "computeSnapshot": {
          "type": "object"
        },
        "receiptIds": {
          "type": "array",
          "maxItems": 256,
          "items": {
            "type": "string",
            "maxLength": 256
          }
        },
        "evidenceIds": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "type": "string",
            "maxLength": 256
          }
        },
        "unknowns": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "type": "string",
            "maxLength": 4096
          }
        },
        "warnings": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "type": "string",
            "maxLength": 4096
          }
        }
      }
    }
  },
  {
    "name": "grounding-graph.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-graph",
      "title": "GroundingGraph",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "nodes",
        "edges"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "nodes": {
          "type": "array",
          "maxItems": 256,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "nodeId",
              "kind",
              "payload"
            ],
            "properties": {
              "nodeId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "kind": {
                "enum": [
                  "MENTION",
                  "KNOWN_REFERENCE",
                  "RESOLVED_REFERENCE",
                  "DERIVED_REFERENCE",
                  "REFERENCE_SET",
                  "SEMANTIC_OPERATION",
                  "WORLD_QUERY",
                  "FINDING",
                  "UNKNOWN"
                ]
              },
              "payload": {
                "type": "object"
              }
            }
          }
        },
        "edges": {
          "type": "array",
          "maxItems": 512,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "edgeId",
              "from",
              "to",
              "relation"
            ],
            "properties": {
              "edgeId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "from": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "to": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "relation": {
                "enum": [
                  "RESOLVES_TO",
                  "DERIVED_FROM",
                  "SCOPED_BY",
                  "FILTERS",
                  "RELATES_TO",
                  "OBSERVER_OF",
                  "TARGET_OF",
                  "PRODUCES",
                  "SUPPORTED_BY",
                  "CONTRADICTED_BY"
                ]
              }
            }
          }
        }
      }
    }
  },
  {
    "name": "grounding-job.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-job",
      "title": "GroundingJob",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "jobId",
        "groundingId",
        "requestId",
        "status",
        "createdAt",
        "updatedAt"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "jobId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "groundingId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "status": {
          "enum": [
            "ACCEPTED",
            "RUNNING",
            "COMPLETED",
            "PARTIAL",
            "AMBIGUOUS",
            "UNRESOLVED",
            "FAILED",
            "CANCELLED"
          ]
        },
        "createdAt": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "updatedAt": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "startedAt": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "finishedAt": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "result": {
          "$ref": "grounding-result.schema.json"
        },
        "error": {
          "$ref": "common.schema.json#/$defs/error"
        }
      }
    }
  },
  {
    "name": "grounding-request.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-request",
      "title": "GroundingRequest",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "requestId",
        "operation",
        "source",
        "requestedProducts",
        "contextCapsule",
        "executionPolicy"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "operation": {
          "enum": [
            "GROUND_REFERENCES",
            "COMPILE_WORLD_QUERY",
            "EXECUTE_WORLD_QUERY",
            "VALIDATE_REFERENCES"
          ]
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "conversationRef",
            "messageId",
            "originalText",
            "originalTextSha256",
            "locale",
            "createdAt"
          ],
          "properties": {
            "conversationRef": {
              "$ref": "common.schema.json#/$defs/identifier"
            },
            "messageId": {
              "$ref": "common.schema.json#/$defs/identifier"
            },
            "originalText": {
              "type": "string",
              "minLength": 1,
              "maxLength": 32768
            },
            "originalTextSha256": {
              "$ref": "common.schema.json#/$defs/sha256"
            },
            "locale": {
              "type": "string",
              "minLength": 2,
              "maxLength": 32
            },
            "createdAt": {
              "$ref": "common.schema.json#/$defs/dateTime"
            },
            "focusSpans": {
              "type": "array",
              "maxItems": 32,
              "items": {
                "$ref": "common.schema.json#/$defs/textSpan"
              }
            }
          }
        },
        "requestedProducts": {
          "type": "array",
          "minItems": 1,
          "maxItems": 16,
          "uniqueItems": true,
          "items": {
            "enum": [
              "MENTIONS",
              "RESOLVED_REFERENCES",
              "DERIVED_REFERENCES",
              "REFERENCE_SETS",
              "GROUNDING_GRAPH",
              "WORLD_QUERY",
              "WORLD_EVIDENCE",
              "OPERATIONAL_TASKS",
              "EVENT_TIMELINES",
              "CORRELATION_FINDINGS",
              "PREDICATE_EVALUATIONS"
            ]
          }
        },
        "contextCapsule": {
          "$ref": "grounding-context-capsule.schema.json"
        },
        "hints": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "mentionHints": {
              "type": "array",
              "maxItems": 32,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "surfaceText"
                ],
                "properties": {
                  "surfaceText": {
                    "type": "string",
                    "maxLength": 512
                  },
                  "span": {
                    "$ref": "common.schema.json#/$defs/textSpan"
                  },
                  "expectedKinds": {
                    "type": "array",
                    "maxItems": 32,
                    "items": {
                      "type": "string",
                      "maxLength": 128
                    }
                  },
                  "semanticRole": {
                    "type": "string",
                    "maxLength": 64
                  }
                }
              }
            }
          }
        },
        "executionPolicy": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "readOnly",
            "deadlineMs",
            "maxQueryOperations",
            "maxCandidatesPerMention",
            "maxResultBytes",
            "allowApproximation"
          ],
          "properties": {
            "readOnly": {
              "const": true
            },
            "deadlineMs": {
              "type": "integer",
              "minimum": 100,
              "maximum": 120000
            },
            "maxQueryOperations": {
              "type": "integer",
              "minimum": 1,
              "maximum": 64
            },
            "maxCandidatesPerMention": {
              "type": "integer",
              "minimum": 1,
              "maximum": 20
            },
            "maxResultBytes": {
              "type": "integer",
              "minimum": 1024,
              "maximum": 67108864
            },
            "allowApproximation": {
              "type": "boolean"
            }
          }
        }
      }
    }
  },
  {
    "name": "grounding-result.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:grounding-result",
      "title": "GroundingResult",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "requestId",
        "groundingId",
        "status",
        "source",
        "mentions",
        "referenceProducts",
        "evidenceItems",
        "ambiguities",
        "unresolvedMentions",
        "capabilityGaps",
        "warnings",
        "execution",
        "resultHash"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "groundingId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "status": {
          "enum": [
            "COMPLETED",
            "PARTIAL",
            "AMBIGUOUS",
            "UNRESOLVED",
            "FAILED",
            "CANCELLED"
          ]
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "messageId",
            "originalTextSha256"
          ],
          "properties": {
            "messageId": {
              "$ref": "common.schema.json#/$defs/identifier"
            },
            "originalTextSha256": {
              "$ref": "common.schema.json#/$defs/sha256"
            }
          }
        },
        "mentions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "grounded-mention.schema.json"
          }
        },
        "semanticFrame": {
          "$ref": "world-semantic-frame.schema.json"
        },
        "groundingGraph": {
          "$ref": "grounding-graph.schema.json"
        },
        "referenceProducts": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "$ref": "reference-product.schema.json"
          }
        },
        "evidenceItems": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "$ref": "grounding-evidence-item.schema.json"
          }
        },
        "gowmQueries": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "queryId",
              "status",
              "resultHash"
            ],
            "properties": {
              "queryId": {
                "type": "string",
                "maxLength": 256
              },
              "status": {
                "enum": [
                  "COMPLETED",
                  "PARTIAL",
                  "FAILED",
                  "CANCELLED"
                ]
              },
              "resultHash": {
                "$ref": "common.schema.json#/$defs/sha256"
              }
            }
          }
        },
        "ambiguities": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "$ref": "grounding-ambiguity.schema.json"
          }
        },
        "unresolvedMentions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mentionId",
              "surfaceText",
              "reason"
            ],
            "properties": {
              "mentionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "surfaceText": {
                "type": "string",
                "maxLength": 512
              },
              "reason": {
                "type": "string",
                "maxLength": 128
              }
            }
          }
        },
        "capabilityGaps": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "capability-gap.schema.json"
          }
        },
        "warnings": {
          "type": "array",
          "maxItems": 256,
          "items": {
            "type": "string",
            "maxLength": 4096
          }
        },
        "execution": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "parserVersion",
            "semanticModelReceiptIds",
            "queryCompilerVersion",
            "normalizerVersion",
            "elapsedMs"
          ],
          "properties": {
            "parserVersion": {
              "type": "string"
            },
            "semanticModelReceiptIds": {
              "type": "array",
              "maxItems": 16,
              "items": {
                "type": "string"
              }
            },
            "queryCompilerVersion": {
              "type": "string"
            },
            "normalizerVersion": {
              "type": "string"
            },
            "elapsedMs": {
              "type": "number",
              "minimum": 0
            }
          }
        },
        "validUntil": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "resultHash": {
          "$ref": "common.schema.json#/$defs/sha256"
        },
        "error": {
          "$ref": "common.schema.json#/$defs/error"
        }
      }
    }
  },
  {
    "name": "known-world-reference.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:known-world-reference",
      "title": "KnownWorldReference",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "referenceKey",
        "referenceType",
        "sourceMessageId"
      ],
      "properties": {
        "alias": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "referenceKey": {
          "$ref": "common.schema.json#/$defs/referenceKey"
        },
        "referenceType": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "sourceMessageId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "sourceGroundingId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "validUntil": {
          "$ref": "common.schema.json#/$defs/dateTime"
        }
      }
    }
  },
  {
    "name": "map-selection.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:map-selection",
      "title": "MapSelection",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "selectionId",
        "kind",
        "revision"
      ],
      "properties": {
        "selectionId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "label": {
          "type": "string",
          "maxLength": 512
        },
        "kind": {
          "enum": [
            "POINT",
            "LINE",
            "AREA",
            "FEATURE",
            "ANNOTATION"
          ]
        },
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "referenceKey": {
          "$ref": "common.schema.json#/$defs/referenceKey"
        },
        "geometry": {
          "type": "object",
          "maxProperties": 16
        },
        "geometryHash": {
          "$ref": "common.schema.json#/$defs/sha256"
        }
      }
    }
  },
  {
    "name": "prior-grounding-reference.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:prior-grounding-reference",
      "title": "PriorGroundingReference",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "groundingId",
        "resultHash"
      ],
      "properties": {
        "groundingId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "resultHash": {
          "$ref": "common.schema.json#/$defs/sha256"
        },
        "selectedProductIds": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "$ref": "common.schema.json#/$defs/identifier"
          }
        }
      }
    }
  },
  {
    "name": "protocol-error.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:protocol-error",
      "title": "WSGSProtocolError",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "requestId",
        "error"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "error": {
          "$ref": "common.schema.json#/$defs/error"
        }
      }
    }
  },
  {
    "name": "reference-product.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:reference-product",
      "title": "ReferenceProduct",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "productId",
        "productKind",
        "referenceKey",
        "referenceType",
        "displayName",
        "sourceOperation",
        "sourceWorldVersion"
      ],
      "properties": {
        "productId": {
          "$ref": "common.schema.json#/$defs/identifier"
        },
        "productKind": {
          "enum": [
            "RESOLVED_REFERENCE",
            "DERIVED_REFERENCE",
            "REFERENCE_SET",
            "QUERY_RESULT"
          ]
        },
        "referenceKey": {
          "$ref": "common.schema.json#/$defs/referenceKey"
        },
        "referenceType": {
          "type": "string",
          "maxLength": 128
        },
        "displayName": {
          "type": "string",
          "maxLength": 512
        },
        "matchedBy": {
          "type": "string",
          "maxLength": 64
        },
        "matchScore": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "stateConfidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "sourceOperation": {
          "type": "string",
          "maxLength": 128
        },
        "sourceWorldVersion": {
          "type": "integer",
          "minimum": 0
        },
        "validUntil": {
          "$ref": "common.schema.json#/$defs/dateTime"
        },
        "revalidationRequired": {
          "type": "boolean"
        },
        "safeSummary": {
          "type": "object"
        }
      }
    }
  },
  {
    "name": "world-semantic-frame.schema.json",
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "urn:wsgs:v0.1:world-semantic-frame",
      "title": "WorldSemanticFrame",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "mentions",
        "spatialExpressions",
        "relationExpressions",
        "temporalConstraints",
        "aggregationExpressions",
        "rankingExpressions"
      ],
      "properties": {
        "schemaVersion": {
          "const": "1.0"
        },
        "mentions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mentionId",
              "surfaceText",
              "span"
            ],
            "properties": {
              "mentionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "surfaceText": {
                "type": "string",
                "maxLength": 512
              },
              "span": {
                "$ref": "common.schema.json#/$defs/textSpan"
              },
              "expectedKinds": {
                "type": "array",
                "maxItems": 32,
                "items": {
                  "type": "string",
                  "maxLength": 128
                }
              },
              "semanticRole": {
                "type": "string",
                "maxLength": 64
              },
              "anchorMentionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              }
            }
          }
        },
        "spatialExpressions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "expressionId",
              "operator",
              "arguments"
            ],
            "properties": {
              "expressionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "operator": {
                "enum": [
                  "NEAR",
                  "WITHIN",
                  "CONTAINS",
                  "INTERSECTS",
                  "ALONG",
                  "BUFFER",
                  "NORTH_OF",
                  "SOUTH_OF",
                  "EAST_OF",
                  "WEST_OF"
                ]
              },
              "arguments": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                  "$ref": "common.schema.json#/$defs/identifier"
                }
              },
              "distanceM": {
                "type": "number",
                "exclusiveMinimum": 0
              },
              "approximate": {
                "type": "boolean"
              }
            }
          }
        },
        "relationExpressions": {
          "type": "array",
          "maxItems": 32,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "expressionId",
              "relationType",
              "subjectMentionId"
            ],
            "properties": {
              "expressionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "relationType": {
                "type": "string",
                "maxLength": 128
              },
              "subjectMentionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "objectMentionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              }
            }
          }
        },
        "temporalConstraints": {
          "type": "array",
          "maxItems": 16,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "constraintId"
            ],
            "properties": {
              "constraintId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "from": {
                "$ref": "common.schema.json#/$defs/dateTime"
              },
              "to": {
                "$ref": "common.schema.json#/$defs/dateTime"
              },
              "relativeExpression": {
                "type": "string",
                "maxLength": 128
              }
            }
          }
        },
        "aggregationExpressions": {
          "type": "array",
          "maxItems": 16,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "expressionId",
              "operator"
            ],
            "properties": {
              "expressionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "operator": {
                "enum": [
                  "COUNT",
                  "GROUP",
                  "SUMMARIZE",
                  "COMPARE"
                ]
              },
              "targetExpressionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              }
            }
          }
        },
        "rankingExpressions": {
          "type": "array",
          "maxItems": 16,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "expressionId",
              "direction"
            ],
            "properties": {
              "expressionId": {
                "$ref": "common.schema.json#/$defs/identifier"
              },
              "metric": {
                "type": "string",
                "maxLength": 128
              },
              "direction": {
                "enum": [
                  "ASC",
                  "DESC"
                ]
              },
              "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100
              }
            }
          }
        }
      }
    }
  }
];
