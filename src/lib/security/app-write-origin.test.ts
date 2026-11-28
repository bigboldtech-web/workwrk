import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appWriteOriginRefused } from "./app-write-origin";

// Pen test 2026-11-28 (V-22): every app write accepted a request from a
// workwrk.com sibling (marketing, a hosted docs site, a taken-over
// subdomain), whose SameSite=Lax cookie rides along as "same site".

const H = (h: Record<string, string>) => new Headers({ host: "app.workwrk.com", ...h });
const write = (headers: Headers, opts: { path?: string; method?: string; cookie?: boolean } = {}) =>
  appWriteOriginRefused({ method: opts.method ?? "POST", path: opts.path ?? "/api/items/x", headers, hasSessionCookie: opts.cookie ?? true });

describe("a write carrying the session cookie", () => {
  it("from the app itself is accepted", () => {
    expect(write(H({ origin: "https://app.workwrk.com", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("from a sibling subdomain is refused (the attack: same site, other origin)", () => {
    expect(write(H({ origin: "https://workwrk.com", "sec-fetch-site": "same-site" }))).toBe(true);
    expect(write(H({ origin: "https://docs.workwrk.com" }))).toBe(true);
    expect(write(H({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("from another site, or an opaque origin, is refused", () => {
    expect(write(H({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(write(H({ origin: "null" }))).toBe(true);
    expect(write(H({ origin: "not a url" }))).toBe(true);
  });

  it("every write verb is covered", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(write(H({ origin: "https://workwrk.com" }), { method })).toBe(true);
    }
  });

  it("from the WorkwrK browser extension is accepted (no web page can send its origin)", () => {
    expect(write(H({ origin: "chrome-extension://abcdef", "sec-fetch-site": "none" }), { path: "/api/sops/record" })).toBe(false);
    expect(write(H({ origin: "moz-extension://abcdef" }), { path: "/api/uploads/presign" })).toBe(false);
  });

  it("with neither header (curl, a script) goes on to the route's own gate", () => {
    expect(write(H({}))).toBe(false);
  });
});

describe("not refused", () => {
  it("a read", () => {
    expect(write(H({ origin: "https://workwrk.com", "sec-fetch-site": "same-site" }), { method: "GET" })).toBe(false);
  });

  it("a request without the session cookie (nobody's session rides on it)", () => {
    expect(write(H({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), { cookie: false })).toBe(false);
  });

  it("an API client, an MCP or SCIM client, cron or curl (no browser headers) on any route", () => {
    for (const path of ["/api/v1/people", "/api/scim/v2/Users", "/api/mcp", "/api/oauth/token", "/api/cron/digest", "/api/auth/mfa/enroll"]) {
      expect(write(H({}), { path }), path).toBe(false);
    }
  });

  it("the staff console, which has its own guard", () => {
    expect(write(H({ origin: "https://workwrk.com" }), { path: "/api/admin/companies" })).toBe(false);
  });
});

describe("no route is a forgery door (the step 4 review, high)", () => {
  it("v1 (an Owner's cookie has every scope), MCP, SCIM, OAuth, auth routes and public doors are refused from a sibling page", () => {
    for (const path of ["/api/v1/people", "/api/auth/mfa/enroll", "/api/auth/accept-invite", "/api/mcp", "/api/scim/v2/Users", "/api/oauth/token", "/api/public/forms/x/submit", "/api/cron/digest"]) {
      expect(write(H({ origin: "https://workwrk.com", "sec-fetch-site": "same-site" }), { path }), path).toBe(true);
    }
  });

  it("guard: a look-alike of the staff console is not exempt", () => {
    expect(write(H({ origin: "https://workwrk.com" }), { path: "/api/admin-x" })).toBe(true);
    expect(write(H({ origin: "https://workwrk.com" }), { path: "/api/administrators" })).toBe(true);
  });
});

describe("the proxy uses it", () => {
  it("for every /api write, with the session cookie's presence", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    // hasSessionCookie counts a chunked token (.0, .1) too.
    expect(proxy).toMatch(/appWriteOriginRefused\(\{\s+method: req\.method,\s+path,\s+headers: req\.headers,[\s\S]{0,120}hasSessionCookie: hasSessionCookie\(req\),/);
    expect(proxy).toMatch(/if \(c\.name === b \|\| c\.name\.startsWith\(b \+ "\."\)\) return true;/);
  });
});
