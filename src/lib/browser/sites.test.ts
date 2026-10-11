// Where a teammate's browser may go (src/lib/browser/sites.ts,
// docs/plans/ai-teammates-phase4.md Decisions 9 and 10): an entry is a host,
// never an address of numbers, a private name, the app or a bare top-level
// wildcard; a navigation is https on the default port with no credentials,
// never to a private, internal or WorkwrK host, never to a blocked one, and
// only to an allowed one.

import { describe, expect, it } from "vitest";
import { FIXTURE_SUFFIX, appHostsFrom, effectiveSites, entryMatches, neverReason, parseSiteEntry, reachPrintInput, siteOf, siteVerdict, type SiteRules } from "./sites";

const APP = { appHosts: ["app.acme-workwrk.test", "workwrk.com"] };

const rules = (o: Partial<SiteRules> = {}): SiteRules => ({ allow: [], block: [], appHosts: APP.appHosts, schemes: ["https:"], fixtureSuffix: null, ...o });

describe("parseSiteEntry", () => {
  it("reads a host, a pasted address and a wildcard as the entry they mean", () => {
    expect(parseSiteEntry("Example.COM.", APP)).toEqual({ ok: true, entry: "example.com" });
    expect(parseSiteEntry("https://shop.example.com/cart?x=1", APP)).toEqual({ ok: true, entry: "shop.example.com" });
    expect(parseSiteEntry("*.example.com", APP)).toEqual({ ok: true, entry: "*.example.com" });
    expect(parseSiteEntry("  www.Example.com/path#top ", APP)).toEqual({ ok: true, entry: "www.example.com" });
    // An international name in its ASCII form, as the browser asks for it.
    expect(parseSiteEntry("bücher.de", APP)).toEqual({ ok: true, entry: "xn--bcher-kva.de" });
  });

  it("refuses every address made of numbers, in any notation", () => {
    for (const raw of ["127.0.0.1", "0x7f.1", "2130706433", "[::1]", "169.254.169.254", "0177.0.0.1", "127.1", "https://10.0.0.8/admin"]) {
      expect(parseSiteEntry(raw, APP), raw).toEqual({ ok: false, problem: "ip" });
    }
  });

  it("refuses private and internal names, the app, a bare wildcard, a port and credentials, each with its problem", () => {
    expect(parseSiteEntry("localhost", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("printer.local", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("metadata.google.internal", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("intranet", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("router.home.arpa", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("files.corp", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("api.localhost", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("app.workwrk.com", APP)).toEqual({ ok: false, problem: "app" });
    expect(parseSiteEntry("workwrk.com", APP)).toEqual({ ok: false, problem: "app" });
    expect(parseSiteEntry("*.workwrk.com", APP)).toEqual({ ok: false, problem: "app" });
    expect(parseSiteEntry("app.acme-workwrk.test", { appHosts: ["app.acme-workwrk.test"] })).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("app.acme.example.org", { appHosts: ["app.acme.example.org"] })).toEqual({ ok: false, problem: "app" });
    expect(parseSiteEntry("*.com", APP)).toEqual({ ok: false, problem: "wildcard" });
    expect(parseSiteEntry("ex*ample.com", APP)).toEqual({ ok: false, problem: "wildcard" });
    expect(parseSiteEntry("*.*.example.com", APP)).toEqual({ ok: false, problem: "wildcard" });
    expect(parseSiteEntry("example.com:8443", APP)).toEqual({ ok: false, problem: "port" });
    expect(parseSiteEntry("http://example.com:443", APP)).toEqual({ ok: false, problem: "port" });
    expect(parseSiteEntry("user:pw@example.com", APP)).toEqual({ ok: false, problem: "credentials" });
    expect(parseSiteEntry("https://user@example.com", APP)).toEqual({ ok: false, problem: "credentials" });
    expect(parseSiteEntry("", APP)).toEqual({ ok: false, problem: "invalid" });
    expect(parseSiteEntry("ftp://example.com", APP)).toEqual({ ok: false, problem: "invalid" });
    expect(parseSiteEntry("exa mple.com", APP)).toEqual({ ok: false, problem: "invalid" });
    expect(parseSiteEntry("a..b.com", APP)).toEqual({ ok: false, problem: "invalid" });
    expect(parseSiteEntry("-a.example.com", APP)).toEqual({ ok: false, problem: "invalid" });
    expect(parseSiteEntry(`${"a".repeat(64)}.com`, APP)).toEqual({ ok: false, problem: "too_long" });
    expect(parseSiteEntry(`${"abcdefghi.".repeat(26)}com`, APP)).toEqual({ ok: false, problem: "too_long" });
    expect(parseSiteEntry("x".repeat(2001), APP)).toEqual({ ok: false, problem: "too_long" });
  });

  // Review of Phase 4 step 1: "*.co.uk" and "*.github.io" passed as wildcards
  // over two labels, and were every stranger's site there.
  it("refuses a wildcard over a public suffix or a shared cloud, and keeps one over a company's own name (review of Phase 4 step 1)", () => {
    for (const raw of ["*.co.uk", "*.github.io", "*.com.au", "*.herokuapp.com", "*.co.ke", "*.s3.amazonaws.com", "*.amazonaws.com", "*.blogspot.com", "*.vercel.app", "*.myshopify.com", "*.core.windows.net", "*.ngrok-free.app", "*.pages.dev"]) {
      expect(parseSiteEntry(raw, APP), raw).toEqual({ ok: false, problem: "wildcard" });
    }
    expect(parseSiteEntry("*.example.co.uk", APP)).toEqual({ ok: true, entry: "*.example.co.uk" });
    expect(parseSiteEntry("*.acme.github.io", APP)).toEqual({ ok: true, entry: "*.acme.github.io" });
    // The bare names are sites like any other (an entry covers only itself and www).
    expect(parseSiteEntry("acme.github.io", APP)).toEqual({ ok: true, entry: "acme.github.io" });
    expect(parseSiteEntry("github.io", APP)).toEqual({ ok: true, entry: "github.io" });
  });

  it("never allows a wildcard DNS name, which is any address, as an entry or as a host (review of Phase 4 step 1)", () => {
    for (const raw of ["nip.io", "*.nip.io", "10.0.0.8.nip.io", "app-169-254-169-254.nip.io", "sslip.io", "a.sslip.io", "x.xip.io", "www.localtest.me", "api.lvh.me", "vcap.me", "x.traefik.me", "abc.localhost.run"]) {
      expect(parseSiteEntry(raw, APP), raw).toEqual({ ok: false, problem: "internal" });
    }
    expect(neverReason("10.0.0.8.nip.io", { appHosts: [], fixtureSuffix: null })).toBe("internal");
    const r = rules({ allow: ["*.nip.io", "10.0.0.8.nip.io"] });
    expect(siteVerdict("https://10.0.0.8.nip.io/latest/meta-data", r)).toMatchObject({ ok: false, code: "never" });
    expect(siteVerdict("https://app.lvh.me/", rules({ allow: ["*.lvh.me"] }))).toMatchObject({ ok: false, code: "never" });
  });

  it("parses the stand-in's fixture sites only when its suffix is passed, from the stand-in's config (review of Phase 4 step 1)", () => {
    // Before: parseSiteEntry always passed no suffix, so no fixture site could ever be listed.
    expect(parseSiteEntry("docs.proof.test", APP)).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("docs.proof.test", { ...APP, fixtureSuffix: null })).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("docs.proof.test", { ...APP, fixtureSuffix: FIXTURE_SUFFIX })).toEqual({ ok: true, entry: "docs.proof.test" });
    expect(parseSiteEntry("http://shop.proof.test/buy", { ...APP, fixtureSuffix: FIXTURE_SUFFIX })).toEqual({ ok: true, entry: "shop.proof.test" });
    // The suffix itself, a wildcard over it, and any other .test name stay refused.
    expect(parseSiteEntry("proof.test", { ...APP, fixtureSuffix: FIXTURE_SUFFIX })).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("*.proof.test", { ...APP, fixtureSuffix: FIXTURE_SUFFIX })).toEqual({ ok: false, problem: "internal" });
    expect(parseSiteEntry("evil.test", { ...APP, fixtureSuffix: FIXTURE_SUFFIX })).toEqual({ ok: false, problem: "internal" });
  });
});

describe("entryMatches", () => {
  it("covers a host and its www, or with a star the host and every subdomain", () => {
    expect(entryMatches("example.com", "example.com")).toBe(true);
    expect(entryMatches("example.com", "www.example.com")).toBe(true);
    expect(entryMatches("example.com", "api.example.com")).toBe(false);
    expect(entryMatches("example.com", "badexample.com")).toBe(false);
    expect(entryMatches("*.example.com", "example.com")).toBe(true);
    expect(entryMatches("*.example.com", "a.b.example.com")).toBe(true);
    expect(entryMatches("*.example.com", "example.com.evil.test")).toBe(false);
    expect(entryMatches("*.example.com", "notexample.com")).toBe(false);
  });
});

describe("siteVerdict", () => {
  it("opens only secure pages on the default port with no credentials", () => {
    const r = rules({ allow: ["example.com"] });
    expect(siteVerdict("http://example.com", r)).toEqual({ ok: false, code: "not_https", site: "example.com" });
    expect(siteVerdict("https://example.com:8443/", r)).toEqual({ ok: false, code: "port", site: "example.com" });
    expect(siteVerdict("https://max:pw@example.com/", r)).toEqual({ ok: false, code: "credentials", site: "example.com" });
    expect(siteVerdict("not a url", r)).toEqual({ ok: false, code: "bad_url", site: null });
    expect(siteVerdict("javascript:alert(1)", r)).toMatchObject({ ok: false, code: "not_https" });
    expect(siteVerdict("file:///etc/passwd", r)).toMatchObject({ ok: false, code: "not_https" });
    expect(siteVerdict("https://example.com/a?b=1#c", r)).toEqual({ ok: true, site: "example.com" });
  });

  it("lets the block list win over a wildcard, and refuses what no entry allows", () => {
    const r = rules({ allow: ["*.example.com"], block: ["evil.example.com"] });
    expect(siteVerdict("https://evil.example.com/", r)).toEqual({ ok: false, code: "blocked", site: "evil.example.com" });
    expect(siteVerdict("https://www.evil.example.com/", r)).toEqual({ ok: false, code: "blocked", site: "www.evil.example.com" });
    expect(siteVerdict("https://shop.example.com/", r)).toEqual({ ok: true, site: "shop.example.com" });
    expect(siteVerdict("https://example.org/", r)).toEqual({ ok: false, code: "not_allowed", site: "example.org" });
  });

  it("honours no wildcard over strangers' sites, however it reached the allow list (review of Phase 4 step 1)", () => {
    // Written by hand, or before the refusal: the guard opens nothing through it, and the block list still counts.
    const r = rules({ allow: ["*.co.uk", "*.github.io", "acme.github.io"], block: ["*.evil.github.io"] });
    expect(siteVerdict("https://evil.co.uk/", r)).toEqual({ ok: false, code: "not_allowed", site: "evil.co.uk" });
    expect(siteVerdict("https://stranger.github.io/", r)).toEqual({ ok: false, code: "not_allowed", site: "stranger.github.io" });
    expect(siteVerdict("https://acme.github.io/docs", r)).toEqual({ ok: true, site: "acme.github.io" });
    expect(siteVerdict("https://evil.github.io/", r)).toEqual({ ok: false, code: "blocked", site: "evil.github.io" });
    expect(effectiveSites(["*.co.uk", "acme.github.io"], { allow: ["*.co.uk", "acme.github.io"], block: [] })).toEqual(["acme.github.io"]);
  });

  it("allows www by the bare entry, and no other subdomain", () => {
    const r = rules({ allow: ["example.com"] });
    expect(siteVerdict("https://www.example.com/", r)).toEqual({ ok: true, site: "www.example.com" });
    expect(siteVerdict("https://api.example.com/", r)).toEqual({ ok: false, code: "not_allowed", site: "api.example.com" });
  });

  it("refuses an address of numbers, a private name or the app even when a list names it", () => {
    const r = rules({ allow: ["127.0.0.1", "*.internal", "localhost", "app.workwrk.com", "*.workwrk.com"] });
    for (const url of ["https://127.0.0.1/", "https://0x7f.1/", "https://2130706433/", "https://[::1]/", "https://[::ffff:7f00:1]/", "https://169.254.169.254/latest/meta-data"]) {
      expect(siteVerdict(url, r), url).toMatchObject({ ok: false, code: "never" });
    }
    expect(siteVerdict("https://metadata.google.internal/", r)).toMatchObject({ ok: false, code: "never" });
    expect(siteVerdict("https://localhost/", r)).toMatchObject({ ok: false, code: "never" });
    expect(siteVerdict("https://app.workwrk.com/settings", r)).toMatchObject({ ok: false, code: "never" });
    expect(siteVerdict("https://app.acme-workwrk.test/", rules({ allow: ["*.acme-workwrk.test"] }))).toMatchObject({ ok: false, code: "never" });
  });

  it("opens a stand-in fixture over http only when its suffix is set (Decision 2)", () => {
    const fixtures = rules({ allow: ["docs.proof.test", "*.proof.test"], schemes: ["https:", "http:"] });
    // Production: no suffix, so a .test name is private and http is never secure.
    expect(siteVerdict("http://docs.proof.test/", fixtures)).toMatchObject({ ok: false, code: "not_https" });
    expect(siteVerdict("https://docs.proof.test/", fixtures)).toMatchObject({ ok: false, code: "never" });
    const standIn = { ...fixtures, fixtureSuffix: FIXTURE_SUFFIX };
    expect(siteVerdict("http://docs.proof.test/", standIn)).toEqual({ ok: true, site: "docs.proof.test" });
    expect(siteVerdict("http://shop.proof.test/buy-now?item=giftcard", standIn)).toEqual({ ok: true, site: "shop.proof.test" });
    // Even then, http only for a fixture, and an address of numbers never.
    expect(siteVerdict("http://example.com/", { ...standIn, allow: ["example.com"] })).toMatchObject({ ok: false, code: "not_https" });
    expect(siteVerdict("http://127.0.0.1:8790/", standIn)).toMatchObject({ ok: false });
    expect(neverReason("proof.test", { appHosts: [], fixtureSuffix: FIXTURE_SUFFIX })).toBe("internal");
  });
});

describe("siteOf, effectiveSites and appHostsFrom", () => {
  it("reads a URL's host in lower case, and nothing from what has none", () => {
    expect(siteOf("https://Shop.Example.COM./cart")).toBe("shop.example.com");
    expect(siteOf("https://[::1]:8080/")).toBe("[::1]");
    expect(siteOf("about:blank")).toBeNull();
    expect(siteOf("data:text/html,hi")).toBeNull();
    expect(siteOf("nope")).toBeNull();
    expect(siteOf("https://example.com../")).toBeNull();
  });

  it("gives a teammate only its entries the workspace allows, less any the block list matches", () => {
    const workspace = { allow: ["docs.example.com", "*.shop.example.com", "example.org"], block: ["example.org"] };
    expect(effectiveSites(["docs.example.com", "*.shop.example.com", "example.org", "elsewhere.com", "docs.example.com"], workspace)).toEqual(["*.shop.example.com", "docs.example.com"]);
    // A wildcard whose own host is blocked goes whole: the block list always wins.
    expect(effectiveSites(["*.shop.example.com"], { allow: ["*.shop.example.com"], block: ["shop.example.com"] })).toEqual([]);
    expect(effectiveSites(["*.shop.example.com"], { allow: ["*.shop.example.com"], block: ["*.example.com"] })).toEqual([]);
    // A narrower block entry leaves the wildcard; the guard refuses the blocked host itself.
    expect(effectiveSites(["*.shop.example.com"], { allow: ["*.shop.example.com"], block: ["pay.shop.example.com"] })).toEqual(["*.shop.example.com"]);
    expect(effectiveSites([], workspace)).toEqual([]);
  });

  // Review of Phase 4 step 1: a Google allow's sites part prints this, so
  // the workspace's lists move it as surely as the teammate's own list.
  it("prints a teammate's reach: its entries the workspace holds, and the block entries inside them, sorted once each", () => {
    const teammate = ["shop.example.com", "*.docs.example.com", "elsewhere.example.org", "shop.example.com"];
    expect(reachPrintInput(teammate, { allow: [], block: [] })).toEqual([]);
    expect(reachPrintInput(teammate, { allow: ["shop.example.com"], block: [] })).toEqual(["shop.example.com"]);
    expect(reachPrintInput(teammate, { allow: ["*.docs.example.com", "shop.example.com"], block: [] })).toEqual(["*.docs.example.com", "shop.example.com"]);
    // A block entry under a wildcard, over an entry, or over the entry's www is inside the reach; one elsewhere is not.
    expect(reachPrintInput(teammate, { allow: ["*.docs.example.com", "shop.example.com"], block: ["pay.docs.example.com", "other.example.org", "pay.docs.example.com"] })).toEqual(["!pay.docs.example.com", "*.docs.example.com", "shop.example.com"]);
    expect(reachPrintInput(["shop.example.com"], { allow: ["shop.example.com"], block: ["*.example.com"] })).toEqual(["!*.example.com", "shop.example.com"]);
    expect(reachPrintInput(["shop.example.com"], { allow: ["shop.example.com"], block: ["www.shop.example.com"] })).toEqual(["!www.shop.example.com", "shop.example.com"]);
    expect(reachPrintInput(["shop.example.com"], { allow: ["shop.example.com"], block: ["api.shop.example.com"] })).toEqual(["shop.example.com"]);
    // Case and a trailing dot do not change it; a wildcard the guard never honours is no reach.
    expect(reachPrintInput(["Shop.Example.COM."], { allow: ["shop.example.com"], block: [] })).toEqual(["shop.example.com"]);
    expect(reachPrintInput(["*.co.uk"], { allow: ["*.co.uk"], block: [] })).toEqual([]);
    expect(reachPrintInput([1, null, "shop.example.com"] as unknown[], { allow: ["shop.example.com"], block: [] })).toEqual(["shop.example.com"]);
  });

  it("names the app's own hosts and workwrk.com", () => {
    const hosts = appHostsFrom({ NEXT_PUBLIC_APP_URL: "https://App.Acme.example.org", NEXTAUTH_URL: "https://login.acme.example.org/api", ADMIN_HOST: "admin.acme.example.org:3000" } as unknown as NodeJS.ProcessEnv);
    expect(hosts.sort()).toEqual(["admin.acme.example.org", "app.acme.example.org", "login.acme.example.org", "workwrk.com"]);
    expect(appHostsFrom({} as unknown as NodeJS.ProcessEnv)).toEqual(["workwrk.com"]);
    expect(neverReason("app.acme.example.org", { appHosts: hosts, fixtureSuffix: null })).toBe("app");
    expect(neverReason("www.workwrk.com", { appHosts: [], fixtureSuffix: null })).toBe("app");
    expect(neverReason("example.com", { appHosts: hosts, fixtureSuffix: null })).toBeNull();
  });
});
