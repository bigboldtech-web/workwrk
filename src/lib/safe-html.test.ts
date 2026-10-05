import { describe, expect, it } from "vitest";
import { safeStoredContent, safeUserHtml } from "./safe-html";

// Payloads that ran through the old regex blocklist, and the usual others.
const ATTACKS = [
  `<img/onerror=alert(1) src=x>`,
  `<svg/onload=alert(1)>`,
  `<img src=x onerror="alert(1)">`,
  `<IMG SRC=x ONERROR=alert(1)>`,
  `<a href="javascript:alert(1)">x</a>`,
  `<a href="  JaVaScRiPt:alert(1)">x</a>`,
  `<a href="&#106;avascript:alert(1)">x</a>`,
  `<a href="java&#x09;script:alert(1)">x</a>`,
  `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
  `<script>alert(1)</script>`,
  `<iframe src="https://evil.example"></iframe>`,
  `<object data="x"></object><embed src="x">`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
  `<div style="background:url(javascript:alert(1))">x</div>`,
  `<p style="behavior:url(x.htc)">x</p>`,
  `<details open ontoggle=alert(1)>`,
  `<form action="https://evil.example"><input name="password"></form>`,
  `<base href="https://evil.example/">`,
  `<meta http-equiv="refresh" content="0;url=https://evil.example">`,
  `<a href="https://ok.example" onclick="alert(1)">x</a>`,
];

describe("safeUserHtml", () => {
  it("leaves nothing that can run, load a frame, submit or redirect", () => {
    for (const attack of ATTACKS) {
      const out = safeUserHtml(attack).toLowerCase();
      expect(out, attack).not.toMatch(/<script|<iframe|<object|<embed|<svg|<math|<form|<input|<base|<meta|<style|<details/);
      expect(out, attack).not.toMatch(/\son[a-z]+\s*=|javascript:|data:text|behavior|url\(/);
    }
  });

  it("keeps the formatting the editors write", () => {
    const html = `<h2>Steps</h2><p><strong>Open</strong> the <em>panel</em>, then <a href="https://help.example/x" target="_blank">read this</a>.</p><ul><li>One</li><li>Two</li></ul><p style="text-align: center; color: #ff0000">Centered</p>`;
    const out = safeUserHtml(html);
    expect(out).toContain("<h2>Steps</h2>");
    expect(out).toContain("<strong>Open</strong>");
    expect(out).toContain('<a href="https://help.example/x" target="_blank" rel="noopener noreferrer">read this</a>');
    expect(out).toContain("<li>One</li>");
    expect(out).toContain('style="text-align:center;color:#ff0000"');
  });

  it("keeps images from the web and pasted data images, nothing else", () => {
    expect(safeUserHtml(`<img src="https://cdn.example/a.png" alt="a">`)).toBe(`<img src="https://cdn.example/a.png" alt="a" />`);
    expect(safeUserHtml(`<img src="data:image/png;base64,AAAA">`)).toContain("data:image/png");
    expect(safeUserHtml(`<img src="javascript:alert(1)">`)).not.toContain("javascript");
  });

  it("returns nothing for nothing", () => {
    expect(safeUserHtml("")).toBe("");
    expect(safeUserHtml(undefined)).toBe("");
    expect(safeUserHtml(42)).toBe("");
  });
});

describe("safeStoredContent", () => {
  it("sanitizes every html and description that holds a tag, at any depth", () => {
    const content = {
      type: "steps",
      html: `<p>ok</p><img/onerror=alert(1) src=x>`,
      steps: [{ title: "<b>kept as typed</b>", description: `<svg/onload=alert(1)></svg><p>Step</p>` }],
      sections: [{ steps: [{ description: `<a href="javascript:alert(1)">x</a>` }] }],
      flow: { steps: [{ description: "<p onclick=alert(1)>Go</p>" }] },
    };
    const out = safeStoredContent(content);
    const text = JSON.stringify(out).toLowerCase();
    expect(text).not.toMatch(/onerror|onload|onclick|javascript:|<svg/);
    expect(out.steps[0].title).toBe("<b>kept as typed</b>");
    expect(out.steps[0].description).toContain("<p>Step</p>");
  });

  it("drops the rest of a description after an unclosed dangerous element", () => {
    expect(safeStoredContent({ description: `<svg/onload=alert(1)><p>after</p>` }).description).toBe("");
  });

  it("leaves plain text exactly as typed, and other values alone", () => {
    const content = { steps: [{ description: "Use a < b and 3 > 2, then press Enter", order: 1, done: false }], type: "recorded" };
    expect(safeStoredContent(content)).toEqual(content);
    expect(safeStoredContent(null)).toBeNull();
  });
});
