import { verifyGowmContractIntake } from "../../packages/gowm-contract-intake/src/index.js";

try {
  const summary = verifyGowmContractIntake();
  console.log(
    [
      "GOWM 0.6.3 contract intake verified",
      `source=${summary.sourceCommit}`,
      `package=${summary.packageName}@${summary.packageVersion}`,
      `manifest=${summary.manifestFileCount}/${summary.manifestFileCount}`,
      `lock=default:${summary.defaultOperationCount},preview:${summary.previewOperationCount}`,
      `archive=${summary.archiveFileCount}/${summary.extractedFileCount} canonical-LF-identical`,
      `checks=${summary.checks.length} PASS`
    ].join("; ")
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
