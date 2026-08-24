import { describe, expect, it } from "vitest";
import { InvalidCursorError, SignedCursorCodec } from "./signed-cursor.js";

describe("scope-bound signed cursor", () => {
  it("round-trips only within the issuing scope and TTL", () => {
    let now = 1_000;
    const codec = new SignedCursorCodec({ key: new Uint8Array(32).fill(7), ttlMs: 500, now: () => now });
    const cursor = codec.encode("scope-a", "position-42");
    expect(codec.decode("scope-a", cursor)).toBe("position-42");
    expect(() => codec.decode("scope-b", cursor)).toThrow(InvalidCursorError);
    now = 1_501;
    expect(() => codec.decode("scope-a", cursor)).toThrow(InvalidCursorError);
  });

  it("rejects tampering and malformed input with one opaque error", () => {
    const codec = new SignedCursorCodec({ key: new Uint8Array(32).fill(9), ttlMs: 500 });
    const cursor = codec.encode("scope-a", "position-42");
    expect(() => codec.decode("scope-a", `${cursor}x`)).toThrow(InvalidCursorError);
    expect(() => codec.decode("scope-a", "not-a-cursor")).toThrow(InvalidCursorError);
  });
});
