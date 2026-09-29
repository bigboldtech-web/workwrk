import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { onboardTarget, registerTarget } from "./auth-redirects";

type Row = { source: string; destination: string; permanent?: boolean; has?: { type: string; key: string }[] };

async function rows(): Promise<Row[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Row[]> }).redirects;
  return fn ? await fn() : [];
}

describe("the retired sign-in URLs", () => {
  it("send /welcome and /setup to the one wizard, permanently, from config and from the twins' rule", async () => {
    const all = await rows();
    for (const source of ["/welcome", "/setup"]) {
      const hit = all.find((r) => r.source === source && !r.has);
      expect(hit, source).toBeTruthy();
      expect(hit!.destination).toBe("/onboard");
      expect(hit!.permanent).toBe(true);
    }
    expect(onboardTarget(new URLSearchParams(""))).toBe("/onboard");
    expect(onboardTarget(new URLSearchParams("x=1"))).toBe("/onboard?x=1");
  });

  it("keeps an invitation link from before the split working", () => {
    expect(registerTarget(new URLSearchParams("token=abc"))).toBe("/join?token=abc");
    expect(registerTarget(new URLSearchParams("utm_content=hero"))).toBe("/signup?utm_content=hero");
  });

  it("no longer shadows /signup or /join with a config redirect", async () => {
    const all = await rows();
    expect(all.some((r) => r.source === "/signup" || r.source === "/join")).toBe(false);
  });
});
