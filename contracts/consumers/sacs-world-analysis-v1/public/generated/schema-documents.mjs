// Generated from locked public schemas. Do not edit.
export const schemaDocuments = [
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:action-target-candidate",
    "title": "Action Target Candidate",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "findingId",
      "findingKind",
      "semanticConcept",
      "status",
      "subjectReferenceProductIds",
      "evidenceIds",
      "unknowns",
      "warnings",
      "display",
      "actionKind",
      "sourceKind",
      "target",
      "crs",
      "axisOrder",
      "sourceFindingId",
      "sourceCandidateId",
      "sourceRank",
      "representativeObservedAt",
      "representativeMeasurementId",
      "requirements",
      "executionAuthorized"
    ],
    "properties": {
      "findingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "findingKind": {
        "const": "ACTION_TARGET_CANDIDATE"
      },
      "semanticConcept": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
      },
      "status": {
        "enum": [
          "COMPLETED",
          "PARTIAL"
        ]
      },
      "subjectReferenceProductIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "unknowns": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "warnings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "display": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/display"
      },
      "validUntil": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "actionKind": {
        "const": "MOVE_TO_LOCATION"
      },
      "sourceKind": {
        "const": "HISTORICAL_METRIC_CANDIDATE"
      },
      "target": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
      },
      "crs": {
        "const": "EPSG:4326"
      },
      "axisOrder": {
        "const": "LONGITUDE_LATITUDE"
      },
      "sourceFindingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "sourceCandidateId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "sourceRank": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "representativeObservedAt": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "representativeMeasurementId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
      },
      "requirements": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "currentValidationRequired",
          "routePlanningRequired",
          "executionConfirmationRequired"
        ],
        "properties": {
          "currentValidationRequired": {
            "const": true
          },
          "routePlanningRequired": {
            "const": true
          },
          "executionConfirmationRequired": {
            "const": true
          }
        }
      },
      "executionAuthorized": {
        "const": false
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [],
          "properties": {
            "evidenceIds": {
              "type": "array",
              "minItems": 1
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:analysis-selection",
    "title": "Analysis Selection",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "priorGroundingId",
      "priorResultHash",
      "findingSetHash",
      "choiceId",
      "candidateId"
    ],
    "properties": {
      "priorGroundingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "priorResultHash": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
      },
      "findingSetHash": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
      },
      "choiceId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "candidateId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      }
    }
  },
  {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "service",
      "version",
      "contractVersion",
      "resultProfile",
      "supportedOperations",
      "supportedResultProfiles",
      "resultComponents",
      "worldAnalysis",
      "limits",
      "requiredCapabilitiesReady"
    ],
    "properties": {
      "service": {
        "const": "world-semantic-grounding-service"
      },
      "version": {
        "const": "0.2.1"
      },
      "contractVersion": {
        "const": "sacs-wsgs-grounding/1.2"
      },
      "resultProfile": {
        "const": "wsgs-world-analysis-findings/1.0"
      },
      "supportedOperations": {
        "type": "array",
        "minItems": 4,
        "maxItems": 4,
        "items": {
          "enum": [
            "GROUND_REFERENCES",
            "COMPILE_WORLD_QUERY",
            "EXECUTE_WORLD_QUERY",
            "VALIDATE_REFERENCES"
          ]
        },
        "uniqueItems": true
      },
      "supportedResultProfiles": {
        "type": "array",
        "minItems": 2,
        "maxItems": 2,
        "items": {
          "enum": [
            "wsgs-world-analysis-findings/1.0",
            "sacs-wsgs-geospatial-findings/1.0"
          ]
        },
        "uniqueItems": true
      },
      "resultComponents": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "worldAnalysisFindings",
          "geospatialFindings"
        ],
        "properties": {
          "worldAnalysisFindings": {
            "const": "REQUIRED"
          },
          "geospatialFindings": {
            "const": "OPTIONAL"
          }
        }
      },
      "worldAnalysis": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "supportedFindingKinds",
          "supportedChoiceKinds",
          "structuredSelection",
          "supportedActionSources",
          "capabilities",
          "checkedAt",
          "validUntil"
        ],
        "properties": {
          "supportedFindingKinds": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": {
              "enum": [
                "HISTORICAL_TRACE",
                "ROAD_ASSOCIATION",
                "TEMPORAL_EVENT",
                "METRIC_RANKING",
                "ACTION_TARGET_CANDIDATE"
              ]
            },
            "uniqueItems": true
          },
          "supportedChoiceKinds": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": {
              "enum": [
                "REFERENCE_SELECTION",
                "TASK_SELECTION",
                "METRIC_SERIES_SELECTION",
                "RANKED_LOCATION_SELECTION",
                "EVENT_SELECTION"
              ]
            },
            "uniqueItems": true
          },
          "structuredSelection": {
            "const": true
          },
          "supportedActionSources": {
            "type": "array",
            "minItems": 1,
            "maxItems": 1,
            "items": {
              "const": "HISTORICAL_METRIC_CANDIDATE"
            },
            "uniqueItems": true
          },
          "capabilities": {
            "type": "array",
            "minItems": 6,
            "maxItems": 6,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "capability",
                "supported",
                "available",
                "reasonCodes"
              ],
              "properties": {
                "capability": {
                  "enum": [
                    "HISTORICAL_TRACE",
                    "ROAD_ASSOCIATION",
                    "TEMPORAL_EVENT",
                    "CROSS",
                    "METRIC_RANKING",
                    "ACTION_TARGET_CANDIDATE"
                  ]
                },
                "supported": {
                  "const": true
                },
                "available": {
                  "type": "boolean"
                },
                "reasonCodes": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 16,
                  "items": {
                    "enum": [
                      "AVAILABLE",
                      "FEATURE_DISABLED",
                      "PROFILE_UNAUTHORIZED",
                      "SNAPSHOT_UNAVAILABLE",
                      "SNAPSHOT_EXPIRED",
                      "CAPABILITY_NOT_REGISTERED",
                      "OPERATION_UNAVAILABLE",
                      "OPERATION_DEGRADED",
                      "CONTRACT_MISMATCH",
                      "SEMANTIC_MISMATCH",
                      "PERMISSION_DENIED",
                      "DEPENDENCY_UNAVAILABLE"
                    ]
                  }
                }
              }
            }
          },
          "checkedAt": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          }
        }
      },
      "limits": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "maximumFindings",
          "maximumChoices",
          "maximumCandidatesPerChoice",
          "maximumEvents",
          "maximumRankedLocations",
          "maximumRoadVisits",
          "maximumPeriods",
          "maximumLinePositions",
          "maximumGaps",
          "maximumSourceIds",
          "maximumWarnings",
          "maximumIdLength",
          "maximumLabelLength",
          "maximumSelections",
          "maximumPublicResultBytes",
          "choiceTtlMs"
        ],
        "properties": {
          "maximumFindings": {
            "const": 32
          },
          "maximumChoices": {
            "const": 32
          },
          "maximumCandidatesPerChoice": {
            "const": 100
          },
          "maximumEvents": {
            "const": 100
          },
          "maximumRankedLocations": {
            "const": 100
          },
          "maximumRoadVisits": {
            "const": 100
          },
          "maximumPeriods": {
            "const": 100
          },
          "maximumLinePositions": {
            "const": 256
          },
          "maximumGaps": {
            "const": 64
          },
          "maximumSourceIds": {
            "const": 32
          },
          "maximumWarnings": {
            "const": 100
          },
          "maximumIdLength": {
            "const": 256
          },
          "maximumLabelLength": {
            "const": 512
          },
          "maximumSelections": {
            "const": 8
          },
          "maximumPublicResultBytes": {
            "const": 1048576
          },
          "choiceTtlMs": {
            "const": 60000
          }
        }
      },
      "requiredCapabilitiesReady": {
        "type": "boolean"
      }
    },
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:capabilities",
    "title": "GroundingCapabilities12"
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:choice",
    "title": "Choice",
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "choiceId",
          "choiceKind",
          "promptCode",
          "validUntil",
          "candidates"
        ],
        "properties": {
          "choiceId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "choiceKind": {
            "const": "REFERENCE_SELECTION"
          },
          "promptCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceFindingId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "candidateId",
                "displayName",
                "referenceProductId"
              ],
              "properties": {
                "candidateId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "displayName": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
                },
                "referenceProductId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                }
              }
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "choiceId",
          "choiceKind",
          "promptCode",
          "validUntil",
          "candidates"
        ],
        "properties": {
          "choiceId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "choiceKind": {
            "const": "TASK_SELECTION"
          },
          "promptCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceFindingId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "candidateId",
                "displayName",
                "referenceProductId"
              ],
              "properties": {
                "candidateId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "displayName": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
                },
                "referenceProductId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                }
              }
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "choiceId",
          "choiceKind",
          "promptCode",
          "validUntil",
          "candidates"
        ],
        "properties": {
          "choiceId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "choiceKind": {
            "const": "METRIC_SERIES_SELECTION"
          },
          "promptCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceFindingId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "candidateId",
                "displayName",
                "series"
              ],
              "properties": {
                "candidateId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "displayName": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
                },
                "series": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/series"
                }
              }
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "choiceId",
          "choiceKind",
          "promptCode",
          "validUntil",
          "candidates"
        ],
        "properties": {
          "choiceId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "choiceKind": {
            "const": "RANKED_LOCATION_SELECTION"
          },
          "promptCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceFindingId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "candidateId",
                "displayName",
                "findingId",
                "rank"
              ],
              "properties": {
                "candidateId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "displayName": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
                },
                "findingId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "rank": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                }
              }
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "choiceId",
          "choiceKind",
          "promptCode",
          "validUntil",
          "candidates"
        ],
        "properties": {
          "choiceId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "choiceKind": {
            "const": "EVENT_SELECTION"
          },
          "promptCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceFindingId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "validUntil": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "candidateId",
                "displayName",
                "findingId",
                "eventId"
              ],
              "properties": {
                "candidateId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "displayName": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
                },
                "findingId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                },
                "eventId": {
                  "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:common",
    "title": "Common",
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:@/-]*$"
      },
      "opaqueId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512
      },
      "label": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512
      },
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256,
        "pattern": "^[A-Z][A-Z0-9_:.@/-]*$"
      },
      "hash": {
        "type": "string",
        "pattern": "^sha256:[0-9a-f]{64}$"
      },
      "dateTime": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64,
        "format": "date-time",
        "pattern": "(?:Z|[+-][0-9]{2}:[0-9]{2})$"
      },
      "point": {
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
            "type": "array",
            "minItems": 2,
            "maxItems": 2,
            "prefixItems": [
              {
                "type": "number",
                "minimum": -180,
                "maximum": 180
              },
              {
                "type": "number",
                "minimum": -90,
                "maximum": 90
              }
            ],
            "items": false
          }
        }
      },
      "timeRange": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "start",
          "end",
          "bounds"
        ],
        "properties": {
          "start": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "end": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "bounds": {
            "enum": [
              "[)",
              "[]",
              "(]",
              "()",
              "UNSPECIFIED"
            ]
          }
        }
      },
      "periodIssue": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "period",
          "kind",
          "reasonCodes"
        ],
        "properties": {
          "period": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
          },
          "kind": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "reasonCodes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
            }
          }
        }
      },
      "display": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "truncated",
          "returnedCount"
        ],
        "properties": {
          "truncated": {
            "type": "boolean"
          },
          "returnedCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "sourceCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          }
        }
      },
      "coverage": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "prefixComplete": {
            "type": "boolean"
          },
          "suffixComplete": {
            "type": "boolean"
          },
          "temporalCoverageRatio": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "finalizationState": {
            "enum": [
              "PROVISIONAL",
              "SEALED",
              "CONFLICTED"
            ]
          },
          "sampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          }
        }
      },
      "network": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "graphVersionId",
          "graphVersion",
          "topologyHash",
          "timeBasis"
        ],
        "properties": {
          "graphVersionId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "graphVersion": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "topologyHash": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
          },
          "timeBasis": {
            "const": "CURRENT_ACTIVE_TOPOLOGY"
          }
        }
      },
      "metric": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "conceptId",
          "observedProperty",
          "measurementStage",
          "optimizationDirection"
        ],
        "properties": {
          "conceptId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "observedProperty": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "measurementStage": {
            "enum": [
              "NORMALIZED",
              "PARSED_NATIVE",
              "FUSED_DERIVED"
            ]
          },
          "unit": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "optimizationDirection": {
            "enum": [
              "MAXIMIZE",
              "MINIMIZE"
            ]
          }
        }
      },
      "series": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sourceKey",
          "datastreamKey",
          "measurementKey",
          "observedProperty",
          "measurementStage"
        ],
        "properties": {
          "sourceKey": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "datastreamKey": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "measurementKey": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "observedProperty": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "measurementStage": {
            "enum": [
              "NORMALIZED",
              "PARSED_NATIVE",
              "FUSED_DERIVED"
            ]
          },
          "valueUnit": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          }
        }
      },
      "statistics": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sampleCount",
          "minimum",
          "maximum",
          "mean",
          "median"
        ],
        "properties": {
          "sampleCount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000000
          },
          "minimum": {
            "type": "number"
          },
          "maximum": {
            "type": "number"
          },
          "mean": {
            "type": "number"
          },
          "median": {
            "type": "number"
          },
          "p25": {
            "type": "number"
          },
          "p75": {
            "type": "number"
          },
          "medianAbsoluteDeviation": {
            "type": "number",
            "minimum": 0
          },
          "firstObservedAt": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "lastObservedAt": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          }
        }
      },
      "rankingBasis": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "primaryStatistic",
          "optimizationDirection",
          "rankingValue",
          "tieBreakers"
        ],
        "properties": {
          "primaryStatistic": {
            "const": "MEDIAN"
          },
          "optimizationDirection": {
            "enum": [
              "MAXIMIZE",
              "MINIMIZE"
            ]
          },
          "rankingValue": {
            "type": "number"
          },
          "tieBreakers": {
            "type": "array",
            "minItems": 0,
            "maxItems": 16,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            }
          }
        }
      },
      "rankedLocation": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "candidateId",
          "rank",
          "representativeVisitedPosition",
          "representativeObservedAt",
          "representativeMeasurementId",
          "representativeValue",
          "sampleCount",
          "statistics",
          "rankingBasis",
          "reasonCodes"
        ],
        "properties": {
          "candidateId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "rank": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "representativeVisitedPosition": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "representativeObservedAt": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "representativeMeasurementId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "representativeValue": {
            "type": "number"
          },
          "sampleCount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000000
          },
          "statistics": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/statistics"
          },
          "rankingBasis": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/rankingBasis"
          },
          "h3Index": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32
          },
          "reasonCodes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
            }
          }
        }
      },
      "roadVisit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "visitId",
          "sourceFeatureId",
          "period",
          "sampleCount"
        ],
        "properties": {
          "visitId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "sourceFeatureId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
          },
          "displayName": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
          },
          "period": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
          },
          "entryPosition": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "exitPosition": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "sampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      },
      "offNetwork": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "segmentId",
          "period",
          "sampleCount",
          "interpretationHint",
          "reasonCodes"
        ],
        "properties": {
          "segmentId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "period": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
          },
          "sampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "entryPosition": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "exitPosition": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "pathPreview": {
            "type": "array",
            "minItems": 2,
            "maxItems": 256,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
            }
          },
          "interpretationHint": {
            "enum": [
              "UNMAPPED_PATH_CANDIDATE",
              "OPEN_AREA_MOVEMENT",
              "NETWORK_GEOMETRY_OFFSET_CANDIDATE",
              "TEMPORARY_PATH_CANDIDATE",
              "UNKNOWN"
            ]
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "reasonCodes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
            }
          }
        }
      },
      "ambiguity": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "segmentId",
          "period",
          "candidateFeatureIds"
        ],
        "properties": {
          "segmentId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "period": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
          },
          "candidateFeatureIds": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
            }
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      },
      "networkIssue": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "issueKind",
          "period",
          "relatedFeatureIds",
          "observationCount",
          "reasonCodes"
        ],
        "properties": {
          "issueKind": {
            "enum": [
              "MISSING_PATH_CANDIDATE",
              "MISSING_TOPOLOGY_CONNECTION_CANDIDATE",
              "ROAD_GEOMETRY_OFFSET_CANDIDATE",
              "DIRECTION_CONFLICT_CANDIDATE"
            ]
          },
          "period": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
          },
          "relatedFeatureIds": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
            }
          },
          "observationCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "reasonCodes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
            }
          }
        }
      },
      "eventExtent": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "timeWindow"
            ],
            "properties": {
              "kind": {
                "const": "INSTANT"
              },
              "timeWindow": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
              },
              "estimatedAt": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "period",
              "durationSeconds"
            ],
            "properties": {
              "kind": {
                "const": "INTERVAL"
              },
              "period": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
              },
              "durationSeconds": {
                "type": "number",
                "minimum": 0
              },
              "startTimeWindow": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
              },
              "endTimeWindow": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
              }
            }
          }
        ]
      },
      "eventTarget": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "sourceTargetId",
              "targetType"
            ],
            "properties": {
              "kind": {
                "const": "SPATIAL_TARGET"
              },
              "sourceTargetId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              },
              "referenceProductId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
              },
              "displayName": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/label"
              },
              "targetType": {
                "enum": [
                  "AREA",
                  "POINT",
                  "LINE"
                ]
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "graphVersionId",
              "graphVersion",
              "nodeId",
              "position",
              "incomingFeatureId",
              "outgoingFeatureId"
            ],
            "properties": {
              "kind": {
                "const": "NETWORK_JUNCTION"
              },
              "graphVersionId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              },
              "graphVersion": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              },
              "nodeId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              },
              "position": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
              },
              "incomingFeatureId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              },
              "outgoingFeatureId": {
                "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/opaqueId"
              }
            }
          }
        ]
      },
      "event": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "eventId",
          "eventType",
          "extent",
          "certainty",
          "reasonCodes",
          "evidenceIds"
        ],
        "properties": {
          "eventId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "eventType": {
            "enum": [
              "ENTER",
              "EXIT",
              "DWELL",
              "STOP",
              "PASS_NEAR",
              "CROSS"
            ]
          },
          "extent": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/eventExtent"
          },
          "position": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/point"
          },
          "target": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/eventTarget"
          },
          "certainty": {
            "enum": [
              "CONFIRMED_IN_AVAILABLE_DATA",
              "APPROXIMATED",
              "CLIPPED_TO_INPUT"
            ]
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "reasonCodes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
            }
          },
          "evidenceIds": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
            },
            "uniqueItems": true
          }
        }
      },
      "eventSelection": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "confirmed",
          "confirmationScope",
          "reasonCode",
          "blockingPeriods"
        ],
        "properties": {
          "kind": {
            "enum": [
              "FIRST",
              "LAST"
            ]
          },
          "selectedEventId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "confirmed": {
            "type": "boolean"
          },
          "confirmationScope": {
            "enum": [
              "REQUESTED_SCOPE_PROVEN",
              "CONFIRMED_IN_AVAILABLE_DATA",
              "NOT_CONFIRMED"
            ]
          },
          "reasonCode": {
            "enum": [
              "FIRST_EVENT_CONFIRMED",
              "FIRST_EVENT_NOT_CERTAIN",
              "LAST_EVENT_CONFIRMED",
              "LAST_EVENT_NOT_CERTAIN",
              "NO_EVENT_FOUND"
            ]
          },
          "blockingPeriods": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
            }
          }
        }
      },
      "metricCoverage": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "metricTemporalCompletenessKnown",
          "trajectory",
          "trajectoryGaps",
          "excludedPeriods"
        ],
        "properties": {
          "metricTemporalCompletenessKnown": {
            "const": false
          },
          "trajectory": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/coverage"
          },
          "trajectoryGaps": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
            }
          },
          "excludedPeriods": {
            "type": "array",
            "minItems": 0,
            "maxItems": 100,
            "items": {
              "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
            }
          },
          "sourceMetricSampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "acceptedMetricSampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "rejectedMetricSampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "alignedMetricSampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "unalignedMetricSampleCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "alignmentRatio": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      },
      "snapshotSummary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "snapshotHash"
        ],
        "properties": {
          "snapshotHash": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
          },
          "capturedAt": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
          },
          "worldVersion": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          }
        }
      }
    }
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
  },
  {
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
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
      },
      "value": {
        "type": "object"
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "surfaceText": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512
      },
      "span": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
          "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
        }
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "mentionId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
          "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
  },
  {
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
          "$ref": "urn:wsgs:v0.1:known-world-reference"
        }
      },
      "priorGroundings": {
        "type": "array",
        "maxItems": 16,
        "items": {
          "$ref": "urn:wsgs:v0.1:prior-grounding-reference"
        }
      },
      "mapSelections": {
        "type": "array",
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:v0.1:map-selection"
        }
      },
      "externalCorrelationHints": {
        "type": "array",
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:v0.1:external-correlation-hint"
        }
      },
      "externalPredicates": {
        "type": "array",
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:v0.1:external-predicate-capsule"
        }
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
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
  },
  {
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "from": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "to": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "groundingId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "requestId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "updatedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "startedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "finishedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "result": {
        "$ref": "urn:wsgs:v0.1:grounding-result"
      },
      "error": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/error"
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
            "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
          },
          "messageId": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
          },
          "originalText": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32768
          },
          "originalTextSha256": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
          },
          "locale": {
            "type": "string",
            "minLength": 2,
            "maxLength": 32
          },
          "createdAt": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
          },
          "focusSpans": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
        "$ref": "urn:wsgs:v0.1:grounding-context-capsule"
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
                  "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
  },
  {
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
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/referenceKey"
      },
      "referenceType": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "sourceMessageId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "sourceGroundingId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "validUntil": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/referenceKey"
      },
      "geometry": {
        "type": "object",
        "maxProperties": 16
      },
      "geometryHash": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "resultHash": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
      },
      "selectedProductIds": {
        "type": "array",
        "maxItems": 64,
        "items": {
          "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
        }
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "error": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/error"
      }
    }
  },
  {
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/referenceKey"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "revalidationRequired": {
        "type": "boolean"
      },
      "safeSummary": {
        "type": "object"
      }
    }
  },
  {
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "surfaceText": {
              "type": "string",
              "maxLength": 512
            },
            "span": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
                "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "relationType": {
              "type": "string",
              "maxLength": 128
            },
            "subjectMentionId": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "objectMentionId": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
            },
            "from": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
            },
            "to": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
              "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:evidence",
    "title": "GroundingEvidence12",
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
      },
      "dataSnapshot": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/snapshotSummary"
      },
      "computeSnapshot": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/snapshotSummary"
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
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:gap",
    "title": "Gap",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "gapId",
      "gapKind",
      "severity",
      "messageCode",
      "findingIds",
      "evidenceIds",
      "detail"
    ],
    "properties": {
      "gapId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "gapKind": {
        "enum": [
          "CAPABILITY_UNAVAILABLE",
          "REFERENCE_MISSING",
          "REFERENCE_AMBIGUOUS",
          "TASK_CONTEXT_REQUIRED",
          "SUBJECT_CONTEXT_REQUIRED",
          "TARGET_CONTEXT_REQUIRED",
          "METRIC_UNSUPPORTED",
          "METRIC_SERIES_AMBIGUOUS",
          "HISTORICAL_PROJECTION_PENDING",
          "HISTORICAL_DATA_INCOMPLETE",
          "ANALYSIS_INCOMPLETE",
          "RESULT_TRUNCATED",
          "SELECTION_INVALID",
          "SELECTION_EXPIRED",
          "SELECTION_SCOPE_MISMATCH",
          "SELECTION_AMBIGUOUS",
          "UPSTREAM_CONTRACT_MISMATCH",
          "UPSTREAM_TIMEOUT",
          "UPSTREAM_FAILURE",
          "CURRENT_VALIDATION_REQUIRED",
          "ROUTE_PLANNING_REQUIRED",
          "EXECUTION_CONFIRMATION_REQUIRED",
          "EXECUTION_NOT_AUTHORIZED",
          "MULTI_EXECUTION_UNSUPPORTED"
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
        "enum": [
          "CAPABILITY_UNAVAILABLE",
          "REFERENCE_MISSING",
          "REFERENCE_AMBIGUOUS",
          "TASK_CONTEXT_REQUIRED",
          "SUBJECT_CONTEXT_REQUIRED",
          "TARGET_CONTEXT_REQUIRED",
          "METRIC_UNSUPPORTED",
          "METRIC_SERIES_AMBIGUOUS",
          "HISTORICAL_PROJECTION_PENDING",
          "HISTORICAL_DATA_INCOMPLETE",
          "ANALYSIS_INCOMPLETE",
          "RESULT_TRUNCATED",
          "SELECTION_INVALID",
          "SELECTION_EXPIRED",
          "SELECTION_SCOPE_MISMATCH",
          "SELECTION_AMBIGUOUS",
          "UPSTREAM_CONTRACT_MISMATCH",
          "UPSTREAM_TIMEOUT",
          "UPSTREAM_FAILURE",
          "CURRENT_VALIDATION_REQUIRED",
          "ROUTE_PLANNING_REQUIRED",
          "EXECUTION_CONFIRMATION_REQUIRED",
          "EXECUTION_NOT_AUTHORIZED",
          "MULTI_EXECUTION_UNSUPPORTED"
        ]
      },
      "findingIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "detail": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "reasonCode": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
          },
          "sourceStatus": {
            "enum": [
              "COMPLETED",
              "PARTIAL",
              "NO_DATA",
              "INDETERMINATE",
              "FAILED",
              "CANCELLED"
            ]
          },
          "returnedCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          },
          "sourceCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000
          }
        }
      }
    }
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:job",
    "title": "GroundingJob12",
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "groundingId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
      },
      "requestId": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "updatedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "startedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "finishedAt": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "result": {
        "$ref": "urn:wsgs:grounding:1.2:result"
      },
      "error": {
        "$ref": "urn:wsgs:v0.1:common#/$defs/error"
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "ACCEPTED",
                "RUNNING"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "not": {
            "required": [
              "result"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL",
                "AMBIGUOUS",
                "UNRESOLVED"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "result"
          ]
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:request",
    "title": "GroundingRequest12",
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
            "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
          },
          "messageId": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
          },
          "originalText": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32768
          },
          "originalTextSha256": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/sha256"
          },
          "locale": {
            "type": "string",
            "minLength": 2,
            "maxLength": 32
          },
          "createdAt": {
            "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
          },
          "focusSpans": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
        "$ref": "urn:wsgs:v0.1:grounding-context-capsule"
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
                  "$ref": "urn:wsgs:v0.1:common#/$defs/textSpan"
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
      },
      "analysisSelections": {
        "type": "array",
        "minItems": 1,
        "maxItems": 8,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:analysis-selection"
        }
      }
    }
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:result",
    "title": "GroundingResult12",
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
      "resultHash",
      "worldAnalysisFindings"
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
          "$ref": "urn:wsgs:grounding:1.2:reference-product"
        }
      },
      "evidenceItems": {
        "type": "array",
        "maxItems": 1000,
        "items": {
          "$ref": "urn:wsgs:grounding:1.2:evidence"
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
          "elapsedMs",
          "runFingerprint"
        ],
        "properties": {
          "parserVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "semanticModelReceiptIds": {
            "type": "array",
            "maxItems": 16,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            }
          },
          "queryCompilerVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "normalizerVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "elapsedMs": {
            "type": "number",
            "minimum": 0
          },
          "runFingerprint": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
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
      },
      "worldAnalysisFindings": {
        "$ref": "urn:wsgs:world-analysis:1.0:world-analysis-findings"
      }
    }
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:historical-trace",
    "title": "Historical Trace",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "findingId",
      "findingKind",
      "semanticConcept",
      "status",
      "subjectReferenceProductIds",
      "evidenceIds",
      "unknowns",
      "warnings",
      "display",
      "phaseScope",
      "selectedPeriods",
      "activePeriods",
      "pausedPeriods",
      "requestedPeriods",
      "definedPeriods",
      "excludedPeriods",
      "trajectoryGaps",
      "coverage"
    ],
    "properties": {
      "findingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "findingKind": {
        "const": "HISTORICAL_TRACE"
      },
      "semanticConcept": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
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
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "unknowns": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "warnings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "display": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/display"
      },
      "validUntil": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "taskReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "executionIntervalReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "trajectoryReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "executionNo": {
        "type": "integer",
        "minimum": 1,
        "maximum": 1000000000
      },
      "lifecycleState": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
      },
      "phaseScope": {
        "enum": [
          "EXECUTION_ENVELOPE",
          "ACTIVE_PHASES_ONLY"
        ]
      },
      "selectedPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
        }
      },
      "activePeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
        }
      },
      "pausedPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
        }
      },
      "requestedPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
        }
      },
      "definedPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/timeRange"
        }
      },
      "excludedPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
        }
      },
      "trajectoryGaps": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
        }
      },
      "coverage": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/coverage"
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "taskReferenceProductId",
            "trajectoryReferenceProductId"
          ],
          "properties": {
            "evidenceIds": {
              "type": "array",
              "minItems": 1
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:metric-ranking",
    "title": "Metric Ranking",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "findingId",
      "findingKind",
      "semanticConcept",
      "status",
      "subjectReferenceProductIds",
      "evidenceIds",
      "unknowns",
      "warnings",
      "display",
      "candidateDomain",
      "metric",
      "candidates",
      "coverage"
    ],
    "properties": {
      "findingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "findingKind": {
        "const": "METRIC_RANKING"
      },
      "semanticConcept": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
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
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "unknowns": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "warnings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "display": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/display"
      },
      "validUntil": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "trajectoryReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "candidateDomain": {
        "const": "PAST_OBSERVED_LOCATIONS"
      },
      "metric": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/metric"
      },
      "selectedSeries": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/series"
      },
      "candidates": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/rankedLocation"
        }
      },
      "coverage": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/metricCoverage"
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "trajectoryReferenceProductId",
            "selectedSeries"
          ],
          "properties": {
            "evidenceIds": {
              "type": "array",
              "minItems": 1
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:grounding:1.2:reference-product",
    "title": "ReferenceProduct12",
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/identifier"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/referenceKey"
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
        "$ref": "urn:wsgs:v0.1:common#/$defs/dateTime"
      },
      "revalidationRequired": {
        "type": "boolean"
      }
    }
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:road-association",
    "title": "Road Association",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "findingId",
      "findingKind",
      "semanticConcept",
      "status",
      "subjectReferenceProductIds",
      "evidenceIds",
      "unknowns",
      "warnings",
      "display",
      "networkRole",
      "roadVisits",
      "offNetworkSegments",
      "ambiguousSegments",
      "networkDataIssues",
      "associationPrefixComplete",
      "associationSuffixComplete",
      "blockingPeriods"
    ],
    "properties": {
      "findingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "findingKind": {
        "const": "ROAD_ASSOCIATION"
      },
      "semanticConcept": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
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
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "unknowns": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "warnings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "display": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/display"
      },
      "validUntil": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "trajectoryReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "networkRole": {
        "const": "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH"
      },
      "network": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/network"
      },
      "roadVisits": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/roadVisit"
        }
      },
      "offNetworkSegments": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/offNetwork"
        }
      },
      "ambiguousSegments": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/ambiguity"
        }
      },
      "networkDataIssues": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/networkIssue"
        }
      },
      "associationPrefixComplete": {
        "type": "boolean"
      },
      "associationSuffixComplete": {
        "type": "boolean"
      },
      "blockingPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
        }
      },
      "lastConfirmedRoad": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "visitId",
          "confirmationScope",
          "absoluteFinalRoadClaimed"
        ],
        "properties": {
          "visitId": {
            "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
          },
          "confirmationScope": {
            "const": "CONFIRMED_IN_AVAILABLE_DATA"
          },
          "absoluteFinalRoadClaimed": {
            "const": false
          }
        }
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "trajectoryReferenceProductId",
            "network"
          ],
          "properties": {
            "evidenceIds": {
              "type": "array",
              "minItems": 1
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:temporal-event",
    "title": "Temporal Event",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "findingId",
      "findingKind",
      "semanticConcept",
      "status",
      "subjectReferenceProductIds",
      "evidenceIds",
      "unknowns",
      "warnings",
      "display",
      "eventTypes",
      "events",
      "sourcePrefixComplete",
      "sourceSuffixComplete",
      "completeForAllEvents",
      "blockingPeriods"
    ],
    "properties": {
      "findingId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "findingKind": {
        "const": "TEMPORAL_EVENT"
      },
      "semanticConcept": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
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
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "evidenceIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
        },
        "uniqueItems": true
      },
      "unknowns": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "warnings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/code"
        }
      },
      "display": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/display"
      },
      "validUntil": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/dateTime"
      },
      "trajectoryReferenceProductId": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/id"
      },
      "eventTypes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 6,
        "items": {
          "enum": [
            "ENTER",
            "EXIT",
            "DWELL",
            "STOP",
            "PASS_NEAR",
            "CROSS"
          ]
        }
      },
      "events": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/event"
        }
      },
      "selection": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/eventSelection"
      },
      "sourcePrefixComplete": {
        "type": "boolean"
      },
      "sourceSuffixComplete": {
        "type": "boolean"
      },
      "completeForAllEvents": {
        "type": "boolean"
      },
      "blockingPeriods": {
        "type": "array",
        "minItems": 0,
        "maxItems": 100,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/periodIssue"
        }
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "enum": [
                "COMPLETED",
                "PARTIAL"
              ]
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "trajectoryReferenceProductId"
          ],
          "properties": {
            "evidenceIds": {
              "type": "array",
              "minItems": 1
            },
            "subjectReferenceProductIds": {
              "type": "array",
              "minItems": 1
            }
          }
        }
      }
    ]
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:wsgs:world-analysis:1.0:world-analysis-findings",
    "title": "World Analysis Findings",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "profile",
      "findings",
      "choices",
      "gaps",
      "findingSetHash"
    ],
    "properties": {
      "profile": {
        "const": "wsgs-world-analysis-findings/1.0"
      },
      "findings": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "oneOf": [
            {
              "$ref": "urn:wsgs:world-analysis:1.0:historical-trace"
            },
            {
              "$ref": "urn:wsgs:world-analysis:1.0:road-association"
            },
            {
              "$ref": "urn:wsgs:world-analysis:1.0:temporal-event"
            },
            {
              "$ref": "urn:wsgs:world-analysis:1.0:metric-ranking"
            },
            {
              "$ref": "urn:wsgs:world-analysis:1.0:action-target-candidate"
            }
          ]
        }
      },
      "choices": {
        "type": "array",
        "minItems": 0,
        "maxItems": 32,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:choice"
        }
      },
      "gaps": {
        "type": "array",
        "minItems": 0,
        "maxItems": 64,
        "items": {
          "$ref": "urn:wsgs:world-analysis:1.0:gap"
        }
      },
      "findingSetHash": {
        "$ref": "urn:wsgs:world-analysis:1.0:common#/$defs/hash"
      }
    }
  }
];
