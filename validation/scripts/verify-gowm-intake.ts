import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  expectedGowmPackageIntegrityEvidence,
  verifyGowmContractIntake
} from "../../packages/gowm-contract-intake/src/index.js";

try {
  const write = process.argv.includes("--write");
  let summary = verifyGowmContractIntake({ verifyRecordedEvidence: !write });
  if (write) {
    const repositoryRoot = resolve(import.meta.dirname, "..", "..");
    const intakeRoot = resolve(repositoryRoot, "contracts", "upstream", "gowm-0.6.3");
    const report = {
      schemaVersion: "1.0",
      sourceCommit: summary.sourceCommit,
      packageIntegrity: summary.packageIntegrity,
      checks: [
        ...summary.checks,
        {
          id: "package-integrity-evidence",
          status: "PASS" as const,
          actual: "CURRENT",
          expected: "CURRENT"
        }
      ],
      status: "PASS"
    };
    writeFileSync(
      resolve(intakeRoot, "PACKAGE_INTEGRITY"),
      `${JSON.stringify(expectedGowmPackageIntegrityEvidence(), null, 2)}\n`,
      "utf8"
    );
    writeFileSync(resolve(intakeRoot, "CONTRACT_INTAKE_REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    summary = verifyGowmContractIntake();
  }
  console.log(
    [
      "GOWM runtime 0.6.4 / Gateway contract 0.6.3 intake verified",
      `source=${summary.sourceCommit}`,
      `package=${summary.packageName}@${summary.packageVersion}`,
      `manifest=${summary.manifestFileCount}/${summary.manifestFileCount}`,
      `lock=default:${summary.defaultOperationCount},preview:${summary.previewOperationCount}`,
      `archive=${summary.archiveFileCount}/${summary.extractedFileCount} byte-identical`,
      `checks=${summary.checks.length} PASS`
    ].join("; ")
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
