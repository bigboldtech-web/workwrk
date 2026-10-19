import { describe, expect, it } from "vitest";

import { readHostConfig, sha256, type HostConfig } from "./config.mjs";

const GIB = 1024 ** 3;
const LAPTOP = { memTotalBytes: 16 * GIB, cpus: 8, tmpdir: "/tmp/t", home: "/home/me" };
const SMALL = { memTotalBytes: 7936 * 1024 * 1024, cpus: 4, tmpdir: "/tmp/t", home: "/home/me" };
const HASH = sha256("a-long-production-key-of-forty-characters").toString("hex");

const CONTAINER = {
  BROWSER_HOST_MODE: "container",
  NODE_ENV: "production",
  BROWSER_HOST_PUBLIC_URL: "https://browsers.workwrkbrowsers.com",
  BROWSER_HOST_APP_ORIGIN: "https://app.workwrk.com",
  BROWSER_HOST_REGION: "eu-central-1",
  BROWSER_HOST_KEY_SHA256: HASH,
};

function ok(c: HostConfig | { refusals: string[] }): HostConfig {
  if ("refusals" in c) throw new Error(`refused: ${c.refusals.join(", ")}`);
  return c;
}
function refusals(c: HostConfig | { refusals: string[] }): string[] {
  return "refusals" in c ? c.refusals : [];
}

describe("readHostConfig: process mode", () => {
  it("is refused with NODE_ENV=production", () => {
    expect(refusals(readHostConfig({ NODE_ENV: "production", BROWSER_HOST_KEY: "stand-in" }, [], LAPTOP))).toContain("process_in_production");
    expect(refusals(readHostConfig({ NODE_ENV: "production", BROWSER_HOST_MODE: "process", BROWSER_HOST_KEY: "k" }, ["--proof"], LAPTOP))).toContain("process_in_production");
  });

  it("is refused whenever it would answer beyond 127.0.0.1", () => {
    expect(refusals(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_LISTEN: "0.0.0.0" }, [], LAPTOP))).toContain("listen");
    expect(refusals(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_PUBLIC_URL: "http://192.168.1.5:8789" }, [], LAPTOP))).toContain("public_url");
  });

  it("defaults to the proofs' app origin and region, on 127.0.0.1", () => {
    for (const argv of [[], ["--proof"]]) {
      const c = ok(readHostConfig({ BROWSER_HOST_KEY: "stand-in" }, argv, LAPTOP));
      expect(c.appOrigin).toBe("http://localhost:3016");
      expect(c.region).toBe("us-east-1");
      expect(c.mode).toBe("process");
      expect(c.listen).toBe("127.0.0.1");
      expect(c.publicUrl).toBe("http://127.0.0.1:8789");
      expect(c.connectBase).toBe("ws://127.0.0.1:8789");
    }
  });

  it("keeps only the clear key's hash", () => {
    const c = ok(readHostConfig({ BROWSER_HOST_KEY: "stand-in" }, [], LAPTOP));
    expect(c.keyHashes.map((h) => h.toString("hex"))).toEqual([sha256("stand-in").toString("hex")]);
    expect(JSON.stringify(c)).not.toContain("stand-in");
  });

  it("proof mode takes the next port for the fixture sites, and the stand-in's log name", () => {
    const c = ok(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_PORT: "18789", BROWSER_STAND_IN_LOG: "/tmp/x.jsonl" }, ["--proof"], LAPTOP));
    expect(c.proof).toBe(true);
    expect(c.fixturePort).toBe(18790);
    expect(c.proofLog).toBe("/tmp/x.jsonl");
    expect(c.stateDir).toBe("/tmp/t/workwrk-browser-host-18789");
    expect(ok(readHostConfig({ BROWSER_HOST_KEY: "k" }, [], LAPTOP)).fixturePort).toBeNull();
  });

  it("refuses with no key at all", () => {
    expect(refusals(readHostConfig({}, [], LAPTOP))).toContain("key");
  });
});

describe("readHostConfig: container mode", () => {
  it("starts with every value set", () => {
    const c = ok(readHostConfig(CONTAINER, [], SMALL));
    expect(c.mode).toBe("container");
    expect(c.max).toBe(4);
    expect(c.connectBase).toBe("wss://browsers.workwrkbrowsers.com");
    expect(c.stateDir).toBe("/var/lib/workwrk-browser-host");
  });

  it("refuses a clear key", () => {
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_KEY: "a-long-production-key-of-forty-characters" }, [], SMALL))).toContain("clear_key_in_container");
    const noHash = { ...CONTAINER, BROWSER_HOST_KEY_SHA256: undefined };
    expect(refusals(readHostConfig({ ...noHash, BROWSER_HOST_KEY: "a-long-production-key-of-forty-characters" }, [], SMALL))).toContain("clear_key_in_container");
  });

  it("refuses an http public URL or app origin, and a public URL under workwrk.com", () => {
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_PUBLIC_URL: "http://browsers.workwrkbrowsers.com" }, [], SMALL))).toContain("public_url");
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_APP_ORIGIN: "http://app.workwrk.com" }, [], SMALL))).toContain("app_origin");
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_PUBLIC_URL: "https://browsers.workwrk.com" }, [], SMALL))).toContain("public_url");
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_PUBLIC_URL: "https://browsers.workwrkbrowsers.com/path" }, [], SMALL))).toContain("public_url");
  });

  it("refuses a bad region", () => {
    for (const region of ["", "europe", "EU-CENTRAL-1", "eu-central"]) {
      expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_REGION: region }, [], SMALL))).toContain("region");
    }
  });

  it("has no defaults: a bare container mode refuses each value", () => {
    const r = refusals(readHostConfig({ BROWSER_HOST_MODE: "container", NODE_ENV: "production" }, [], SMALL));
    expect(r).toEqual(expect.arrayContaining(["public_url", "app_origin", "region", "key"]));
  });

  it("refuses proof mode", () => {
    expect(refusals(readHostConfig(CONTAINER, ["--proof"], SMALL))).toContain("proof_needs_process");
  });

  it("takes two hashes for a rotation, and no more", () => {
    const two = `${HASH},${sha256("another-key").toString("hex")}`;
    expect(ok(readHostConfig({ ...CONTAINER, BROWSER_HOST_KEY_SHA256: two }, [], SMALL)).keyHashes).toHaveLength(2);
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_KEY_SHA256: `${two},${HASH}` }, [], SMALL))).toContain("key_hash");
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_KEY_SHA256: "abc" }, [], SMALL))).toContain("key_hash");
  });
});

describe("BROWSER_HOST_MAX", () => {
  it("only lowers the max", () => {
    expect(ok(readHostConfig({ ...CONTAINER, BROWSER_HOST_MAX: "2" }, [], SMALL)).max).toBe(2);
    expect(ok(readHostConfig({ ...CONTAINER, BROWSER_HOST_MAX: "50" }, [], SMALL)).max).toBe(4);
    expect(ok(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_MAX: "2" }, [], LAPTOP)).max).toBe(2);
    expect(ok(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_MAX: "500" }, [], LAPTOP)).max).toBe(14);
  });

  it("refuses to start below 1", () => {
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_MAX: "0" }, [], SMALL))).toContain("max");
    expect(refusals(readHostConfig({ BROWSER_HOST_KEY: "k" }, [], { ...LAPTOP, memTotalBytes: 2 * GIB }))).toContain("max");
  });

  it("process mode sizes a session at 1024 MiB with no shim, whatever the setting", () => {
    expect(ok(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_SESSION_MEMORY_MB: "4096" }, [], LAPTOP)).sessionMb).toBe(1024);
    expect(ok(readHostConfig({ ...CONTAINER, BROWSER_HOST_SESSION_MEMORY_MB: "2048" }, [], SMALL)).sessionMb).toBe(2048);
    expect(refusals(readHostConfig({ ...CONTAINER, BROWSER_HOST_SESSION_MEMORY_MB: "512" }, [], SMALL))).toContain("session_memory");
  });
});

describe("test windows", () => {
  const windows = { BROWSER_HOST_TEST_CONNECT_SECONDS: "5", BROWSER_HOST_TEST_CONTROL_SECONDS: "8", BROWSER_HOST_TEST_FIREWALL_SECONDS: "30" };

  it("are read in process mode outside production", () => {
    expect(ok(readHostConfig({ BROWSER_HOST_KEY: "k", ...windows }, [], LAPTOP)).test).toEqual({ connectSeconds: 5, controlSeconds: 8, firewallSeconds: 30 });
  });

  it("are never read in container mode or in production", () => {
    expect(ok(readHostConfig({ ...CONTAINER, ...windows }, [], SMALL)).test).toEqual({ connectSeconds: null, controlSeconds: null, firewallSeconds: null });
    expect(ok(readHostConfig({ ...CONTAINER, NODE_ENV: "development", ...windows }, [], SMALL)).test).toEqual({ connectSeconds: null, controlSeconds: null, firewallSeconds: null });
  });

  it("refuses a window out of range", () => {
    expect(refusals(readHostConfig({ BROWSER_HOST_KEY: "k", BROWSER_HOST_TEST_CONNECT_SECONDS: "0" }, [], LAPTOP))).toContain("test_window");
  });
});
