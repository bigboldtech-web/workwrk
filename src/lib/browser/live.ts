// The browsers this server process holds (docs/plans/ai-teammates-phase4.md
// Decision 7): each session's driver handle, with its navigation guard,
// lives only here. A session whose bootId is not this process's BOOT_ID (a
// restart), or that has no entry here, has lost its guard and is ended,
// never reattached (sessions.ts useBrowserSession and the sweep).
//
// Kept on globalThis, so a dev server's hot reload of this module keeps the
// registry and its BOOT_ID; a real restart starts both afresh.
//
// ONE STEP AT A TIME PER BROWSER (withBrowserLock). Every call that drives a
// browser (a tool call, an approval, a take over starting) holds its lock, so
// two never drive one page at once; a caller that waits past its limit gets
// { busy: true } and drives nothing.
//
// RULES BY VERSION (review of Phase 4 step 3). A call reads the computer's
// access (its rules) before it takes the lock, and a list change between
// that read and the lock installed newer rules (sessions.ts
// refreshLiveRules), which the call then put back. Now every refresh starts
// a new version (nextRulesVersion), every access read carries the version it
// began at (sessions.ts computerAccess), a browser holds the version of its
// rules (rulesVersion), rules are installed only when not older
// (installRules), and a call whose read is older than the browser's rules or
// than the newest refresh begun reads them again under the lock
// (callRulesCurrent).
//
// Server-only: holds live connections.

import { randomUUID } from "node:crypto";
import type { SiteRules } from "./sites";
import type { BrowserHandle, ElementFingerprint } from "./types";

/** The most links a session remembers for open_page (Decision 11): the oldest go first. */
export const LINKS_MAX = 2000;
/** The most notes waiting for the next result (a dialog closed, a popup, a refused hop). */
export const EVENTS_MAX = 10;

export interface LiveBrowser {
  rowId: string;
  organizationId: string;
  userId: string;
  agentId: string;
  handle: BrowserHandle;
  /** What the guard obeys now: read by every request it pauses, replaced whenever the lists change (sessions.ts refreshLiveRules). */
  rules: SiteRules;
  /** The version `rules` were read at (see the header, review of Phase 4 step 3). */
  rulesVersion: number;
  /** Exact links reads in this session showed (Decision 11). */
  links: Set<string>;
  /** The latest read's ids, valid only while the page is still at refsUrl. */
  refs: Map<string, ElementFingerprint>;
  refsUrl: string | null;
  seq: number;
  /** The connection went: every later call ends the session. */
  lost: boolean;
  /** What the hooks saw since the last call, for the next result's note. */
  events: string[];
}

interface Registry {
  boot: string;
  live: Map<string, LiveBrowser>;
  tails: Map<string, Promise<void>>;
  /** The newest rules version begun in this process (review of Phase 4 step 3); absent in a registry a hot reload kept from before. */
  rulesVersion?: number;
}

const g = globalThis as typeof globalThis & { __wkBrowserRegistry?: Registry };
const registry: Registry = (g.__wkBrowserRegistry ??= { boot: randomUUID(), live: new Map(), tails: new Map(), rulesVersion: 0 });

/** This server process, as a session row names the process holding its guard. */
export const BOOT_ID: string = registry.boot;

export function liveBrowser(rowId: string): LiveBrowser | null {
  return registry.live.get(rowId) ?? null;
}

export function putLiveBrowser(lb: LiveBrowser): void {
  registry.live.set(lb.rowId, lb);
}

/** Every browser this process holds that `keep` says (a workspace's, a teammate's). */
export function liveBrowsersWhere(keep: (lb: LiveBrowser) => boolean): LiveBrowser[] {
  return [...registry.live.values()].filter(keep);
}

/** Forget the browser and close its connection (the provider ends a keepAlive false browser then too). */
export async function dropLiveBrowser(rowId: string): Promise<void> {
  const lb = registry.live.get(rowId);
  if (!lb) return;
  registry.live.delete(rowId);
  try {
    await lb.handle.close();
  } catch {
    /* already gone */
  }
}

/** The newest rules version begun in this process (see the header). */
export function rulesVersionNow(): number {
  return registry.rulesVersion ?? 0;
}

/** A refresh of the rules begins (sessions.ts refreshLiveRules): every access read older than this is stale. */
export function nextRulesVersion(): number {
  registry.rulesVersion = rulesVersionNow() + 1;
  return registry.rulesVersion;
}

/** Give the guard rules read at `version`, unless it holds newer ones (see the header). Answers whether they were installed. */
export function installRules(lb: LiveBrowser, rules: SiteRules, version: number): boolean {
  const v = Number.isInteger(version) ? version : -1;
  if (v < lb.rulesVersion) return false;
  lb.rules = rules;
  lb.rulesVersion = v;
  return true;
}

/** Whether a call's own access read, begun at `version`, is no older than the browser's rules and every refresh begun since (see the header). */
export function callRulesCurrent(lb: LiveBrowser, version: number): boolean {
  const v = Number.isInteger(version) ? version : -1;
  return v >= lb.rulesVersion && v >= rulesVersionNow();
}

/** Remember links a read showed, the oldest forgotten past LINKS_MAX. */
export function rememberLinks(lb: LiveBrowser, links: readonly string[]): void {
  for (const l of links) {
    if (typeof l !== "string" || !l) continue;
    lb.links.delete(l);
    lb.links.add(l);
  }
  while (lb.links.size > LINKS_MAX) {
    const oldest = lb.links.values().next().value;
    if (oldest === undefined) break;
    lb.links.delete(oldest);
  }
}

/** Keep a note for the next result, at most EVENTS_MAX, each once. */
export function noteEvent(lb: LiveBrowser | null, note: string): void {
  if (!lb || !note) return;
  if (lb.events.includes(note)) return;
  lb.events.push(note);
  if (lb.events.length > EVENTS_MAX) lb.events.splice(0, lb.events.length - EVENTS_MAX);
}

/** The notes since the last call, emptied. */
export function takeEvents(lb: LiveBrowser): string[] {
  return lb.events.splice(0);
}

/**
 * Run `fn` with this browser, one caller at a time (see the header).
 * `{ busy: true }` when the wait passes `waitMs`; `{ gone: true }` when the
 * browser is no longer held here once it is this caller's turn.
 */
export async function withBrowserLock<T>(rowId: string, waitMs: number, fn: (lb: LiveBrowser) => Promise<T>): Promise<T | { busy: true } | { gone: true }> {
  if (!registry.live.has(rowId)) return { gone: true };
  const before = registry.tails.get(rowId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = before.then(() => mine);
  registry.tails.set(rowId, tail);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const turn = await Promise.race([
    before.then(() => true),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), Math.max(0, waitMs));
    }),
  ]);
  if (timer) clearTimeout(timer);
  const done = () => {
    release();
    if (registry.tails.get(rowId) === tail) registry.tails.delete(rowId);
  };
  if (!turn) {
    // Our place in the line passes on as soon as the one before ends.
    void before.then(done);
    return { busy: true };
  }
  try {
    const lb = registry.live.get(rowId);
    if (!lb) return { gone: true };
    return await fn(lb);
  } finally {
    done();
  }
}

/** Tests only: forget every browser and lock, closing nothing. */
export function resetLiveRegistryForTests(): void {
  registry.live.clear();
  registry.tails.clear();
  registry.rulesVersion = 0;
}
