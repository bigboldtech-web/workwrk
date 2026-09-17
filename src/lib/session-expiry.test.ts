import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  draftKey,
  idleWarningDelayMs,
  IDLE_WARNING_LEAD_MS,
  isDraftStale,
  isSessionExpired,
  loginUrlFor,
  markSessionExpired,
  readDraft,
  resetSessionExpired,
  saveDraft,
  type DraftStore,
} from "./session-expiry";

function memoryStore(): DraftStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("loginUrlFor", () => {
  it("preserves pathname and search in callbackUrl", () => {
    expect(loginUrlFor("/boards/sales", "?item=abc")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/boards/sales?item=abc")}`,
    );
  });
  it("accepts a search string without the leading question mark", () => {
    expect(loginUrlFor("/inbox", "tab=mentions")).toBe(`/login?callbackUrl=${encodeURIComponent("/inbox?tab=mentions")}`);
  });
  it("keeps the fragment (fields are addressable) inside the encoded callback", () => {
    expect(loginUrlFor("/account/preferences", "?tab=locale", "#timezone")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/account/preferences?tab=locale#timezone")}`,
    );
    expect(loginUrlFor("/docs/d1", "", "heading-2")).toBe(`/login?callbackUrl=${encodeURIComponent("/docs/d1#heading-2")}`);
    expect(loginUrlFor("/inbox", "", "")).toBe(`/login?callbackUrl=${encodeURIComponent("/inbox")}`);
  });
  it("never loops through auth pages or the root", () => {
    expect(loginUrlFor("/login", "?callbackUrl=%2Ftoday")).toBe("/login");
    expect(loginUrlFor("/register")).toBe("/login");
    expect(loginUrlFor("/")).toBe("/login");
    expect(loginUrlFor("")).toBe("/login");
  });
});

describe("markSessionExpired", () => {
  beforeEach(() => resetSessionExpired());
  it("flags once and reports repeat calls as no-ops", () => {
    expect(isSessionExpired()).toBe(false);
    expect(markSessionExpired({ reason: "revoked" })).toBe(true);
    expect(isSessionExpired()).toBe(true);
    expect(markSessionExpired()).toBe(false);
    resetSessionExpired();
    expect(isSessionExpired()).toBe(false);
  });
});

describe("drafts", () => {
  it("keys as workwrk:draft:{kind}:{id}", () => {
    expect(draftKey("doc", "d1")).toBe("workwrk:draft:doc:d1");
  });
  it("round-trips a draft and clears it", () => {
    const store = memoryStore();
    expect(saveDraft("notepad", "me", { text: "hello" }, { store })).toBe(true);
    const back = readDraft<{ text: string }>("notepad", "me", { store });
    expect(back?.value).toEqual({ text: "hello" });
    expect(typeof back?.savedAt).toBe("string");
    expect(back?.baseVersion).toBeUndefined();
    clearDraft("notepad", "me", { store });
    expect(readDraft("notepad", "me", { store })).toBeNull();
  });
  it("keeps the server base version the draft was taken from", () => {
    const store = memoryStore();
    saveDraft("doc", "d1", { body: "x" }, { store, baseVersion: "2026-09-17T10:00:00.000Z" });
    expect(readDraft("doc", "d1", { store })?.baseVersion).toBe("2026-09-17T10:00:00.000Z");
    saveDraft("sheet", "s1", { cells: [] }, { store, baseVersion: 42 });
    expect(readDraft("sheet", "s1", { store })?.baseVersion).toBe(42);
    saveDraft("canvas", "c1", { shapes: [] }, { store, baseVersion: null });
    expect(readDraft("canvas", "c1", { store })?.baseVersion).toBeNull();
  });
  it("tolerates a missing store and a corrupt entry", () => {
    expect(saveDraft("doc", "x", 1, { store: null })).toBe(false);
    expect(readDraft("doc", "x", { store: null })).toBeNull();
    const store = memoryStore();
    store.setItem(draftKey("doc", "bad"), "{not json");
    expect(readDraft("doc", "bad", { store })).toBeNull();
  });
  it("still reads a draft written before base versions existed", () => {
    const store = memoryStore();
    store.setItem(draftKey("doc", "old"), JSON.stringify({ savedAt: "2026-09-01T00:00:00.000Z", value: { body: "y" } }));
    const d = readDraft<{ body: string }>("doc", "old", { store });
    expect(d?.value).toEqual({ body: "y" });
    expect(isDraftStale(d, "2026-09-02T00:00:00.000Z")).toBe(false);
  });
});

describe("isDraftStale", () => {
  const draft = { baseVersion: "2026-09-17T10:00:00.000Z" };
  it("is stale when the server has moved on since the draft", () => {
    expect(isDraftStale(draft, "2026-09-17T11:00:00.000Z")).toBe(true);
    expect(isDraftStale(draft, new Date("2026-09-17T11:00:00.000Z"))).toBe(true);
    expect(isDraftStale({ baseVersion: 3 }, 4)).toBe(true);
    expect(isDraftStale({ baseVersion: "etag-a" }, "etag-b")).toBe(true);
  });
  it("is fresh when the versions match, in any spelling of the same instant", () => {
    expect(isDraftStale(draft, "2026-09-17T10:00:00.000Z")).toBe(false);
    expect(isDraftStale(draft, "2026-09-17T10:00:00Z")).toBe(false);
    expect(isDraftStale(draft, new Date("2026-09-17T10:00:00.000Z"))).toBe(false);
    expect(isDraftStale({ baseVersion: 3 }, 3)).toBe(false);
    expect(isDraftStale({ baseVersion: 3 }, "3")).toBe(false);
  });
  it("never calls an unknown version stale (the editor decides)", () => {
    expect(isDraftStale(null, "x")).toBe(false);
    expect(isDraftStale({ baseVersion: null }, "x")).toBe(false);
    expect(isDraftStale({}, "x")).toBe(false);
    expect(isDraftStale(draft, null)).toBe(false);
    expect(isDraftStale(draft, undefined)).toBe(false);
  });
});

describe("idleWarningDelayMs", () => {
  const now = Date.parse("2026-09-17T10:00:00.000Z");
  it("fires two minutes before idleUntil", () => {
    const idleUntil = new Date(now + 10 * 60 * 1000).toISOString();
    expect(idleWarningDelayMs(idleUntil, now)).toBe(10 * 60 * 1000 - IDLE_WARNING_LEAD_MS);
  });
  it("fires immediately when already inside the lead window", () => {
    const idleUntil = new Date(now + 30 * 1000).toISOString();
    expect(idleWarningDelayMs(idleUntil, now)).toBe(0);
  });
  it("is absent when there is no timeout, it is unparseable, or it has passed", () => {
    expect(idleWarningDelayMs(null, now)).toBeNull();
    expect(idleWarningDelayMs(undefined, now)).toBeNull();
    expect(idleWarningDelayMs("nope", now)).toBeNull();
    expect(idleWarningDelayMs(new Date(now - 1000).toISOString(), now)).toBeNull();
  });
});
