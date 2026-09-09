import { createHash } from "node:crypto";

/** Preserve valid identifiers; bind all other northbound IDs deterministically. */
export function gatewayRequestId(requestId: string): string {
  return /^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u.test(requestId)
    ? requestId
    : `wsgs-${createHash("sha256").update(requestId, "utf8").digest("hex")}`;
}
