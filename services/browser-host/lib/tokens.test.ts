import { describe, expect, it } from "vitest";

import { connectToken, newBootKey, redeemConnect, verifyConnect } from "./tokens.mjs";

const A = "6f1c2a7e-6d0b-4a39-9a51-0d5c3a1e9b11";
const B = "0b8e5d42-1f5a-4c7e-8b6d-2a9f4e3c7d22";

describe("the connect token (3.3)", () => {
  it("verifies for its own session, and is good once", () => {
    const key = newBootKey();
    const s = { id: A, connected: false };
    const t = connectToken(key, A);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyConnect(key, A, t)).toBe(true);
    expect(redeemConnect(key, s, t)).toBe("ok");
    expect(s.connected).toBe(true);
    expect(redeemConnect(key, s, t)).toBe("used");
  });

  it("refuses another session's token, a tampered one and any other value", () => {
    const key = newBootKey();
    const s = { id: A, connected: false };
    const theirs = connectToken(key, B);
    expect(verifyConnect(key, A, theirs)).toBe(false);
    expect(redeemConnect(key, s, theirs)).toBe("invalid");
    const t = connectToken(key, A);
    const flipped = `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`;
    for (const bad of [flipped, `${t}x`, t.slice(0, -1), "", null, undefined, 42]) expect(redeemConnect(key, s, bad)).toBe("invalid");
    expect(s.connected).toBe(false);
  });

  it("is void after a restart: another boot's key", () => {
    expect(verifyConnect(newBootKey(), A, connectToken(newBootKey(), A))).toBe(false);
  });
});
