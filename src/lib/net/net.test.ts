import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attributesOf, parseHeadMeta } from "./html-head";
import { fetchPublic } from "./public-fetch";

// Pen test 2026-11-28: V-10 (a crafted page froze the server through the link
// preview's regexes), V-09 and V-20 (server-side fetches of private
// addresses), V-17 and V-34 (canvas saves).

const ms = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("reading a page's head", () => {
  it("reads og tags, name tags, either attribute order, either quote, and the title", () => {
    const html = `<html><head><title>Plain &amp; simple</title>
      <meta property="og:title" content="The OG title">
      <META content='A description' NAME='description'>
      <meta name="twitter:image" content="/img.png" />
      <meta property="og:site_name" content="Site &quot;Name&quot;">
      </head><body><meta property="og:title" content="not in head"></body></html>`;
    const head = parseHeadMeta(html);
    expect(head.title).toBe("Plain & simple");
    expect(head.meta.get("og:title")).toBe("The OG title");
    expect(head.meta.get("description")).toBe("A description");
    expect(head.meta.get("twitter:image")).toBe("/img.png");
    expect(head.meta.get("og:site_name")).toBe('Site "Name"');
  });

  it("the first tag of a key wins, as the old matcher's first match did", () => {
    const head = parseHeadMeta(`<meta property="og:title" content="first"><meta property="og:title" content="second">`);
    expect(head.meta.get("og:title")).toBe("first");
  });

  it("attributes: unquoted values, bare attributes, a missing closing quote", () => {
    expect(attributesOf(` charset=utf-8 async name="x"`)).toEqual([["charset", "utf-8"], ["async", ""], ["name", "x"]]);
    expect(attributesOf(` content="unterminated`)).toEqual([["content", "unterminated"]]);
  });

  // The attacks: each took seconds to minutes with the old regexes.
  const KB256 = 262_144;
  const cases: Array<[string, string]> = [
    ["'<meta ' repeated with no '>'", "<meta ".repeat(Math.floor(KB256 / 6))],
    ["'<meta ' repeated, one '>' at the very end", "<meta ".repeat(Math.floor(KB256 / 6)) + ">"],
    ["one tag of a 256 KB attribute name", "<meta " + "a".repeat(KB256) + ">"],
    ["many tags of long attribute names", ("<meta " + "a".repeat(4000) + " >").repeat(60)],
    ["property= with no content, repeated", '<meta property="og:title" '.repeat(9000)],
    ["an unclosed title", "<title>" + "x".repeat(KB256)],
  ];
  for (const [name, page] of cases) {
    it(`a crafted page is read in linear time: ${name}`, () => {
      expect(ms(() => parseHeadMeta(page))).toBeLessThan(400);
    });
  }
});

describe("fetching a public address", () => {
  const go = (url: string, resolve?: (h: string) => Promise<Array<{ address: string; family: number }>>) =>
    fetchPublic(url, { signal: new AbortController().signal, resolve });

  for (const url of [
    "http://127.0.0.1:3007/api/health",
    "http://[::ffff:7f00:1]:3007/", // V-20: IPv4 inside IPv6
    "http://localhost./", // V-20: a trailing dot
    "http://localhost:3007/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://0x7f.1/", // 127.0.0.1 in another spelling
    "http://2130706433/", // and another
    "http://[::1]/",
  ]) {
    it(`refuses ${url}`, async () => {
      const r = await go(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("not_public");
    });
  }

  it("refuses a name that resolves to a private address, without connecting", async () => {
    const r = await go("http://looks-public.example.com/", async () => [{ address: "127.0.0.1", family: 4 }]);
    expect(r).toEqual({ ok: false, reason: "not_public" });
  });

  it("refuses a name when ANY of its addresses is private", async () => {
    const r = await go("https://mixed.example.com/", async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }]);
    expect(r).toEqual({ ok: false, reason: "not_public" });
  });

  it("refuses other schemes and user names", async () => {
    expect((await go("file:///etc/passwd")).ok).toBe(false);
    expect((await go("ftp://example.com/")).ok).toBe(false);
    expect((await go("http://user:pw@example.com/")).ok).toBe(false);
  });
});

describe("the routes use them", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the link preview fetches through fetchPublic and reads the head with the scanner, no regex matchers left", () => {
    const route = read("src/app/api/link-preview/route.ts");
    expect(route).toMatch(/await fetchPublic\(target\.toString\(\)/);
    expect(route).toMatch(/parseHeadMeta\(html\)/);
    expect(route).not.toMatch(/new RegExp|metaPatterns|isBlockedHost|await fetch\(/);
  });

  it("Summarize reads our own storage, and a file added by link from a public address only", () => {
    const route = read("src/app/api/files/[id]/summarize/route.ts");
    expect(route).toMatch(/await readUpload\(/);
    expect(route).toMatch(/await fetchPublic\(file\.url,/);
    expect(route).not.toMatch(/fetch\(fetchUrl\)|getOrigin|NEXTAUTH_URL/);
    // A network error is never handed back (it told open ports from closed ones).
    expect(route).toMatch(/err instanceof Unreadable \? err\.message : "Couldn't read this file\."/);
  });

  it("the canvas thumbnail never touches updatedAt, and takes Can edit (V-17)", () => {
    const route = read("src/app/api/whiteboards/[id]/thumbnail/route.ts");
    expect(route).toMatch(/prisma\.\$executeRaw`UPDATE "Whiteboard" SET "thumbnail" = \$\{parsed\.data\.dataUrl\} WHERE "id" = \$\{id\}`/);
    expect(route).not.toMatch(/prisma\.whiteboard\.update\(/);
    expect(route).toMatch(/if \(!roleAtLeast\(role, "EDIT"\)\) return NextResponse\.json\(\{ error: "read-only" \}, \{ status: 403 \}\);/);
  });

  it("a canvas save checks and writes in one step, so of two saves at once one gets the 409 (V-34)", () => {
    const route = read("src/app/api/whiteboards/[id]/route.ts");
    expect(route).toMatch(/updateMany\(\{ where: \{ id, updatedAt: existing\.updatedAt \}, data \}\)/);
    expect(route).toMatch(/if \(count === 0\) \{[\s\S]{0,500}status: 409/);
  });
});
