// The browsers this process holds (src/lib/browser/live.ts): one BOOT_ID
// per process, one step at a time per browser, a waiter past its limit
// driving nothing, a dropped browser closed, and the links remembered for
// open_page capped with the oldest going first.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_ID,
  LINKS_MAX,
  callRulesCurrent,
  dropLiveBrowser,
  installRules,
  liveBrowser,
  nextRulesVersion,
  noteEvent,
  putLiveBrowser,
  rememberLinks,
  resetLiveRegistryForTests,
  rulesVersionNow,
  takeEvents,
  withBrowserLock,
  type LiveBrowser,
} from "./live";
import type { BrowserHandle } from "./types";

function lb(rowId: string, close = vi.fn(async () => {})): LiveBrowser {
  return {
    rowId,
    organizationId: "org1",
    userId: "u1",
    agentId: "a1",
    handle: { close } as unknown as BrowserHandle,
    rules: { allow: [], block: [], appHosts: [], schemes: ["https:"], fixtureSuffix: null },
    rulesVersion: 0,
    links: new Set(),
    refs: new Map(),
    refsUrl: null,
    seq: 0,
    lost: false,
    events: [],
  };
}

beforeEach(() => resetLiveRegistryForTests());

describe("the registry", () => {
  it("has one BOOT_ID for the process, kept across a reload of the module", async () => {
    expect(BOOT_ID).toMatch(/^[0-9a-f-]{36}$/);
    vi.resetModules();
    const again = await import("./live");
    expect(again.BOOT_ID).toBe(BOOT_ID);
  });

  it("closes a dropped browser and forgets it", async () => {
    const close = vi.fn(async () => {});
    putLiveBrowser(lb("r1", close));
    await dropLiveBrowser("r1");
    expect(close).toHaveBeenCalledTimes(1);
    expect(liveBrowser("r1")).toBeNull();
    await dropLiveBrowser("r1");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("remembers at most LINKS_MAX links, the oldest forgotten first, a link read again kept", () => {
    const b = lb("r1");
    rememberLinks(b, ["https://a.example/0"]);
    rememberLinks(b, Array.from({ length: LINKS_MAX }, (_, i) => `https://a.example/${i + 1}`));
    expect(b.links.size).toBe(LINKS_MAX);
    expect(b.links.has("https://a.example/0")).toBe(false);
    rememberLinks(b, ["https://a.example/1", "https://a.example/new"]);
    expect(b.links.has("https://a.example/1")).toBe(true);
    expect(b.links.has("https://a.example/2")).toBe(false);
  });

  it("keeps each note once, at most ten, and empties them when taken", () => {
    const b = lb("r1");
    for (let i = 0; i < 12; i++) noteEvent(b, `note ${i}`);
    noteEvent(b, "note 11");
    expect(b.events).toHaveLength(10);
    expect(takeEvents(b)[0]).toBe("note 2");
    expect(b.events).toEqual([]);
  });
});

describe("withBrowserLock", () => {
  it("runs one caller at a time, in order", async () => {
    putLiveBrowser(lb("r1"));
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const first = withBrowserLock("r1", 1000, async () => {
      order.push("first in");
      await gate;
      order.push("first out");
      return 1;
    });
    const second = withBrowserLock("r1", 1000, async () => {
      order.push("second");
      return 2;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first in"]);
    open();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(order).toEqual(["first in", "first out", "second"]);
  });

  it("answers busy to a caller that waited past its limit, which drives nothing, and the line goes on", async () => {
    putLiveBrowser(lb("r1"));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const held = withBrowserLock("r1", 1000, async () => gate);
    const ran = vi.fn(async () => "ran");
    expect(await withBrowserLock("r1", 20, ran)).toEqual({ busy: true });
    expect(ran).not.toHaveBeenCalled();
    open();
    await held;
    expect(await withBrowserLock("r1", 100, async () => "after")).toBe("after");
  });

  it("answers gone for a browser not held here, or dropped while waiting", async () => {
    expect(await withBrowserLock("nope", 10, async () => 1)).toEqual({ gone: true });
    putLiveBrowser(lb("r2"));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const held = withBrowserLock("r2", 1000, async () => {
      await gate;
      await dropLiveBrowser("r2");
    });
    const waiting = withBrowserLock("r2", 1000, async () => "drove");
    open();
    await held;
    expect(await waiting).toEqual({ gone: true });
  });
});

describe("the rules by version (review of Phase 4 step 3)", () => {
  const older = { allow: ["old.example.com"], block: [], appHosts: [], schemes: ["https:" as const], fixtureSuffix: null };
  const newer = { allow: ["new.example.com"], block: [], appHosts: [], schemes: ["https:" as const], fixtureSuffix: null };

  it("never puts back rules older than the browser holds", () => {
    const b = lb("r1");
    const read = rulesVersionNow();
    const refresh = nextRulesVersion();
    expect(installRules(b, newer, refresh)).toBe(true);
    // A call that read its rules before the refresh began.
    expect(installRules(b, older, read)).toBe(false);
    expect(b.rules).toBe(newer);
    expect(b.rulesVersion).toBe(refresh);
  });

  it("calls a read stale once a refresh began after it, even before the refresh installed anything", () => {
    const b = lb("r1");
    const read = rulesVersionNow();
    expect(callRulesCurrent(b, read)).toBe(true);
    nextRulesVersion();
    expect(callRulesCurrent(b, read)).toBe(false);
    expect(callRulesCurrent(b, rulesVersionNow())).toBe(true);
    // A version that is no number is never current.
    expect(callRulesCurrent(b, Number.NaN)).toBe(false);
  });
});
