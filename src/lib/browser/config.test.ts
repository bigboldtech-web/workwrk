// The browser provider's settings (src/lib/browser/config.ts): nothing is
// offered without every variable of Decision 2, production never talks to a
// stand-in, releases never need BROWSER_OFFERED, the pictures folder is never
// inside the app's own folder, and the stand-in's short windows count only
// for the stand-in.

import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browserConfig, browserReleaseConfig, DEFAULT_SHOTS_MAX_BYTES, GB, hostBase, isOurHost, liveViewOriginOk, shotsDirFrom, shotsMaxBytesFrom, siteHomeAddress, siteRulesFor, skillsOffered } from "./config";

const SHOTS = path.join(os.tmpdir(), "wk-config-test-shots");

const FULL = {
  NODE_ENV: "development",
  BROWSER_OFFERED: "1",
  BROWSER_PROVIDER: "browserbase",
  BROWSERBASE_API_KEY: "bb-key",
  BROWSERBASE_PROJECT_ID: "bb-project",
  BROWSER_REGION: "us-east-1",
  BROWSER_SHOTS_DIR: SHOTS,
  SECRETS_ENCRYPTION_KEY: "a-test-key",
};

const env = (o: Record<string, string | undefined> = {}) => ({ ...FULL, ...o }) as NodeJS.ProcessEnv;

describe("browserConfig", () => {
  it("is set with every variable, Browserbase itself by default", () => {
    expect(browserConfig(env())).toEqual({
      provider: "browserbase",
      apiKey: "bb-key",
      projectId: "bb-project",
      apiBase: "https://api.browserbase.com",
      region: "us-east-1",
      deploymentTag: "workwrk",
      maxAtOnce: 10,
      priceCentsPerHour: null,
      shotsDir: SHOTS,
      liveViewOrigins: ["https://www.browserbase.com"],
      standIn: false,
      testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: null, takeOverSeconds: null },
    });
  });

  it("is null without BROWSER_OFFERED, the provider, the key, the project, the region, the sealing key or the pictures folder", () => {
    for (const k of ["BROWSER_OFFERED", "BROWSER_PROVIDER", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "BROWSER_REGION", "SECRETS_ENCRYPTION_KEY", "BROWSER_SHOTS_DIR"]) {
      expect(browserConfig(env({ [k]: undefined })), k).toBeNull();
      expect(browserConfig(env({ [k]: "   " })), k).toBeNull();
    }
    expect(browserConfig(env({ BROWSER_OFFERED: "true" }))).toBeNull();
    expect(browserConfig(env({ BROWSER_PROVIDER: "playwright" }))).toBeNull();
    expect(browserConfig(env({ BROWSER_REGION: "US East" }))).toBeNull();
  });

  it("is null in production with a stand-in, by provider or by address", () => {
    // Browserbase itself is no provider production runs now either (docs/plans/browser-host.md Decision 14, below).
    expect(browserConfig(env({ NODE_ENV: "production" }))).toBeNull();
    expect(browserConfig(env({ NODE_ENV: "production", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" }))).toBeNull();
    expect(browserConfig(env({ NODE_ENV: "production", BROWSERBASE_BASE_URL: "https://standin.staging.example.com" }))).toBeNull();
    expect(browserConfig(env({ NODE_ENV: "production", BROWSER_PROVIDER: "stand-in" }))).toBeNull();
  });

  it("gives a pictures folder that is not absolute, or inside the app's folder (public/ included), null", () => {
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: "shots" }))).toBeNull();
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: path.join(process.cwd(), "public", "shots") }))).toBeNull();
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: path.join(process.cwd(), "public") }))).toBeNull();
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: path.join(process.cwd(), "storage", "uploads", "shots") }))).toBeNull();
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: path.join(process.cwd(), "..", path.basename(process.cwd()), "public") }))).toBeNull();
    expect(browserConfig(env({ BROWSER_SHOTS_DIR: path.parse(process.cwd()).root }))).toBeNull();
    expect(shotsDirFrom(env({ BROWSER_SHOTS_DIR: `${SHOTS}/` }))).toBe(SHOTS);
  });

  it("moves to the stand-in outside production, with its origin for the live view", () => {
    const cfg = browserConfig(env({ BROWSER_PROVIDER: "stand-in", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789/" }));
    expect(cfg).toMatchObject({ provider: "stand-in", apiBase: "http://127.0.0.1:8789", standIn: true, liveViewOrigins: ["http://127.0.0.1:8789"] });
    // The stand-in provider always has its own address; a base that is not an address points nowhere.
    expect(browserConfig(env({ BROWSER_PROVIDER: "stand-in" }))).toBeNull();
    expect(browserConfig(env({ BROWSERBASE_BASE_URL: "not an address" }))).toBeNull();
    expect(browserConfig(env({ BROWSERBASE_BASE_URL: "ftp://127.0.0.1" }))).toBeNull();
  });

  it("reads the caps, the price and the tag, and refuses a malformed tag rather than share the default", () => {
    expect(browserConfig(env({ BROWSER_MAX_AT_ONCE: "4", BROWSER_PRICE_CENTS_PER_HOUR: "12", BROWSER_DEPLOYMENT_TAG: "workwrk-prod" }))).toMatchObject({
      maxAtOnce: 4,
      priceCentsPerHour: 12,
      deploymentTag: "workwrk-prod",
    });
    expect(browserConfig(env({ BROWSER_MAX_AT_ONCE: "0" }))?.maxAtOnce).toBe(10);
    expect(browserConfig(env({ BROWSER_MAX_AT_ONCE: "501" }))?.maxAtOnce).toBe(10);
    expect(browserConfig(env({ BROWSER_PRICE_CENTS_PER_HOUR: "-3" }))?.priceCentsPerHour).toBeNull();
    expect(browserConfig(env({ BROWSER_PRICE_CENTS_PER_HOUR: "0" }))?.priceCentsPerHour).toBe(0);
    expect(browserConfig(env({ BROWSER_DEPLOYMENT_TAG: "Prod!" }))).toBeNull();
    expect(browserReleaseConfig(env({ BROWSER_DEPLOYMENT_TAG: "x" }))).toBeNull();
  });

  it("ignores the stand-in's short windows unless the stand-in runs, the take over's too (Phase 5 step 1)", () => {
    const times = { BROWSER_STAND_IN_SESSION_SECONDS: "60", BROWSER_STAND_IN_IDLE_SECONDS: "20", BROWSER_STAND_IN_WAIT_SECONDS: "30", BROWSER_STAND_IN_TAKE_OVER_SECONDS: "90" };
    expect(browserConfig(env(times))?.testTimes).toEqual({ sessionSeconds: null, idleSeconds: null, waitSeconds: null, takeOverSeconds: null });
    expect(browserConfig(env({ ...times, BROWSER_PROVIDER: "stand-in", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" }))?.testTimes).toEqual({
      sessionSeconds: 60,
      idleSeconds: 20,
      waitSeconds: 30,
      takeOverSeconds: 90,
    });
    expect(browserConfig(env({ BROWSER_STAND_IN_TAKE_OVER_SECONDS: "soon", BROWSER_PROVIDER: "stand-in", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" }))?.testTimes.takeOverSeconds).toBeNull();
  });
});

// Phase 5 Decision 1: teaching by showing is off until the founder turns it on, and only behind the computer.
describe("skillsOffered and siteHomeAddress (Phase 5)", () => {
  it("offers skills only with BROWSER_SKILLS_OFFERED=1 and the computer configured", () => {
    expect(skillsOffered(env())).toBe(false);
    expect(skillsOffered(env({ BROWSER_SKILLS_OFFERED: "true" }))).toBe(false);
    expect(skillsOffered(env({ BROWSER_SKILLS_OFFERED: "1" }))).toBe(true);
    expect(skillsOffered(env({ BROWSER_SKILLS_OFFERED: " 1 " }))).toBe(true);
    // No computer, no skills: browserConfig() is null.
    expect(skillsOffered(env({ BROWSER_SKILLS_OFFERED: "1", BROWSER_OFFERED: undefined }))).toBe(false);
    expect(skillsOffered(env({ BROWSER_SKILLS_OFFERED: "1", NODE_ENV: "production", BROWSER_PROVIDER: "stand-in" }))).toBe(false);
    expect(skillsOffered({ BROWSER_SKILLS_OFFERED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("gives a site's home over https, and over http only for a fixture host under the stand-in", () => {
    expect(siteHomeAddress("expenses.proof.test", { standIn: true })).toBe("http://expenses.proof.test/");
    expect(siteHomeAddress("expenses.proof.test", { standIn: false })).toBe("https://expenses.proof.test/");
    expect(siteHomeAddress("acme.com", { standIn: true })).toBe("https://acme.com/");
    expect(siteHomeAddress(" Acme.COM. ", { standIn: false })).toBe("https://acme.com/");
    // The suffix alone is no fixture host.
    expect(siteHomeAddress("proof.test", { standIn: true })).toBe("https://proof.test/");
  });
});

describe("browserReleaseConfig", () => {
  it("works without BROWSER_OFFERED, the region, the pictures folder or the sealing key", () => {
    const r = browserReleaseConfig(env({ BROWSER_OFFERED: undefined, BROWSER_REGION: undefined, BROWSER_SHOTS_DIR: undefined, SECRETS_ENCRYPTION_KEY: undefined }));
    expect(r).toEqual({ provider: "browserbase", apiKey: "bb-key", projectId: "bb-project", apiBase: "https://api.browserbase.com", deploymentTag: "workwrk", standIn: false });
  });

  it("needs the provider, the key and the project", () => {
    expect(browserReleaseConfig(env({ BROWSERBASE_API_KEY: undefined }))).toBeNull();
    expect(browserReleaseConfig(env({ BROWSERBASE_PROJECT_ID: undefined }))).toBeNull();
    expect(browserReleaseConfig(env({ BROWSER_PROVIDER: undefined }))).toBeNull();
  });

  it("uses the stand-in outside production only; production always tells Browserbase", () => {
    expect(browserReleaseConfig(env({ BROWSER_PROVIDER: "stand-in", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" }))).toMatchObject({ apiBase: "http://127.0.0.1:8789", standIn: true });
    expect(browserReleaseConfig(env({ NODE_ENV: "production", BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" }))).toMatchObject({ apiBase: "https://api.browserbase.com", standIn: false });
    expect(browserReleaseConfig(env({ NODE_ENV: "production", BROWSER_PROVIDER: "stand-in" }))).toBeNull();
  });
});

describe("siteRulesFor and liveViewOriginOk", () => {
  it("allows the teammate's sites within the workspace list, https only, http and fixtures only for the stand-in", () => {
    const rules = siteRulesFor({ standIn: false }, { allow: ["docs.example.com", "shop.example.com"], block: ["evil.example.com"] }, ["docs.example.com", "other.example.com"]);
    expect(rules).toMatchObject({ allow: ["docs.example.com"], block: ["evil.example.com"], schemes: ["https:"], fixtureSuffix: null });
    expect(rules.appHosts).toContain("workwrk.com");
    expect(siteRulesFor({ standIn: true }, { allow: [], block: [] }, [])).toMatchObject({ schemes: ["https:", "http:"], fixtureSuffix: ".proof.test" });
  });

  it("shows a live view only from the provider's origin", () => {
    const cfg = { liveViewOrigins: ["https://www.browserbase.com"], standIn: false };
    expect(liveViewOriginOk("https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=x", cfg)).toBe(true);
    expect(liveViewOriginOk("https://evil.example.com/inspector.html", cfg)).toBe(false);
    expect(liveViewOriginOk("http://www.browserbase.com/x", cfg)).toBe(false);
    expect(liveViewOriginOk("https://user:pw@www.browserbase.com/x", cfg)).toBe(false);
    expect(liveViewOriginOk("javascript:alert(1)", cfg)).toBe(false);
    expect(liveViewOriginOk("http://127.0.0.1:8789/live/s1?t=x", { liveViewOrigins: ["http://127.0.0.1:8789"], standIn: true })).toBe(true);
  });
});

describe("shotsMaxBytesFrom (review round 1 of Phase 4)", () => {
  it("is 20 GB unless set to a whole number of bytes, a malformed value keeping the default rather than no budget", () => {
    expect(DEFAULT_SHOTS_MAX_BYTES).toBe(20 * GB);
    expect(shotsMaxBytesFrom({} as NodeJS.ProcessEnv)).toBe(20 * GB);
    expect(shotsMaxBytesFrom({ BROWSER_SHOTS_MAX_BYTES: " 5368709120 " } as unknown as NodeJS.ProcessEnv)).toBe(5 * GB);
    expect(shotsMaxBytesFrom({ BROWSER_SHOTS_MAX_BYTES: "0" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    for (const bad of ["20GB", "-1", "1e12", "", "9999999999999999"]) expect(shotsMaxBytesFrom({ BROWSER_SHOTS_MAX_BYTES: bad } as unknown as NodeJS.ProcessEnv), bad).toBe(20 * GB);
  });
});

// docs/plans/browser-host.md section 9.1 and step 4: our own host, the
// provider "workwrk". Each fails on the code before it, where workwrk was no
// provider at all.
describe("our own host, BROWSER_PROVIDER=workwrk", () => {
  const LOCAL = { BROWSER_PROVIDER: "workwrk", BROWSER_HOST_URL: "http://127.0.0.1:8789", BROWSER_HOST_KEY: "stand-in", BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined };
  const ORIGIN = "https://browsers.workwrkbrowsers.com";
  const KEY = "Ab3_-".repeat(12) + "Zz9_";
  const PROD = {
    NODE_ENV: "production",
    BROWSER_PROVIDER: "workwrk",
    BROWSER_HOST_URL: ORIGIN,
    BROWSER_HOST_KEY: KEY,
    NEXT_PUBLIC_BROWSER_HOST_ORIGIN: ORIGIN,
    NEXT_PUBLIC_APP_URL: "https://app.acme-work.example.org",
    BROWSERBASE_API_KEY: undefined,
    BROWSERBASE_PROJECT_ID: undefined,
  };

  it("is set with every variable, as a local proof provider on a loopback URL, with no Browserbase variable", () => {
    expect(browserConfig(env(LOCAL))).toEqual({
      provider: "workwrk",
      apiKey: "stand-in",
      projectId: "workwrk",
      apiBase: "http://127.0.0.1:8789",
      region: "us-east-1",
      deploymentTag: "workwrk",
      maxAtOnce: 10,
      priceCentsPerHour: null,
      shotsDir: SHOTS,
      liveViewOrigins: ["http://127.0.0.1:8789"],
      standIn: true,
      testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: null, takeOverSeconds: null },
    });
    // The proofs' short windows count, as the stand-in's did (12.1's terminals).
    expect(browserConfig(env({ ...LOCAL, BROWSER_STAND_IN_IDLE_SECONDS: "20", BROWSER_STAND_IN_WAIT_SECONDS: "30" }))?.testTimes).toMatchObject({ idleSeconds: 20, waitSeconds: 30 });
    for (const url of ["http://localhost:8789", "http://[::1]:8789/"]) expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_URL: url }))?.standIn, url).toBe(true);
    // An https host elsewhere is no local proof provider: wss only, no fixtures, no short windows.
    expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_URL: "https://browsers.staging.example.org", BROWSER_STAND_IN_IDLE_SECONDS: "20" }))).toMatchObject({ standIn: false, testTimes: { idleSeconds: null } });
    // Plain http to anywhere but this machine, no key, or no URL: null.
    expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_URL: "http://10.0.0.8:8789" }))).toBeNull();
    expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_KEY: undefined }))).toBeNull();
    expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_KEY: "k".repeat(201) }))).toBeNull();
    expect(browserConfig(env({ ...LOCAL, BROWSER_HOST_URL: undefined }))).toBeNull();
    expect(isOurHost("workwrk")).toBe(true);
    expect(isOurHost("stand-in")).toBe(true);
    expect(isOurHost("browserbase")).toBe(false);
  });

  it("is set in production on a domain of its own, with the install's key and the card's origin equal to it", async () => {
    // The provider production may run is the one the pages name (disclosed.ts, Decision 14).
    expect((await import("./disclosed")).DISCLOSED_PRODUCTION_PROVIDER).toBe("workwrk");
    expect(browserConfig(env(PROD))).toMatchObject({ provider: "workwrk", apiKey: KEY, projectId: "workwrk", apiBase: ORIGIN, liveViewOrigins: [ORIGIN], standIn: false });
    expect(browserConfig(env({ ...PROD, BROWSER_HOST_URL: `${ORIGIN}/`, NEXT_PUBLIC_BROWSER_HOST_ORIGIN: ORIGIN }))?.apiBase).toBe(ORIGIN);
    expect(browserConfig(env({ ...PROD, BROWSER_HOST_URL: `${ORIGIN}:443` }))?.apiBase).toBe(ORIGIN);
  });

  it("is null in production for every address, key or origin the spec refuses", () => {
    const refused: Record<string, Record<string, string | undefined>> = {
      "an http URL": { BROWSER_HOST_URL: "http://browsers.workwrkbrowsers.com", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "http://browsers.workwrkbrowsers.com" },
      "an IP literal": { BROWSER_HOST_URL: "https://203.0.113.9", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://203.0.113.9" },
      "an IPv6 literal": { BROWSER_HOST_URL: "https://[2001:db8::1]", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://[2001:db8::1]" },
      localhost: { BROWSER_HOST_URL: "https://localhost", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://localhost" },
      "an internal name": { BROWSER_HOST_URL: "https://browsers.internal", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://browsers.internal" },
      "a URL with a path": { BROWSER_HOST_URL: `${ORIGIN}/v1` },
      "a URL with a query": { BROWSER_HOST_URL: `${ORIGIN}/?x=1` },
      "a URL with a fragment": { BROWSER_HOST_URL: `${ORIGIN}#x` },
      "a URL with a user": { BROWSER_HOST_URL: "https://me:pw@browsers.workwrkbrowsers.com" },
      "another port": { BROWSER_HOST_URL: `${ORIGIN}:8443`, NEXT_PUBLIC_BROWSER_HOST_ORIGIN: `${ORIGIN}:8443` },
      "browsers.workwrk.com": { BROWSER_HOST_URL: "https://browsers.workwrk.com", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://browsers.workwrk.com" },
      "the app's host": { BROWSER_HOST_URL: "https://app.acme-work.example.org", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://app.acme-work.example.org" },
      "under the app's host": { BROWSER_HOST_URL: "https://b.app.acme-work.example.org", NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://b.app.acme-work.example.org" },
      "under the session cookie's domain": { COOKIE_DOMAIN: ".workwrkbrowsers.com" },
      "a 31-character key": { BROWSER_HOST_KEY: "k".repeat(31) },
      "the key stand-in": { BROWSER_HOST_KEY: "stand-in" },
      "a key with other characters": { BROWSER_HOST_KEY: `${"k".repeat(40)}+/=` },
      "an origin unequal to NEXT_PUBLIC_BROWSER_HOST_ORIGIN": { NEXT_PUBLIC_BROWSER_HOST_ORIGIN: "https://other.workwrkbrowsers.com" },
      "no NEXT_PUBLIC_BROWSER_HOST_ORIGIN": { NEXT_PUBLIC_BROWSER_HOST_ORIGIN: undefined },
      "a trailing slash on NEXT_PUBLIC_BROWSER_HOST_ORIGIN": { NEXT_PUBLIC_BROWSER_HOST_ORIGIN: `${ORIGIN}/` },
      "any BROWSERBASE_BASE_URL": { BROWSERBASE_BASE_URL: "http://127.0.0.1:8789" },
    };
    // Each differs by one variable from a production configuration that is set (before: workwrk was null whatever it held).
    expect(browserConfig(env(PROD))).not.toBeNull();
    for (const [why, o] of Object.entries(refused)) expect(browserConfig(env({ ...PROD, ...o })), why).toBeNull();
  });

  it("refuses Browserbase in production for browserConfig, and still releases there", () => {
    const bb = env({ NODE_ENV: "production" });
    expect(browserConfig(bb)).toBeNull();
    expect(skillsOffered(env({ NODE_ENV: "production", BROWSER_SKILLS_OFFERED: "1" }))).toBe(false);
    expect(browserReleaseConfig(bb)).toEqual({ provider: "browserbase", apiKey: "bb-key", projectId: "bb-project", apiBase: "https://api.browserbase.com", deploymentTag: "workwrk", standIn: false });
  });

  it("releases at our host with the same URL and key rules, never the disclosure rule, BROWSER_OFFERED or the card's origin", () => {
    const rel = { ...PROD, BROWSER_OFFERED: undefined, NEXT_PUBLIC_BROWSER_HOST_ORIGIN: undefined, BROWSER_REGION: undefined, BROWSER_SHOTS_DIR: undefined };
    expect(browserReleaseConfig(env(rel))).toEqual({ provider: "workwrk", apiKey: KEY, projectId: "workwrk", apiBase: ORIGIN, deploymentTag: "workwrk", standIn: false });
    // Before: production answered Browserbase for anything that was not the stand-in.
    expect(browserReleaseConfig(env({ ...rel, BROWSER_HOST_URL: "https://browsers.workwrk.com" }))).toBeNull();
    expect(browserReleaseConfig(env({ ...rel, BROWSER_HOST_KEY: "stand-in" }))).toBeNull();
    expect(browserReleaseConfig(env(LOCAL))).toEqual({ provider: "workwrk", apiKey: "stand-in", projectId: "workwrk", apiBase: "http://127.0.0.1:8789", deploymentTag: "workwrk", standIn: true });
  });

  it("reads BROWSER_HOST_URL as an origin only", () => {
    expect(hostBase({ BROWSER_HOST_URL: " http://127.0.0.1:8789/ " } as unknown as NodeJS.ProcessEnv)).toEqual({ origin: "http://127.0.0.1:8789", loopback: true });
    for (const bad of ["127.0.0.1:8789", "ws://127.0.0.1:8789", "http://127.0.0.1:8789//", "http://127.0.0.1:8789/live", "http://127.0.0.1:8789/?", "http://127.0.0.1:8789/#", "not a url", ""]) {
      expect(hostBase({ BROWSER_HOST_URL: bad } as unknown as NodeJS.ProcessEnv), bad).toBeNull();
    }
  });
});
