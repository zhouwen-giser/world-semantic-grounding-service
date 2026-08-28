import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";

import { createProductionBackendFromEnvironment } from "../../services/grounding-api/src/production.js";
import { createGroundingApi } from "../../services/grounding-api/src/server.js";

if (process.env["ALLOW_REAL_PRODUCTION_READINESS_GATE"] !== "YES") {
  throw new Error("Set ALLOW_REAL_PRODUCTION_READINESS_GATE=YES to call the configured production dependencies");
}

function loadFrozenSchemas(): Record<string, unknown> {
  const directory = resolve(process.cwd(), "contracts", "wsgs-v0.1", "contracts");
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name, JSON.parse(readFileSync(resolve(directory, name), "utf8")) as unknown])
  );
}

const resources = createProductionBackendFromEnvironment();
const app = await createGroundingApi({
  auth: {
    mode: "STATIC_TRUSTED",
    identity: createGroundingIdentity({
      servicePrincipalId: "readiness-gate",
      actorId: "readiness-gate",
      dataScopes: ["readiness-gate"],
      datasetScopes: [],
      permissions: ["grounding.read"]
    })
  },
  backend: resources.backend,
  schemas: loadFrozenSchemas(),
  logger: false
});

let exitCode = 1;
try {
  const response = await app.inject({ method: "GET", url: "/health/ready" });
  const body = response.json() as { status?: unknown; reasons?: unknown };
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.filter((entry): entry is string => typeof entry === "string")
    : [];
  const passed = response.statusCode === 503 && body.status === "not_ready" && reasons.length > 0;
  process.stdout.write(`${JSON.stringify({
    marker: passed ? "WSGS_PRODUCTION_READINESS_FAIL_CLOSED" : "WSGS_PRODUCTION_READINESS_GATE_FAILED",
    httpStatus: response.statusCode,
    status: body.status,
    reasons
  }, null, 2)}\n`);
  exitCode = passed ? 0 : 1;
} finally {
  await app.close();
  await resources.close();
}

// The production readiness module owns a cached PostgreSQL pool for the
// process lifetime. This one-shot gate terminates only after both API-owned
// resources above have closed and the complete result has been written.
process.exit(exitCode);
