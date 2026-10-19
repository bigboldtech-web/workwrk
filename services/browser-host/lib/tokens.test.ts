import { describe, expect, it } from "vitest";

import { CONTROL_MS, connectToken, liveTokenHash, mintLive, newBootKey, redeemConnect, verifyConnect, verifyLive, WATCH_GRACE_MS, WATCH_MAX_MS } from "./tokens.mjs";

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

describe("the live token (3.3)", () => {
  const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
  const END = NOW + 16 * 60_000;
  const mint = (key: Buffer, mode: "watch" | "control", over: Partial<{ id: string; nowMs: number; sessionEndMs: number; epoch: number; controlMs: number }> = {}) =>
    mintLive(key, { id: A, mode, nowMs: NOW, sessionEndMs: END, epoch: 0, ...over });
  const payloadOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));

  it("carries its mode, and verifies for its own session only", () => {
    const key = newBootKey();
    const w = mint(key, "watch");
    const c = mint(key, "control");
    expect(verifyLive(key, w.token, { id: A, nowMs: NOW, epoch: 0 })).toEqual({ ok: true, mode: "watch", exp: w.exp });
    expect(verifyLive(key, c.token, { id: A, nowMs: NOW, epoch: 0 })).toEqual({ ok: true, mode: "control", exp: c.exp });
    // Another session's path.
    expect(verifyLive(key, w.token, { id: B, nowMs: NOW, epoch: 0 })).toEqual({ ok: false, reason: "invalid" });
    // Another boot.
    expect(verifyLive(newBootKey(), w.token, { id: A, nowMs: NOW, epoch: 0 })).toEqual({ ok: false, reason: "invalid" });
  });

  it("its payload's keys are exactly s, m, e, g, n, and it says nothing of the person", () => {
    const key = newBootKey();
    const { token } = mint(key, "control", { epoch: 3 });
    const p = payloadOf(token);
    expect(Object.keys(p)).toEqual(["s", "m", "e", "g", "n"]);
    expect(p).toMatchObject({ s: A, m: "c", g: 3 });
    expect(Buffer.from(p.n, "base64url")).toHaveLength(16);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    // Two mints are never the same token.
    expect(mint(key, "control", { epoch: 3 }).token).not.toBe(token);
  });

  it("is refused when tampered with: a flipped payload, a flipped mac, a re-signed mode, extra keys", () => {
    const key = newBootKey();
    const { token } = mint(key, "watch");
    const [payload, mac] = token.split(".");
    const asControl = Buffer.from(JSON.stringify({ ...payloadOf(token), m: "c" })).toString("base64url");
    const extra = Buffer.from(JSON.stringify({ ...payloadOf(token), x: 1 })).toString("base64url");
    const flip = (s: string) => `${s.slice(0, -1)}${s.endsWith("A") ? "B" : "A"}`;
    for (const bad of [`${flip(payload)}.${mac}`, `${payload}.${flip(mac)}`, `${asControl}.${mac}`, `${extra}.${mac}`, `${payload}.${mac}.x`, payload, `${payload}.`, "", null, 42, "a".repeat(2000)]) {
      expect(verifyLive(key, bad, { id: A, nowMs: NOW, epoch: 0 })).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("a control token is void once the epoch moves (revoke); a watch token is not", () => {
    const key = newBootKey();
    const c = mint(key, "control", { epoch: 0 });
    const w = mint(key, "watch", { epoch: 0 });
    expect(verifyLive(key, c.token, { id: A, nowMs: NOW, epoch: 1 })).toEqual({ ok: false, reason: "revoked" });
    expect(verifyLive(key, w.token, { id: A, nowMs: NOW, epoch: 1 })).toMatchObject({ ok: true, mode: "watch" });
    expect(verifyLive(key, mint(key, "control", { epoch: 1 }).token, { id: A, nowMs: NOW, epoch: 1 })).toMatchObject({ ok: true, mode: "control" });
  });

  it("expires at e, by the clock that minted it", () => {
    const key = newBootKey();
    const c = mint(key, "control");
    expect(verifyLive(key, c.token, { id: A, nowMs: c.exp * 1000 - 1, epoch: 0 })).toMatchObject({ ok: true });
    expect(verifyLive(key, c.token, { id: A, nowMs: c.exp * 1000, epoch: 0 })).toEqual({ ok: false, reason: "expired" });
  });

  it("a watch token lives until the session's end plus 60 seconds, at most 2 hours; a control one 15 minutes, never past that end", () => {
    const key = newBootKey();
    expect(mint(key, "watch").exp).toBe(Math.floor((END + WATCH_GRACE_MS) / 1000));
    expect(mint(key, "watch", { sessionEndMs: NOW + 6 * 60 * 60_000 }).exp).toBe(Math.floor((NOW + WATCH_MAX_MS) / 1000));
    expect(CONTROL_MS).toBe(15 * 60_000);
    expect(mint(key, "control").exp).toBe(Math.floor((NOW + CONTROL_MS) / 1000));
    // A session that ends in 5 minutes: the control token ends with its watch token, at its end plus 60 seconds.
    const soon = NOW + 5 * 60_000;
    expect(mint(key, "control", { sessionEndMs: soon }).exp).toBe(Math.floor((soon + WATCH_GRACE_MS) / 1000));
    expect(mint(key, "control", { sessionEndMs: soon }).exp).toBe(mint(key, "watch", { sessionEndMs: soon }).exp);
    // The test window (BROWSER_HOST_TEST_CONTROL_SECONDS) shortens it.
    expect(mint(key, "control", { controlMs: 8000 }).exp).toBe(Math.floor((NOW + 8000) / 1000));
  });

  it("is kept only as its SHA-256 while a socket uses it", () => {
    const { token } = mint(newBootKey(), "watch");
    expect(liveTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(liveTokenHash(token)).not.toContain(token.slice(0, 8));
  });
});
