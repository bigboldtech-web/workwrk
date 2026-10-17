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
// Server-only: reads the environment.

import path from "node:path";
import { BROWSERBASE_LIVE_VIEW_ORIGIN, liveViewOriginOk } from "./live-view-origin";
import { appHostsFrom, effectiveSites, FIXTURE_SUFFIX, type SiteRules, type WorkspaceSites } from "./sites";
import type { BrowserProviderName } from "./types";

export interface BrowserConfig {
  provider: BrowserProviderName;
  apiKey: string;
  projectId: string;
  /** The provider's API: Browserbase's own, or (outside production) the stand-in's. */
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
  /** Every address is BROWSERBASE_BASE_URL's: a stand-in, never Browserbase, never in production. */
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
  if (providerRaw !== "browserbase" && providerRaw !== "stand-in") return null;
  const apiKey = trimmed(env.BROWSERBASE_API_KEY);
  const projectId = trimmed(env.BROWSERBASE_PROJECT_ID);
  const region = trimmed(env.BROWSER_REGION);
  if (!apiKey || !projectId || !REGION.test(region) || !trimmed(env.SECRETS_ENCRYPTION_KEY)) return null;
  const shotsDir = shotsDirFrom(env);
  if (!shotsDir) return null;
  const deploymentTag = tagFrom(env);
  if (!deploymentTag) return null;

  const production = env.NODE_ENV === "production";
  const { base, bad } = standInBase(env);
  // Production never talks to a stand-in, local or not (Decision 2).
  if (production && (providerRaw === "stand-in" || trimmed(env.BROWSERBASE_BASE_URL))) return null;
  if (bad) return null;
  // The stand-in provider always has its own address.
  if (providerRaw === "stand-in" && !base) return null;
  const standIn = Boolean(base);

  const maxAtOnce = wholeIn(env.BROWSER_MAX_AT_ONCE, 1, 500) ?? DEFAULT_MAX_AT_ONCE;
  const priceCentsPerHour = wholeIn(env.BROWSER_PRICE_CENTS_PER_HOUR, 0, 1_000_000);
  const seconds = (v: string | undefined) => (standIn ? wholeIn(v, 1, 7200) : null);
  return {
    provider: standIn ? "stand-in" : "browserbase",
    apiKey,
    projectId,
    apiBase: base ?? BROWSERBASE_API,
    region,
    deploymentTag,
    maxAtOnce,
    priceCentsPerHour,
    shotsDir,
    liveViewOrigins: [base ? new URL(base).origin : BROWSERBASE_LIVE_VIEW_ORIGIN],
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
 * Where releases and the reaper's list go, read on its own (see the header):
 * the provider, the key and the project, never BROWSER_OFFERED. The stand-in
 * base counts outside production only; production always talks to
 * Browserbase itself, and a stand-in provider named in production has no
 * browser there to release.
 */
export function browserReleaseConfig(env: NodeJS.ProcessEnv = process.env): BrowserReleaseConfig | null {
  const providerRaw = trimmed(env.BROWSER_PROVIDER);
  if (providerRaw !== "browserbase" && providerRaw !== "stand-in") return null;
  const apiKey = trimmed(env.BROWSERBASE_API_KEY);
  const projectId = trimmed(env.BROWSERBASE_PROJECT_ID);
  if (!apiKey || !projectId) return null;
  const deploymentTag = tagFrom(env);
  if (!deploymentTag) return null;
  const production = env.NODE_ENV === "production";
  if (production) {
    if (providerRaw === "stand-in") return null;
    return { provider: "browserbase", apiKey, projectId, apiBase: BROWSERBASE_API, deploymentTag, standIn: false };
  }
  const { base, bad } = standInBase(env);
  if (bad || (providerRaw === "stand-in" && !base)) return null;
  return { provider: base ? "stand-in" : "browserbase", apiKey, projectId, apiBase: base ?? BROWSERBASE_API, deploymentTag, standIn: Boolean(base) };
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
