import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  expectedGowmPackageIntegrityEvidence,
  GOWM_CONSUMER_LOGICAL_INTEGRITY,
  GOWM_CONSUMER_TARBALL_SHA512,
  GOWM_SOURCE_COMMIT,
  verifyGowmContractIntake
} from "./index.js";

const temporaryDirectories: string[] = [];

function copyIntake(): string {
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const source = join(repositoryRoot, "contracts", "upstream", "gowm-0.6.3");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wsgs-gowm-intake-"));
  temporaryDirectories.push(temporaryRoot);
  const intakeRoot = join(temporaryRoot, "gowm-0.6.3");
  cpSync(source, intakeRoot, { recursive: true });
  return intakeRoot;
}

function rewriteExtractedPackageLineEndings(intakeRoot: string, eol: "\n" | "\r\n"): void {
  const packageRoot = join(intakeRoot, "extracted", "package");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      const content = readFileSync(entryPath, "utf8").replace(/\r\n|\r|\n/gu, "\n");
      writeFileSync(entryPath, content.replace(/\n/gu, eol), "utf8");
    }
  };
  visit(packageRoot);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GOWM 0.6.3 authoritative contract intake", () => {
  it("verifies the recorded source, logical integrity, archive, lock, and materialization evidence", () => {
    const summary = verifyGowmContractIntake();

    expect(summary.status).toBe("PASS");
    expect(summary.sourceCommit).toBe(GOWM_SOURCE_COMMIT);
    expect(summary.packageIntegrity).toBe(GOWM_CONSUMER_LOGICAL_INTEGRITY);
    expect(summary.manifestFileCount).toBe(62);
    expect(summary.canonicalLfFileCount).toBe(62);
    expect(summary.archiveFileCount).toBe(64);
    expect(summary.extractedFileCount).toBe(64);
    expect(summary.defaultOperationCount).toBe(31);
    expect(summary.previewOperationCount).toBe(89);
    expect(summary.checks.every((check) => check.status === "PASS")).toBe(true);
  });

  it("uses the upstream canonical object-key ordering", () => {
    expect(canonicalJson({ z: 1, nested: { z: 2, a: 1 }, a: 2 })).toBe(
      '{"a":2,"nested":{"a":1,"z":2},"z":1}'
    );
  });

  it("accepts LF and CRLF checkouts while retaining the byte-locked archive materialization", () => {
    const lfIntakeRoot = copyIntake();
    rewriteExtractedPackageLineEndings(lfIntakeRoot, "\n");
    const lfSummary = verifyGowmContractIntake({ intakeRoot: lfIntakeRoot, verifyRecordedEvidence: false });

    const crlfIntakeRoot = copyIntake();
    rewriteExtractedPackageLineEndings(crlfIntakeRoot, "\r\n");
    const crlfSummary = verifyGowmContractIntake({ intakeRoot: crlfIntakeRoot, verifyRecordedEvidence: false });

    for (const summary of [lfSummary, crlfSummary]) {
      expect(summary.status).toBe("PASS");
      expect(summary.rawCrlfPackageFileCount).toBe(64);
      expect(summary.materializationTreeSha256).toBe(
        "sha256:d6a0f4ad900134ab06f00d2cbbf11f591d55e620d313b784741dd0e92808d8a7"
      );
      expect(summary.checks).toContainEqual(expect.objectContaining({
        id: "archive-checkout-canonical-lf-materialization",
        status: "PASS"
      }));
    }
  });

  it("records the task-package Z2m value as logical integrity, not as the tgz digest", () => {
    const evidence = expectedGowmPackageIntegrityEvidence();

    expect(GOWM_CONSUMER_LOGICAL_INTEGRITY).not.toBe(GOWM_CONSUMER_TARBALL_SHA512);
    expect(evidence.discrepancy.valuesEqual).toBe(false);
    expect(evidence.discrepancy.taskPackageLockedValueInterpretation).toBe(
      "UPSTREAM_LOGICAL_PRE_LOCK_FILE_RECORD_INTEGRITY"
    );
  });

  it("fails closed when a materialized contract byte changes", () => {
    const intakeRoot = copyIntake();
    const target = join(
      intakeRoot,
      "extracted",
      "package",
      "bundle",
      "schemas",
      "gowm-v0.6.3",
      "operation-availability-list.schema.json"
    );
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from(" ")]));

    expect(() => verifyGowmContractIntake({ intakeRoot, verifyRecordedEvidence: false })).toThrow(
      /LF byte count mismatch/
    );
  });

  it("fails closed when canonical content changes in an LF checkout", () => {
    const intakeRoot = copyIntake();
    rewriteExtractedPackageLineEndings(intakeRoot, "\n");
    const target = join(
      intakeRoot,
      "extracted",
      "package",
      "bundle",
      "schemas",
      "gowm-v0.6.3",
      "operation-availability-list.schema.json"
    );
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from(" ")]));

    expect(() => verifyGowmContractIntake({ intakeRoot, verifyRecordedEvidence: false })).toThrow(
      /LF byte count mismatch/
    );
  });

  it("rejects an unpinned source commit", () => {
    const intakeRoot = copyIntake();
    const sourceLockPath = join(intakeRoot, "SOURCE_LOCK.json");
    const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8")) as {
      gowmSource: { commit: string };
    };
    sourceLock.gowmSource.commit = "main";
    writeFileSync(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`, "utf8");

    expect(() => verifyGowmContractIntake({ intakeRoot, verifyRecordedEvidence: false })).toThrow(
      /SOURCE_LOCK/
    );
  });

  it("fails closed when the package is absent or its archive bytes are corrupted", () => {
    const missingRoot = copyIntake();
    const archiveName = "gowm-world-gateway-contracts-0.6.3.tgz";
    unlinkSync(join(missingRoot, archiveName));
    expect(() => verifyGowmContractIntake({ intakeRoot: missingRoot, verifyRecordedEvidence: false })).toThrow();

    const corruptedRoot = copyIntake();
    const archivePath = join(corruptedRoot, archiveName);
    writeFileSync(archivePath, Buffer.concat([readFileSync(archivePath), Buffer.from([0])]));
    expect(() => verifyGowmContractIntake({ intakeRoot: corruptedRoot, verifyRecordedEvidence: false })).toThrow(
      /tarball-bytes/
    );
  });
});
