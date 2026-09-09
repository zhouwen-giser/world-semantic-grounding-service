import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface CurrentGowmSnapshot {
  schemaVersion: "1.0";
  runtimeVersion: string;
  packageVersion: string;
  gatewayContractVersion: string;
  lockPath: string;
  lockSha256: string;
  lockSchemaPath: string;
  manifestSha256: string;
  operationalLockPath: string;
  operationalLockSha256: string;
  analysisSourceSha256: string;
  supportingSchemas: Record<string, { sourcePath: string; sha256: string }>;
}

// Resolve once per process. Refresh never changes the contract under active work.
export const currentGowmRoot = realpathSync(fileURLToPath(new URL(
  "../../../contracts/upstream/gowm-current", import.meta.url
)));
const hash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
export const currentGowmSnapshotHash = hash(join(currentGowmRoot, "SNAPSHOT.json"));
export const currentGowmSnapshot = JSON.parse(readFileSync(join(currentGowmRoot, "SNAPSHOT.json"), "utf8")) as CurrentGowmSnapshot;
export function currentGowmPath(relative: string): string {
  const path = resolve(currentGowmRoot, relative);
  if (!path.startsWith(currentGowmRoot + sep)) throw new Error("CURRENT_GOWM_PATH_INVALID");
  return path;
}
const manifest = JSON.parse(readFileSync(currentGowmPath("bundle/MANIFEST.json"), "utf8")) as {files: {path: string; sha256: string}[]};
export function verifyCurrentGowmSnapshot(): void {
if (hash(currentGowmPath("bundle/MANIFEST.json")) !== currentGowmSnapshot.manifestSha256 ||
    hash(currentGowmPath(currentGowmSnapshot.operationalLockPath)) !== currentGowmSnapshot.operationalLockSha256 ||
    hash(currentGowmPath(currentGowmSnapshot.lockPath)) !== currentGowmSnapshot.lockSha256) {
  throw new Error("CURRENT_GOWM_SNAPSHOT_DRIFT");
}
for (const entry of [...manifest.files, ...Object.entries(currentGowmSnapshot.supportingSchemas).map(([path, value]) => ({path, sha256: value.sha256}))]) {
  if (hash(currentGowmPath("bundle/" + entry.path)) !== entry.sha256) throw new Error("CURRENT_GOWM_MANIFEST_DRIFT");
}

}
verifyCurrentGowmSnapshot();

/** Logical roles remain stable even when upstream moves a published schema. */
export function currentGowmSchemaAlias(schemaPath: string): string {
  const basename = schemaPath.split("/").at(-1)!;
  const family = basename.replace(/-v[\d.]+(?=\.schema\.json)/u, "");
  const candidates = manifest.files.map(entry => entry.path).filter(path => path.startsWith("schemas/") &&
    path.split("/").at(-1)!.replace(/-v[\d.]+(?=\.schema\.json)/u, "") === family);
  if (candidates.length === 0) throw new Error("CURRENT_GOWM_SCHEMA_ROLE_MISSING");
  const version = (p: string): string => p.match(/gowm-v([\d.]+)\//u)?.[1] ?? "0";
  candidates.sort((a, b) => version(a).localeCompare(version(b), "en", {numeric: true}) || a.localeCompare(b, "en", {numeric: true}));
  return candidates.at(-1)!.slice("schemas/".length);
}
