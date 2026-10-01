import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SEGMENTS, safeCallbackUrl } from "./safe-callback";
import { WORK_HOME_HREF } from "./route-hub";

function proxySet(name: string): Set<string> {
  const src = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
  const start = src.indexOf(`const ${name} = new Set([`);
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("]);", start));
  const withoutComments = body.replace(/\/\/[^\n]*/g, "");
  return new Set([...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

describe("safeCallbackUrl", () => {
  it("keeps the app-host segment list equal to the proxy's APP_PREFIXES", () => {
    expect([...APP_SEGMENTS].sort()).toEqual([...proxySet("APP_PREFIXES")].sort());
  });

  it("accepts a same-origin app path with its query and hash", () => {
    expect(safeCallbackUrl("/spaces/abc?view=board#x")).toBe("/spaces/abc?view=board#x");
    expect(safeCallbackUrl("/join?token=abc")).toBe("/join?token=abc");
    expect(safeCallbackUrl("/admin")).toBe("/admin");
    expect(safeCallbackUrl("/share/doc/tok")).toBe("/share/doc/tok");
  });

  it("refuses an absolute URL", () => {
    expect(safeCallbackUrl("https://evil.example/home")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("javascript:alert(1)")).toBe(WORK_HOME_HREF);
  });

  it("refuses a protocol-relative URL and backslash tricks", () => {
    expect(safeCallbackUrl("//evil.example/home")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/\\evil.example")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/%0a/evil")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/\tevil")).toBe(WORK_HOME_HREF);
  });

  it("refuses a marketing path, the API and the root", () => {
    expect(safeCallbackUrl("/pricing")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/api/export/all")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/")).toBe(WORK_HOME_HREF);
  });

  it("refuses a loop back into a sign-in page", () => {
    expect(safeCallbackUrl("/login?callbackUrl=/home")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/signup")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/reset-password?token=x")).toBe(WORK_HOME_HREF);
  });

  it("falls back on nothing, junk and the caller's fallback", () => {
    expect(safeCallbackUrl(null)).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("home")).toBe(WORK_HOME_HREF);
    expect(safeCallbackUrl("/nope", "/admin")).toBe("/admin");
  });
});
