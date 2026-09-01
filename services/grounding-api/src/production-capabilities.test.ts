import { readFileSync, readdirSync } from "node:fs";

import {
  LEGACY_GROUNDING_CONTRACT_SELECTION,
  SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION
} from "@wsgs/grounding-pipeline";
import { describe, expect, it } from "vitest";

import { groundingCapabilitiesForSelection } from "./production.js";
import { compileApiSchemas } from "./schemas.js";

const legacySchemaDirectory = new URL("../../../contracts/wsgs-v0.1/contracts/", import.meta.url);
const legacySchemas = Object.fromEntries(readdirSync(legacySchemaDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, legacySchemaDirectory), "utf8")) as unknown]));
const validators = compileApiSchemas(legacySchemas);

describe("groundingCapabilitiesForSelection", () => {
  it("preserves the exact legacy 1.0 capability document", () => {
    const capabilities = groundingCapabilitiesForSelection(
      LEGACY_GROUNDING_CONTRACT_SELECTION,
      { ready: true, reasons: [] }
    );
    expect(capabilities).toEqual({
      service: "world-semantic-grounding-service",
      version: "0.1.0",
      contractVersion: "sacs-wsgs-grounding/1.0",
      supportedOperations: [
        "GROUND_REFERENCES",
        "COMPILE_WORLD_QUERY",
        "EXECUTE_WORLD_QUERY",
        "VALIDATE_REFERENCES"
      ],
      supportedProducts: [
        "MENTIONS",
        "REFERENCE_PRODUCTS",
        "WORLD_EVIDENCE",
        "AMBIGUITIES",
        "CAPABILITY_GAPS"
      ],
      gowmContract: {
        softwareVersion: "0.4.0",
        commit: "db575f79c874a69f65a2043a7e463338524b713d",
        sourcePackageArtifacts: 33
      },
      requiredCapabilitiesReady: true,
      optionalCapabilities: []
    });
    expect(validators.capabilities(capabilities)).toBe(true);
  });

  it("advertises the frozen 1.1 surface while keeping N05 and N06 unavailable", () => {
    const capabilities = groundingCapabilitiesForSelection(
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
      { ready: true, reasons: [] }
    );
    expect(validators.capabilities11(capabilities)).toBe(true);
    expect(capabilities).toMatchObject({
      version: "0.2.1",
      contractVersion: "sacs-wsgs-grounding/1.1",
      supportedResultProfiles: ["sacs-wsgs-geospatial-findings/1.0"],
      geospatialTransportMode: "RESULT_EXTENSION",
      currentness: {
        mode: "DEDICATED_OPERATION",
        operation: "VALIDATE_SOURCE_CURRENTNESS"
      },
      requiredCapabilitiesReady: false,
      optionalCapabilities: [
        {
          operationId: "RESOLVE_WORLD_SELECTION",
          available: false,
          reason: "IMPLEMENTATION_PENDING_N05"
        },
        {
          operationId: "VALIDATE_SOURCE_CURRENTNESS",
          available: false,
          reason: "IMPLEMENTATION_PENDING_N06"
        }
      ]
    });
    const operations = capabilities["supportedOperations"] as string[];
    expect(operations).toHaveLength(6);
    expect(new Set(operations).size).toBe(6);
  });

  it("advertises only N05 as available when structured-selection authority is configured", () => {
    const capabilities = groundingCapabilitiesForSelection(
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
      { ready: true, reasons: [] },
      { structuredSelection: true, currentness: false }
    );
    expect(validators.capabilities11(capabilities)).toBe(true);
    expect(capabilities).toMatchObject({
      requiredCapabilitiesReady: false,
      optionalCapabilities: [
        { operationId: "RESOLVE_WORLD_SELECTION", available: true },
        {
          operationId: "VALIDATE_SOURCE_CURRENTNESS",
          available: false,
          reason: "IMPLEMENTATION_PENDING_N06"
        }
      ]
    });
    expect((capabilities["optionalCapabilities"] as Record<string, unknown>[])[0]).not.toHaveProperty("reason");
  });

  it("advertises N05 and N06 as ready only when both phase authority and runtime readiness pass", () => {
    const capabilities = groundingCapabilitiesForSelection(
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
      { ready: true, reasons: [] },
      { structuredSelection: true, currentness: true }
    );
    expect(validators.capabilities11(capabilities)).toBe(true);
    expect(capabilities).toMatchObject({
      requiredCapabilitiesReady: true,
      optionalCapabilities: [
        { operationId: "RESOLVE_WORLD_SELECTION", available: true },
        { operationId: "VALIDATE_SOURCE_CURRENTNESS", available: true }
      ]
    });
    expect(groundingCapabilitiesForSelection(
      SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION,
      { ready: false, reasons: ["GATEWAY_UNAVAILABLE"] },
      { structuredSelection: true, currentness: true }
    )["requiredCapabilitiesReady"]).toBe(false);
  });
});
