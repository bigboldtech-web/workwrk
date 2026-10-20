// The browser provider the computer for AI teammates rents its browsers from
// (docs/plans/ai-teammates-phase4.md Decisions 1, 2, 5, 25, 27 and 34), read
// from the environment.
//
// OFF IN PRODUCTION UNTIL THE FOUNDER CONFIGURES IT (Decision 2).
// browserConfig() is null unless BROWSER_OFFERED=1, BROWSER_PROVIDER,
// BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, BROWSER_REGION,
// BROWSER_SHOTS_DIR and SECRETS_ENCRYPTION_KEY are all set and well formed.
// In production a stand-in (BROWSER_PROVIDER=stand-in, or any
// BROWSERBASE_BASE_URL at all) makes it null: a staging address copied into
// production would receive every browser, its sign-ins with it.
//
// ENDING BROWSERS NEVER DEPENDS ON BROWSER_OFFERED (Decision 2, the Phase 3
// lesson of googleRevokeConfig). browserReleaseConfig() needs only the
// provider, the key and the project, so switching the feature off (or the
// rollback, section 5) still releases every running, billed browser.
//
// THE PICTURES FOLDER (Decision 23) must be absolute and outside the app's
// own folder: the backups archive storage/uploads and public/uploads
// (scripts/backup/backup.sh), and public/ is served to anyone. Toward the
// safer side than the spec's "not inside public/": anywhere in the app's
// folder is refused, so no picture of a person's page is ever served,
// backed up or replaced by a deploy.
//
// THE PICTURES' BUDGET (review round 1 of Phase 4): the pictures kept and
// not yet expired may hold at most BROWSER_SHOTS_MAX_BYTES (default 20 GB)
// across the deployment, and none is written when the folder's disk would be
// left with less than the larger of 10 GB and a tenth of it free (shots.ts):
// the disk is the database's too.
//
// TEACHING BY SHOWING IS OFF UNTIL THE FOUNDER TURNS IT ON
// (docs/plans/ai-teammates-phase5.md Decision 1): skillsOffered() is true only
// when browserConfig() is set and BROWSER_SKILLS_OFFERED=1, so skills appear
// only behind the computer, and never before counsel and the provider have
// answered (its Founder actions 1 and 2). Ending a recording never depends on
// it: a recording is part of a browser session, which ends as Phase 4 ends it.
//
// ONE DEPLOYMENT, ONE TAG (Decision 27). Every provider session is tagged
// with BROWSER_DEPLOYMENT_TAG, and the reaper releases only sessions with this
// deployment's tag. A tag that is set but malformed turns the provider off
// rather than falling back to the default: two deployments sharing one tag
// would each release the other's browsers as orphans.
//
// OUR OWN HOST (docs/plans/browser-host.md Decisions 1, 2 and 14, section
// 9.1). BROWSER_PROVIDER=workwrk talks to BROWSER_HOST_URL with
// BROWSER_HOST_KEY, and needs no BROWSERBASE_* variable. The URL is an
// origin only: no user, password, path, query or fragment. In production it
// is https on the usual port, on a domain of its own: never an app host, never
// workwrk.com or anything under it, never under COOKIE_DOMAIN, never an IP
// literal or an internal name (sites.ts neverReason), since the app's session
// cookie would otherwise reach the server that runs pages from anywhere. The
// key is the install's (at least 32 base64url characters, never "stand-in"),
// and NEXT_PUBLIC_BROWSER_HOST_ORIGIN, the origin the browser card frames,
// equals the URL's. Outside production the URL is https, or http to this
// machine alone, which makes it a local proof provider (`standIn`).
//
// PRODUCTION RUNS ONLY THE DISCLOSED PROVIDER (disclosed.ts, Decision 14):
// browserConfig() is null in production for any provider but
// DISCLOSED_PRODUCTION_PROVIDER, since the privacy page says where browsers
// run. browserReleaseConfig() never reads that rule, so whatever this
// deployment's provider is still has its browsers released.
//
// Server-only: reads the environment.

import path from "node:path";
import { DISCLOSED_PRODUCTION_PROVIDER } from "./disclosed";
import { BROWSERBASE_LIVE_VIEW_ORIGIN, liveViewOriginOk } from "./live-view-origin";
import { appHostsFrom, effectiveSites, FIXTURE_SUFFIX, neverReason, type SiteRules, type WorkspaceSites } from "./sites";
import type { BrowserProviderName } from "./types";

export interface BrowserConfig {
  provider: BrowserProviderName;
  apiKey: string;
  projectId: string;
  /** The provider's API: our own host's origin (BROWSER_HOST_URL), Browserbase's own, or (outside production) the stand-in's. */
  apiBase: string;
  /** Where every browser runs (Decision 25), shown in the settings section. */
  region: string;
  /** What every provider session is tagged with (Decision 27). */
  deploymentTag: string;
  /** Browsers at once across the whole deployment (Decision 5), at or under the provider plan's concurrency. */
  maxAtOnce: number;
  /** The rate the founder set (Decision 34); null shows no cost. */
  priceCentsPerHour: number | null;
  /** The sealed pictures' folder (shots.ts). */
  shotsDir: string;
  /** The origins a live view address may have (Decision 19). */
  liveViewOrigins: string[];
  /**
   * A local proof provider: the stand-in, or our host on this machine
   * (BROWSER_HOST_URL on a loopback host outside production). Never
   * Browserbase, never in production. It turns on the fixture suffix, http,
   * ws: connect addresses and the proofs' short windows.
   */
  standIn: boolean;
  /**
   * Shorter windows for the stand-in's proofs only; null everywhere else.
   * `takeOverSeconds` (Phase 5 step 1, BROWSER_STAND_IN_TAKE_OVER_SECONDS):
   * the take over's window, which a recording's proof waits past.
   */
  testTimes: { sessionSeconds: number | null; idleSeconds: number | null; waitSeconds: number | null; takeOverSeconds: number | null };
}

export interface BrowserReleaseConfig {
  provider: BrowserProviderName;
  apiKey: string;
  projectId: string;
  apiBase: string;
  deploymentTag: string;
  standIn: boolean;
}

/** Browserbase's API (its live view's origin is live-view-origin.ts's). **verify:** against Browserbase's reference before production (Founder action 3). */
const BROWSERBASE_API = "https://api.browserbase.com";

/** A region as the provider names one: "us-east-1", "eu-central-1". */
const REGION = /^[a-z]{2}-[a-z]+-\d$/;
/** A deployment tag: lower case letters, digits and hyphens, 3 to 40. */
const TAG = /^[a-z0-9-]{3,40}$/;
const DEFAULT_TAG = "workwrk";
const DEFAULT_MAX_AT_ONCE = 10;

/** The project every request to our own host names: it has none, and never reads it. */
export const HOST_PROJECT_ID = "workwrk";
/** BROWSER_HOST_KEY in production: the install prints 64 base64url characters; at least 32. */
const HOST_KEY_PRODUCTION = /^[A-Za-z0-9_-]{32,200}$/;
/** BROWSER_HOST_KEY outside production: any visible characters, so it is always a header value fetch can send. */
const HOST_KEY_LOCAL = /^[\x21-\x7e]{1,200}$/;
/** Where our host may run over plain http outside production: this machine alone. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Whether a provider is our own host (docs/plans/browser-host.md Decision
 * 1): workwrk, or the stand-in, which is our host in proof mode (Decision
 * 17). Only ours is asked a live view's mode, a revoke or its health, so
 * Browserbase never gets a query or a path it does not know.
 */
export function isOurHost(provider: BrowserProviderName): boolean {
  return provider !== "browserbase";
}

const trimmed = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/** A whole number in [min, max], else null. */
function wholeIn(raw: string | undefined, min: number, max: number): number | null {
  const t = trimmed(raw);
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** The deployment tag, or null when one is set but malformed (see the header). */
function tagFrom(env: NodeJS.ProcessEnv): string | null {
  const t = trimmed(env.BROWSER_DEPLOYMENT_TAG);
  if (!t) return DEFAULT_TAG;
  return TAG.test(t) ? t : null;
}

/** Whether `inner` is `outer` or inside it, both resolved. */
function within(inner: string, outer: string): boolean {
  const rel = path.relative(/*turbopackIgnore: true*/ outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The pictures folder: absolute, and outside the app's folder (see the
 * header), else null. Read on its own by the sweep and the erasure, which
 * delete pictures whether or not the computer is offered now.
 */
export function shotsDirFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = trimmed(env.BROWSER_SHOTS_DIR);
  if (!raw || !path.isAbsolute(raw)) return null;
  const dir = path.resolve(/*turbopackIgnore: true*/ raw);
  if (dir === path.parse(dir).root) return null;
  // turbopackIgnore: a path from the environment and the working folder must
  // not make the build trace the whole project, which fails on the server
  // (as src/lib/local-uploads.ts; scripts/verify-commit.sh checks it).
  if (within(dir, path.resolve(/*turbopackIgnore: true*/ process.cwd()))) return null;
  return dir;
}

/** One gigabyte, as the pictures' budget and floor count it. */
export const GB = 1024 ** 3;
/** The pictures' budget when BROWSER_SHOTS_MAX_BYTES is not set (see the header). */
export const DEFAULT_SHOTS_MAX_BYTES = 20 * GB;

/**
 * The most bytes the pictures not yet expired may hold, the deployment's
 * (see the header): BROWSER_SHOTS_MAX_BYTES, a whole number of bytes (0
 * keeps none). Unset or malformed is the default: a budget always holds.
 */
export function shotsMaxBytesFrom(env: NodeJS.ProcessEnv = process.env): number {
  const t = trimmed(env.BROWSER_SHOTS_MAX_BYTES);
  if (!/^\d{1,15}$/.test(t)) return DEFAULT_SHOTS_MAX_BYTES;
  return Number(t);
}

/**
 * The hosts a production BROWSER_HOST_URL may never be under (Decision 2):
 * the app's own (workwrk.com among them) and COOKIE_DOMAIN, where the app's
 * session cookie goes.
 */
function cookieHostsFrom(env: NodeJS.ProcessEnv): string[] {
  const out = appHostsFrom(env);
  const domain = trimmed(env.COOKIE_DOMAIN).replace(/^\.+/, "");
  if (domain) out.push(domain);
  return out;
}

/**
 * BROWSER_HOST_URL as an origin, or null (see the header): no user,
 * password, path, query or fragment; in production https on the usual port
 * on a host neverReason does not name, the app's and the cookie's hosts
 * among them; outside production https, or http to a loopback host.
 * `loopback` says the host is this machine.
 */
export function hostBase(env: NodeJS.ProcessEnv = process.env): { origin: string; loopback: boolean } | null {
  const raw = trimmed(env.BROWSER_HOST_URL);
  if (!raw || raw.length > 300 || /[\s\\?#]/.test(raw) || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
  const loopback = LOOPBACK_HOSTS.has(u.hostname);
  if (env.NODE_ENV === "production") {
    // The usual port only: URL already reads 443 on https as no port.
    if (u.protocol !== "https:" || u.port !== "") return null;
    if (neverReason(u.hostname, { appHosts: cookieHostsFrom(env), fixtureSuffix: null })) return null;
  } else if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    return null;
  }
  return { origin: u.origin, loopback };
}

/** BROWSER_HOST_KEY as the rules of the header allow it, or null. */
function hostKeyFrom(env: NodeJS.ProcessEnv, production: boolean): string | null {
  const key = trimmed(env.BROWSER_HOST_KEY);
  if (production) return HOST_KEY_PRODUCTION.test(key) && key !== "stand-in" ? key : null;
  return HOST_KEY_LOCAL.test(key) ? key : null;
}

/** Where a provider's requests go, and with what, before the rules only browserConfig adds. */
type ProviderAt = { provider: BrowserProviderName; apiKey: string; projectId: string; apiBase: string; liveViewOrigin: string; standIn: boolean };

/**
 * The provider BROWSER_PROVIDER names, with its key, project and address, or
 * null. Our own host: hostBase and its key. Browserbase and the stand-in:
 * BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID; in production always
 * Browserbase itself (a stand-in named there has no browser to talk to), and
 * outside production the stand-in at BROWSERBASE_BASE_URL when one is set.
 */
function providerAt(env: NodeJS.ProcessEnv, providerRaw: string, production: boolean): ProviderAt | null {
  if (providerRaw === "workwrk") {
    const host = hostBase(env);
    const apiKey = hostKeyFrom(env, production);
    if (!host || !apiKey) return null;
    return { provider: "workwrk", apiKey, projectId: HOST_PROJECT_ID, apiBase: host.origin, liveViewOrigin: host.origin, standIn: !production && host.loopback };
  }
  if (providerRaw !== "browserbase" && providerRaw !== "stand-in") return null;
  const apiKey = trimmed(env.BROWSERBASE_API_KEY);
  const projectId = trimmed(env.BROWSERBASE_PROJECT_ID);
  if (!apiKey || !projectId) return null;
  if (production) {
    if (providerRaw === "stand-in") return null;
    return { provider: "browserbase", apiKey, projectId, apiBase: BROWSERBASE_API, liveViewOrigin: BROWSERBASE_LIVE_VIEW_ORIGIN, standIn: false };
  }
  const { base, bad } = standInBase(env);
  if (bad || (providerRaw === "stand-in" && !base)) return null;
  return {
    provider: base ? "stand-in" : "browserbase",
    apiKey,
    projectId,
    apiBase: base ?? BROWSERBASE_API,
    liveViewOrigin: base ? new URL(base).origin : BROWSERBASE_LIVE_VIEW_ORIGIN,
    standIn: Boolean(base),
  };
}

/** The provider's base outside production: the stand-in's, when one is set. Null when set but not an address. */
function standInBase(env: NodeJS.ProcessEnv): { base: string | null; bad: boolean } {
  const raw = trimmed(env.BROWSERBASE_BASE_URL).replace(/\/+$/, "");
  if (!raw) return { base: null, bad: false };
  if (!URL.canParse(raw)) return { base: null, bad: true };
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") return { base: null, bad: true };
  return { base: raw, bad: false };
}

/**
 * The provider, or null when this deployment offers no computer (see the
 * header). Read fresh on every call: switching BROWSER_OFFERED off stops the
 * next browser call, not the next deploy.
 */
export function browserConfig(env: NodeJS.ProcessEnv = process.env): BrowserConfig | null {
  if (trimmed(env.BROWSER_OFFERED) !== "1") return null;
  const providerRaw = trimmed(env.BROWSER_PROVIDER);
  const region = trimmed(env.BROWSER_REGION);
  if (!REGION.test(region) || !trimmed(env.SECRETS_ENCRYPTION_KEY)) return null;
  const shotsDir = shotsDirFrom(env);
  if (!shotsDir) return null;
  const deploymentTag = tagFrom(env);
  if (!deploymentTag) return null;

  const production = env.NODE_ENV === "production";
  // Production never talks to a stand-in, local or not (Decision 2), and
  // runs only the provider its pages name (browser-host.md Decision 14).
  if (production && (providerRaw === "stand-in" || providerRaw !== DISCLOSED_PRODUCTION_PROVIDER || trimmed(env.BROWSERBASE_BASE_URL))) return null;
  // The stand-in provider always has its own address (providerAt).
  const at = providerAt(env, providerRaw, production);
  if (!at) return null;
  // The card frames the origin it was built with (browser-card.tsx): it must be this one.
  if (production && at.provider === "workwrk" && trimmed(env.NEXT_PUBLIC_BROWSER_HOST_ORIGIN) !== at.liveViewOrigin) return null;
  const { apiKey, projectId, standIn } = at;

  const maxAtOnce = wholeIn(env.BROWSER_MAX_AT_ONCE, 1, 500) ?? DEFAULT_MAX_AT_ONCE;
  const priceCentsPerHour = wholeIn(env.BROWSER_PRICE_CENTS_PER_HOUR, 0, 1_000_000);
  const seconds = (v: string | undefined) => (standIn ? wholeIn(v, 1, 7200) : null);
  return {
    provider: at.provider,
    apiKey,
    projectId,
    apiBase: at.apiBase,
    region,
    deploymentTag,
    maxAtOnce,
    priceCentsPerHour,
    shotsDir,
    liveViewOrigins: [at.liveViewOrigin],
    standIn,
    testTimes: {
      sessionSeconds: seconds(env.BROWSER_STAND_IN_SESSION_SECONDS),
      idleSeconds: seconds(env.BROWSER_STAND_IN_IDLE_SECONDS),
      waitSeconds: seconds(env.BROWSER_STAND_IN_WAIT_SECONDS),
      takeOverSeconds: seconds(env.BROWSER_STAND_IN_TAKE_OVER_SECONDS),
    },
  };
}

/**
 * Whether this deployment offers teaching teammates by showing (Phase 5
 * Decision 1, see the header): the computer configured and
 * BROWSER_SKILLS_OFFERED=1. Read fresh on every call, as browserConfig is.
 */
export function skillsOffered(env: NodeJS.ProcessEnv = process.env): boolean {
  return browserConfig(env) !== null && trimmed(env.BROWSER_SKILLS_OFFERED) === "1";
}

/**
 * A site's home address as Teach a skill sends it (Phase 5 Decision 5):
 * https://<host>/, or http://<host>/ only for the stand-in's own fixture
 * hosts, which it serves over plain http. The guard still decides whether
 * it may be opened (sites.ts siteVerdict).
 */
export function siteHomeAddress(host: string, cfg: Pick<BrowserConfig, "standIn">): string {
  const h = trimmed(host).toLowerCase().replace(/\.$/, "");
  const fixture = cfg.standIn && h.length > FIXTURE_SUFFIX.length && h.endsWith(FIXTURE_SUFFIX);
  return `${fixture ? "http" : "https"}://${h}/`;
}

/**
 * Where releases, revokes, the reaper's list and the host's health go, read
 * on its own (see the header): the provider, the key and the project (or our
 * host's URL and key, under the same rules as browserConfig), never
 * BROWSER_OFFERED and never the disclosure rule, so a provider switched off
 * or no longer disclosed still has its browsers released. The stand-in base
 * counts outside production only; production talks to our host for workwrk
 * and to Browserbase itself for Browserbase, and a stand-in provider named in
 * production has no browser there to release.
 */
export function browserReleaseConfig(env: NodeJS.ProcessEnv = process.env): BrowserReleaseConfig | null {
  const deploymentTag = tagFrom(env);
  if (!deploymentTag) return null;
  const at = providerAt(env, trimmed(env.BROWSER_PROVIDER), env.NODE_ENV === "production");
  if (!at) return null;
  return { provider: at.provider, apiKey: at.apiKey, projectId: at.projectId, apiBase: at.apiBase, deploymentTag, standIn: at.standIn };
}

/**
 * What one teammate's browser obeys now (Decision 9): https only (http too
 * for the stand-in's fixture sites), the app's own hosts never, the
 * workspace block list, and the teammate's own sites within the workspace
 * allow list.
 */
export function siteRulesFor(cfg: Pick<BrowserConfig, "standIn">, policy: WorkspaceSites, teammate: readonly string[]): SiteRules {
  return {
    allow: effectiveSites(teammate, policy),
    block: [...(policy.block ?? [])],
    appHosts: appHostsFrom(process.env),
    schemes: cfg.standIn ? ["https:", "http:"] : ["https:"],
    fixtureSuffix: cfg.standIn ? FIXTURE_SUFFIX : null,
  };
}

/** The fixture suffix a site entry may carry, from the stand-in's config only (sites.ts parseSiteEntry). */
export function fixtureSuffixFor(cfg: Pick<BrowserConfig, "standIn"> | null): string | null {
  return cfg?.standIn ? FIXTURE_SUFFIX : null;
}

/**
 * Whether a live view address may be shown (Decision 19): its origin is the
 * provider's, over https (the stand-in's own origin outside production). Pure,
 * in live-view-origin.ts, so the browser card repeats it in the page (step 4).
 */
export { liveViewOriginOk };
