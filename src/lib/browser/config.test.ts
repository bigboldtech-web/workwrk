// The browser provider's settings (src/lib/browser/config.ts): nothing is
// offered without every variable of Decision 2, production never talks to a
// stand-in, releases never need BROWSER_OFFERED, the pictures folder is never
// inside the app's own folder, and the stand-in's short windows count only
// for the stand-in.

import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browserConfig, browserReleaseConfig, DEFAULT_SHOTS_MAX_BYTES, GB, liveViewOriginOk, shotsDirFrom, shotsMaxBytesFrom, siteHomeAddress, siteRulesFor, skillsOffered } from "./config";

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
    expect(browserConfig(env({ NODE_ENV: "production" }))).not.toBeNull();
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
