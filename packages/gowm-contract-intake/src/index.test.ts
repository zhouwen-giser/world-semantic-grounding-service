import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  expectedGowmPackageIntegrityEvidence,
  GOWM_CONSUMER_LOGICAL_INTEGRITY,
  GOWM_CONSUMER_TARBALL_SHA512,
  GOWM_GATEWAY_CONTRACT_VERSION,
  GOWM_RUNTIME_VERSION,
  GOWM_RUNTIME_SOURCE_COMMIT,
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GOWM 0.6.3 authoritative contract intake", () => {
  it("verifies the recorded source, logical integrity, archive, lock, and materialization evidence", () => {
    const summary = verifyGowmContractIntake();

    expect(summary.status).toBe("PASS");
    expect(summary.sourceCommit).toBe(GOWM_RUNTIME_SOURCE_COMMIT);
    expect(summary.runtimeVersion).toBe(GOWM_RUNTIME_VERSION);
    expect(summary.gatewayContractVersion).toBe(GOWM_GATEWAY_CONTRACT_VERSION);
    expect(summary.runtimeVersion).not.toBe(summary.gatewayContractVersion);
    expect(summary.packageIntegrity).toBe(GOWM_CONSUMER_LOGICAL_INTEGRITY);
    expect(summary.manifestFileCount).toBe(62);
    expect(summary.manifestRawByteFileCount).toBe(62);
    expect(summary.rawCrlfPackageFileCount).toBe(58);
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

  it("records the task-locked Kek value as logical integrity, not as the tgz digest", () => {
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
      /Raw byte count mismatch/
    );
  });

  it("fails closed when CRLF bytes are normalized without changing JSON semantics", () => {
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
    const raw = readFileSync(target);
    expect(raw.includes(Buffer.from("\r\n", "ascii"))).toBe(true);
    writeFileSync(target, Buffer.from(raw.toString("utf8").replace(/\r\n/gu, "\n"), "utf8"));

    expect(() => verifyGowmContractIntake({ intakeRoot, verifyRecordedEvidence: false })).toThrow(
      /Raw byte count mismatch/
    );
  });

  it("fails closed when materialized bytes change without changing their length", () => {
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
    const raw = readFileSync(target);
    const mutated = Buffer.from(raw);
    const titleOffset = mutated.indexOf(Buffer.from('"title"', "ascii"));
    expect(titleOffset).toBeGreaterThanOrEqual(0);
    mutated[titleOffset + 2] = "I".charCodeAt(0);
    expect(mutated.length).toBe(raw.length);
    writeFileSync(target, mutated);

    expect(() => verifyGowmContractIntake({ intakeRoot, verifyRecordedEvidence: false })).toThrow(
      /Raw SHA-256 mismatch/
    );
  });

  it("pins SOURCE_LOCK to the WSGS base and target from the alignment authority", () => {
    const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const sourceLock = JSON.parse(
      readFileSync(join(repositoryRoot, "contracts", "upstream", "gowm-0.6.3", "SOURCE_LOCK.json"), "utf8")
    ) as {
      wsgsSource: { commit: string; version: string };
      targetVersion: string;
    };

    expect(sourceLock.wsgsSource).toEqual({
      repository: "zhouwen-giser/world-semantic-grounding-service",
      commit: "c2a71a0f455c728ae45d70067f223e1450cfa427",
      version: "0.2.0"
    });
    expect(sourceLock.targetVersion).toBe("0.2.1");
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
