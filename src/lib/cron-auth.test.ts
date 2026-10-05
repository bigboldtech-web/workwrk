import { describe, expect, it } from "vitest";
import { cronRefusal, cronSecretMatches, providedCronSecret } from "./cron-auth";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/cron/x", { method: "POST", headers });

describe("cronRefusal", () => {
  it("runs nothing with no secret configured, whatever the request carries", async () => {
    for (const env of [{}, { CRON_SECRET: "" }, { CRON_SECRET: "   " }]) {
      const r = cronRefusal(req({ "x-cron-secret": "anything" }), env);
      expect(r?.status).toBe(503);
    }
    // The old "Bearer undefined" hole: nothing is configured, so nothing matches.
    expect(cronRefusal(req({ authorization: "Bearer undefined" }), {})?.status).toBe(503);
  });

  it("refuses a missing or wrong secret", () => {
    const env = { CRON_SECRET: "s3cret" };
    expect(cronRefusal(req(), env)?.status).toBe(403);
    expect(cronRefusal(req({ "x-cron-secret": "" }), env)?.status).toBe(403);
    expect(cronRefusal(req({ "x-cron-secret": "s3cre" }), env)?.status).toBe(403);
    expect(cronRefusal(req({ "x-cron-secret": "s3cret!" }), env)?.status).toBe(403);
    expect(cronRefusal(req({ authorization: "Bearer wrong" }), env)?.status).toBe(403);
  });

  it("opens for the secret in either header the routes accepted before", () => {
    const env = { CRON_SECRET: "s3cret" };
    expect(cronRefusal(req({ "x-cron-secret": "s3cret" }), env)).toBeNull();
    expect(cronRefusal(req({ authorization: "Bearer s3cret" }), env)).toBeNull();
    expect(cronRefusal(req({ authorization: "bearer s3cret" }), env)).toBeNull();
  });

  it("accepts the configured value as written and trimmed, as the old routes did", () => {
    const env = { CRON_SECRET: "s3cret\n" };
    expect(cronRefusal(req({ "x-cron-secret": "s3cret" }), env)).toBeNull();
  });

  it("reads x-cron-secret first, as every route did", () => {
    expect(providedCronSecret(new Headers({ "x-cron-secret": "a", authorization: "Bearer b" }))).toBe("a");
    expect(providedCronSecret(new Headers({ authorization: "Bearer b" }))).toBe("b");
    expect(providedCronSecret(new Headers())).toBe("");
  });

  it("compares in constant time over unequal lengths", () => {
    expect(cronSecretMatches("a", "a")).toBe(true);
    expect(cronSecretMatches("a", "ab")).toBe(false);
    expect(cronSecretMatches("", "a")).toBe(false);
  });
});
