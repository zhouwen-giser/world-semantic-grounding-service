import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AlignmentClosureError,
  generateGowmAlignmentClosure,
  verifyPrReviewArtifact
} from "../validation/scripts/generate-gowm-alignment-closure.js";

const sourceRoot = resolve(import.meta.dirname, "..");
const staticEvidencePaths = [
  "reports/wsgs-gowm-0.6.4-alignment/w00-baseline.json",
  "reports/wsgs-gowm-0.6.4-alignment/alignment-invariant-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/negative-cases-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/northbound-compatibility-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/contract-intake-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/contract-diff-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/semantic-migration-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/w00-existing-authorities.json"
] as const;
const outputPaths = [
  "reports/wsgs-gowm-0.6.4-alignment/closure-report.json",
  "reports/wsgs-gowm-0.6.4-alignment/development-readiness.md",
  "reports/wsgs-gowm-0.6.4-alignment/alignment-ledger.json"
] as const;

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

describe("GOWM alignment closure generator", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "wsgs-gowm-closure-"));
    copyFixture("acceptance/alignment-required.csv");
  });

  afterEach(() => {
    const resolved = resolve(fixtureRoot);
    expect(resolved.startsWith(resolve(tmpdir()))).toBe(true);
    rmSync(resolved, { recursive: true, force: true });
  });

  function copyFixture(relativePath: string): void {
    const target = resolve(fixtureRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(sourceRoot, relativePath), target);
  }

  function expectBlocked(code: string, write = false): void {
    let observed: unknown;
    try {
      generateGowmAlignmentClosure({ root: fixtureRoot, write });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(AlignmentClosureError);
    expect((observed as AlignmentClosureError).code).toBe(code);
  }

  it("fails closed when runtime evidence is missing and write creates no closure outputs", () => {
    for (const path of staticEvidencePaths) copyFixture(path);

    expectBlocked("ALIGNMENT_CLOSURE_EVIDENCE_MISSING", true);

    for (const path of outputPaths) expect(existsSync(resolve(fixtureRoot, path))).toBe(false);
  });

  it("rejects a canonical evidenceHash mismatch", () => {
    const path = staticEvidencePaths[0];
    copyFixture(path);
    const target = resolve(fixtureRoot, path);
    const document = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    document["baselineCheck"] = "tampered after evidenceHash generation";
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    expectBlocked("ALIGNMENT_EVIDENCE_HASH_MISMATCH");
  });

  it("rejects a missing canonical evidenceHash", () => {
    const path = staticEvidencePaths[0];
    copyFixture(path);
    const target = resolve(fixtureRoot, path);
    const document = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    delete document["evidenceHash"];
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    expectBlocked("ALIGNMENT_EVIDENCE_HASH_MISSING");
  });

  it("recomputes both raw and LF-canonical PR body hashes", () => {
    const bodyPath = "reports/wsgs-gowm-0.6.4-alignment/PR_BODY.md";
    const evidencePaths = [
      "reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json",
      "reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json",
      "reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json",
      "reports/wsgs-gowm-0.6.4-alignment/formal-pipeline-r1-r5.json",
      "reports/wsgs-gowm-0.6.4-alignment/wsgs-process-binding.json",
      "reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json",
      "reports/wsgs-gowm-0.6.4-alignment/pipeline-traceability.json",
      "reports/wsgs-gowm-0.6.4-alignment/closure-report.json"
    ];
    const nonClaims = [
      "This closure is development readiness only.",
      "It is not production qualification, release, deployment, or shared-runtime mutation evidence."
    ];
    const canonicalBody = [
      "# Draft alignment review",
      "",
      ...evidencePaths,
      "",
      ...nonClaims,
      ""
    ].join("\n");
    const rawBody = Buffer.from(canonicalBody.replaceAll("\n", "\r\n"), "utf8");
    const target = resolve(fixtureRoot, bodyPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rawBody);
    const prReview = {
      draft: true,
      productionQualified: false,
      bodyPath,
      bodyHash: sha256(rawBody),
      bodyCanonicalHash: sha256(canonicalBody),
      evidencePaths,
      nonClaims
    };

    expect(() => verifyPrReviewArtifact(fixtureRoot, prReview)).not.toThrow();

    writeFileSync(target, Buffer.concat([rawBody, Buffer.from("tampered\r\n", "utf8")]));
    expect(() => verifyPrReviewArtifact(fixtureRoot, prReview)).toThrowError(
      expect.objectContaining({ code: "ALIGNMENT_PR_BODY_RAW_HASH_MISMATCH" })
    );
  });
});
