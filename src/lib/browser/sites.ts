// Where a teammate's browser may go (docs/plans/ai-teammates-phase4.md
// Decisions 9 and 10). One pure rule, read by the settings routes when a site
// is added (parseSiteEntry), by block 2 (effectiveSites), and by the driver's
// guard on every main-frame request, redirects included (siteVerdict).
//
// THE LISTS. A workspace allow list (Owners and Admins) is the ceiling; each
// teammate's own list is chosen from it; the workspace block list always
// wins; all start empty. A teammate may open a host only when it matches the
// teammate's list and the workspace list and no block entry. An entry is a
// host: "example.com" matches it and "www.example.com"; "*.example.com"
// matches it and every subdomain. A pasted address is reduced to its host.
//
// NEVER, whatever the lists say (neverReason): an IP literal in any notation
// (the URL parser turns "0x7f.1" and "2130706433" into 127.0.0.1, so they
// are caught as one), a single-label host, the names that only a private
// resolver answers (localhost and *.localhost, *.local, *.internal,
// *.home.arpa and the rest of NEVER_SUFFIXES), the app's own hosts and
// workwrk.com with every subdomain. The provider's browser runs in its cloud:
// a private name reaches whatever that network answers for it, such as a
// metadata service. Pages open over https on the default port only, with no
// user name or password in the address.
//
// THE STAND-IN (Decision 2). Only when the stand-in provider runs, outside
// production, hosts under FIXTURE_SUFFIX are not "never" and may load over
// http; production never sets the suffix (browser/config.ts siteRulesFor).
// The settings routes pass the same suffix to parseSiteEntry, from the
// stand-in's config only, so its fixture sites can be put on a list (review
// of Phase 4 step 1).
//
// STRANGERS' SITES (review of Phase 4 step 1). A wildcard over a name where
// anyone may own a site ("*.co.uk", "*.github.io", "*.herokuapp.com") is
// refused (public-suffixes.ts wildcardTooBroad), and the guard never honours
// one an allow list holds anyway. Wildcard DNS names, under which any
// address is a name ("10.0.0.8.nip.io"), are never opened at all.
//
// Pure: the URL parser and the curated suffix list, nothing else.

import { isWildcardDnsHost, wildcardTooBroad } from "./public-suffixes";

/** Why a site entry was refused (teammate-copy.ts BROWSER_POLICY_COPY.SITE_PROBLEM_WORDS, step 2). */
export type SiteProblem = "invalid" | "ip" | "internal" | "app" | "port" | "credentials" | "wildcard" | "too_long";

/** The stand-in's fixture sites (scripts/browser-stand-in.mjs): docs.proof.test, shop.proof.test. */
export const FIXTURE_SUFFIX = ".proof.test";

/** The longest entry or address read at all: anything longer is no site a person pastes. */
const RAW_MAX = 2000;

/** A host's longest length and a label's (RFC 1035). */
const HOST_MAX = 253;
const LABEL_MAX = 63;

/** A label as DNS names it, with "_" allowed: letters, digits and hyphens, never a hyphen at either end. */
const LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;

/**
 * Names only a private resolver answers: a host that is one of these or ends
 * with "." and one of them is never opened. The spec's list (localhost,
 * local, internal, home.arpa, lan, corp, intranet) and, toward the safer
 * side, the other names that never resolve on the public internet: the
 * reserved test, example and invalid names (RFC 2606 and 6761), every
 * arpa name, localdomain, onion, and the never-delegated home and private.
 */
const NEVER_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "corp",
  "home",
  "private",
  "arpa",
  "test",
  "example",
  "invalid",
  "onion",
];

/** WorkwrK's own domain: never opened, with every subdomain, wherever the app runs. */
const WORKWRK_DOMAIN = "workwrk.com";

/** A host as compared everywhere: lower case, one trailing dot dropped. */
function normalHost(h: string): string {
  const lower = h.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/** Whether `host` is `base` or a subdomain of it. */
function underOrAt(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * An IP literal, in any notation a host can carry: bracketed or bare IPv6,
 * dotted IPv4, and, for a host no URL parser normalised, a last label that is
 * all digits or hexadecimal (no top-level domain is), which the parser would
 * read as an address.
 */
function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true;
  if (/^[0-9.]+$/.test(host)) return true;
  const last = host.split(".").pop() ?? "";
  return /^(?:[0-9]+|0x[0-9a-f]*)$/i.test(last);
}

/** Every label 1 to 63 of the allowed letters, and the whole at most 253. */
function hostShape(host: string): "ok" | "invalid" | "too_long" {
  if (!host) return "invalid";
  if (host.length > HOST_MAX) return "too_long";
  for (const label of host.split(".")) {
    if (label.length === 0) return "invalid";
    if (label.length > LABEL_MAX) return "too_long";
    if (!LABEL.test(label)) return "invalid";
  }
  return "ok";
}

/**
 * Why a host is never opened, or null. `fixtureSuffix` is set only for the
 * stand-in (Decision 2): a host under it is a fixture and is never refused
 * here.
 */
export function neverReason(host: string, o: { appHosts: readonly string[]; fixtureSuffix: string | null }): "ip" | "internal" | "app" | null {
  const h = normalHost(host);
  if (o.fixtureSuffix && h.length > o.fixtureSuffix.length && h.endsWith(o.fixtureSuffix)) return null;
  if (isIpLiteral(h)) return "ip";
  if (!h.includes(".")) return "internal";
  if (NEVER_SUFFIXES.some((s) => underOrAt(h, s))) return "internal";
  // Any address is a name under these, a private one included (review of Phase 4 step 1).
  if (isWildcardDnsHost(h)) return "internal";
  if (underOrAt(h, WORKWRK_DOMAIN)) return "app";
  for (const raw of o.appHosts) {
    const app = normalHost(raw);
    if (app && underOrAt(h, app)) return "app";
  }
  return null;
}

/**
 * The URL's host, lower case with one trailing dot dropped; null when it is
 * not a URL, has no host (about:blank, data:), or the host has an empty
 * label. An IPv6 host keeps its brackets.
 */
export function siteOf(url: string): string | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 8192) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.hostname) return null;
  const h = normalHost(u.hostname);
  if (!h || (!h.startsWith("[") && h.split(".").some((l) => l.length === 0))) return null;
  return h;
}

/**
 * A site entry as an Owner, an Admin or a teammate's manager typed or pasted
 * it, as it is stored: "example.com" or "*.example.com". Trimmed and lower
 * case; a pasted address gives its host; an international name its ASCII
 * form; a star only as "*." before a name one owner holds, never before a
 * public suffix ("*.co.uk", "*.github.io", review of Phase 4 step 1).
 * `fixtureSuffix` is set only from the stand-in's config, as siteRulesFor
 * sets it, so the stand-in's fixture sites can be listed (review of Phase 4
 * step 1); production never sets it.
 */
export function parseSiteEntry(
  raw: string,
  o: { appHosts: readonly string[]; fixtureSuffix?: string | null },
): { ok: true; entry: string } | { ok: false; problem: SiteProblem } {
  if (typeof raw !== "string") return { ok: false, problem: "invalid" };
  const s = raw.trim().toLowerCase();
  if (!s) return { ok: false, problem: "invalid" };
  if (s.length > RAW_MAX) return { ok: false, problem: "too_long" };
  const withScheme = s.includes("://") ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, problem: s.includes("*") ? "wildcard" : "invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, problem: "invalid" };
  if (u.username || u.password) return { ok: false, problem: "credentials" };
  if (u.port) return { ok: false, problem: "port" };
  let host = normalHost(u.hostname);
  if (isIpLiteral(host)) return { ok: false, problem: "ip" };
  let wildcard = false;
  if (host.startsWith("*.")) {
    wildcard = true;
    host = host.slice(2);
  }
  if (host.includes("*")) return { ok: false, problem: "wildcard" };
  const shape = hostShape(host);
  if (shape !== "ok") return { ok: false, problem: shape };
  // "*." only before a name one owner holds: "*.com", "*.co.uk" and
  // "*.github.io" would be every stranger's site there (review of Phase 4 step 1).
  if (wildcard && wildcardTooBroad(host)) return { ok: false, problem: "wildcard" };
  const never = neverReason(host, { appHosts: o.appHosts, fixtureSuffix: o.fixtureSuffix ?? null });
  if (never) return { ok: false, problem: never };
  return { ok: true, entry: wildcard ? `*.${host}` : host };
}

/**
 * Whether an entry covers a host: "example.com" covers it and
 * "www.example.com"; "*.example.com" covers it and every subdomain.
 */
export function entryMatches(entry: string, host: string): boolean {
  if (typeof entry !== "string" || typeof host !== "string") return false;
  const e = normalHost(entry.trim());
  const h = normalHost(host);
  if (!e || !h) return false;
  if (e.startsWith("*.")) {
    const base = e.slice(2);
    return base.length > 0 && underOrAt(h, base);
  }
  return h === e || h === `www.${e}`;
}

/** What one teammate's browser obeys: the lists, the app's own hosts, and the stand-in's allowances. */
export interface SiteRules {
  allow: readonly string[];
  block: readonly string[];
  appHosts: readonly string[];
  schemes: readonly ("https:" | "http:")[];
  fixtureSuffix: string | null;
}

export type SiteVerdict =
  | { ok: true; site: string }
  | { ok: false; code: "bad_url" | "not_https" | "port" | "credentials" | "never" | "blocked" | "not_allowed"; site: string | null };

/**
 * Whether the browser may go to this address, decided before the request
 * leaves (Decision 10), in order: it must be a URL; https (http only for a
 * stand-in fixture); the default port; no user name or password; never a
 * private, internal or WorkwrK host; then the block list, which always wins;
 * then the allow list.
 */
export function siteVerdict(url: string, r: SiteRules): SiteVerdict {
  if (typeof url !== "string" || url.length === 0 || url.length > 8192) return { ok: false, code: "bad_url", site: null };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, code: "bad_url", site: null };
  }
  const site = siteOf(url);
  const fixture = Boolean(r.fixtureSuffix && site && site.length > r.fixtureSuffix.length && site.endsWith(r.fixtureSuffix));
  const schemeOk = (u.protocol === "https:" && r.schemes.includes("https:")) || (u.protocol === "http:" && r.schemes.includes("http:") && fixture);
  if (!schemeOk) return { ok: false, code: "not_https", site };
  if (u.port) return { ok: false, code: "port", site };
  if (u.username || u.password) return { ok: false, code: "credentials", site };
  if (!site) return { ok: false, code: "bad_url", site: null };
  if (neverReason(site, { appHosts: r.appHosts, fixtureSuffix: r.fixtureSuffix })) return { ok: false, code: "never", site };
  if (r.block.some((b) => entryMatches(b, site))) return { ok: false, code: "blocked", site };
  if (r.allow.some((a) => honouredAllow(a) && entryMatches(a, site))) return { ok: true, site };
  return { ok: false, code: "not_allowed", site };
}

/**
 * Whether an allow entry is one the guard honours: never a wildcard over
 * strangers' sites, however it reached a list (review of Phase 4 step 1:
 * parseSiteEntry refuses one, and a list written before that, or by hand,
 * still opens nothing through it). A block entry always counts.
 */
function honouredAllow(entry: string): boolean {
  if (typeof entry !== "string") return false;
  const e = normalHost(entry.trim());
  return !e.startsWith("*.") || !wildcardTooBroad(e.slice(2));
}

/** A workspace's two lists (TeammateBrowserPolicy.allowSites and blockSites). */
export interface WorkspaceSites {
  allow: readonly string[];
  block: readonly string[];
}

/** A workspace with no policy row: no site allowed, none blocked. */
export const NO_WORKSPACE_SITES: WorkspaceSites = { allow: [], block: [] };

/**
 * Whether a string is a plain host name as a start site is one (review of
 * Phase 5 step 3, the Teach message's site): labels of letters, digits,
 * hyphens and underscores between dots, at least two, never an IP literal,
 * a "*", a port, a path, a query, a fragment or a backslash.
 */
export function isPlainHost(host: string): boolean {
  if (typeof host !== "string" || !host.includes(".")) return false;
  return hostShape(host) === "ok" && !isIpLiteral(host);
}

/** An entry's own host: "*.example.com" and "example.com" are both "example.com" (exported for Teach a skill's start sites, Phase 5 step 3). */
export function entryBase(entry: string): string {
  const e = normalHost(entry.trim());
  return e.startsWith("*.") ? e.slice(2) : e;
}

/**
 * The sites a teammate may open now: its own entries that are also on the
 * workspace allow list (exactly, as the picker offers them), less any the
 * block list matches, each once, sorted. An entry whose own host a block
 * entry covers goes whole, a wildcard included: the block list always wins,
 * and the guard holds the rest of the block list on every request anyway.
 * A wildcard over strangers' sites the guard never honours is never one of
 * them (review of Phase 4 step 1).
 */
export function effectiveSites(teammate: readonly string[], workspace: WorkspaceSites): string[] {
  const allowed = new Set((workspace.allow ?? []).filter((a) => typeof a === "string" && honouredAllow(a)).map((a) => normalHost(a.trim())));
  const out = new Set<string>();
  for (const raw of teammate ?? []) {
    if (typeof raw !== "string") continue;
    const entry = normalHost(raw.trim());
    if (!entry || !allowed.has(entry)) continue;
    const base = entryBase(entry);
    if ((workspace.block ?? []).some((b) => entryMatches(b, base))) continue;
    out.add(entry);
  }
  return [...out].sort();
}

/**
 * Whether some host is covered by both entries: a bare entry covers itself
 * and its www, a wildcard its base and every name under it.
 */
function entriesOverlap(a: string, b: string): boolean {
  const aWild = a.startsWith("*.");
  const bWild = b.startsWith("*.");
  const aBase = entryBase(a);
  const bBase = entryBase(b);
  if (aWild && bWild) return underOrAt(aBase, bBase) || underOrAt(bBase, aBase);
  if (!aWild) return [aBase, `www.${aBase}`].some((h) => entryMatches(b, h));
  return [bBase, `www.${bBase}`].some((h) => entryMatches(a, h));
}

/** How a block entry is written in the reach, so a host allowed and the same host blocked are two entries. */
const BLOCKED_MARK = "!";

/**
 * Where a teammate's browser can really go, as a Google allow's "sites" part
 * prints it (teammate-print.ts sitesPrint, review of Phase 4 step 1): the
 * teammate's own entries the workspace allow list holds (exactly, as
 * effectiveSites keeps them), and every workspace block entry that covers
 * some host one of them covers (in either direction: a narrower block inside
 * a wildcard, or a wider one over an entry), each written "!" and the entry.
 * Sorted, each once. So an Owner or Admin who adds a teammate's entry back
 * to the workspace list, or takes away a block entry inside its reach,
 * changes it, and an entry the workspace list does not hold changes
 * nothing, since the teammate cannot go there. No policy row (no lists):
 * an empty reach for every teammate, the print every allow kept before
 * Phase 4 reads as (EMPTY_SITES_PRINT).
 */
export function reachPrintInput(teammateSites: readonly unknown[], workspace: WorkspaceSites): string[] {
  const norm = (list: readonly unknown[] | undefined) => (list ?? []).filter((x): x is string => typeof x === "string").map((x) => normalHost(x.trim())).filter(Boolean);
  const allowed = new Set(norm(workspace.allow).filter(honouredAllow));
  const held = [...new Set(norm(teammateSites).filter((e) => allowed.has(e)))];
  const out = new Set<string>(held);
  for (const b of new Set(norm(workspace.block))) {
    if (held.some((e) => entriesOverlap(e, b))) out.add(`${BLOCKED_MARK}${b}`);
  }
  return [...out].sort();
}

/**
 * The app's own hosts, never opened by a teammate: NEXT_PUBLIC_APP_URL's and
 * NEXTAUTH_URL's, ADMIN_HOST (the staff back office, a host or a URL), and
 * workwrk.com, which neverReason also matches with every subdomain.
 */
export function appHostsFrom(env: NodeJS.ProcessEnv): string[] {
  const out = new Set<string>([WORKWRK_DOMAIN]);
  for (const v of [env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL, env.ADMIN_HOST]) {
    if (typeof v !== "string" || !v.trim()) continue;
    const t = v.trim();
    const host = siteOf(t.includes("://") ? t : `https://${t}`);
    if (host) out.add(host);
  }
  return [...out];
}
