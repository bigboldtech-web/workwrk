import { describe, expect, it } from "vitest";
import { safeUserHtml } from "./safe-html";

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

describe("the editor's own structures", () => {
  it("keeps task lists with their ticks, and no input but a checkbox", () => {
    const html = `<ul data-type="taskList" class="rich-task-list"><li data-checked="true" data-type="taskItem" class="rich-task-item"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li></ul><input type="password" name="p"><input type="hidden" value="x">`;
    const out = safeUserHtml(html);
    expect(out).toContain('<ul data-type="taskList" class="rich-task-list">');
    expect(out).toContain('<li data-checked="true" data-type="taskItem" class="rich-task-item">');
    expect(out).toContain('<input type="checkbox" checked="checked" />');
    expect(out).not.toMatch(/password|hidden/);
  });

  it("keeps resizable tables, highlights and aligned text", () => {
    const html = `<table style="min-width: 75px"><colgroup><col style="width: 120px"></colgroup><tbody><tr><td colspan="1" rowspan="1" colwidth="120"><p>a</p></td></tr></tbody></table><mark data-color="#ffc078" style="background-color: #ffc078; color: inherit">hi</mark><p style="text-align: center">c</p>`;
    const out = safeUserHtml(html);
    expect(out).toContain('style="min-width:75px"');
    expect(out).toContain('<col style="width:120px" />');
    expect(out).toContain('colwidth="120"');
    expect(out).toContain('data-color="#ffc078"');
    expect(out).toContain("text-align:center");
  });

  it("never lets a style smuggle a URL or an expression", () => {
    for (const bad of [`<td style="width: expression(alert(1))">x</td>`, `<col style="width: url(javascript:alert(1))">`, `<p style="min-width: 10px; background-image: url(x)">x</p>`]) {
      expect(safeUserHtml(bad).toLowerCase()).not.toMatch(/expression|url\(|javascript/);
    }
  });

  it("keeps the link schemes the editor writes, and still drops the dangerous ones", () => {
    for (const href of ["sms:+15551234567", "ftp://files.example/f.pdf", "ftps://files.example/f", "callto:+15551234567", "xmpp:ops@chat.example", "tel:+15551234567", "mailto:hr@acme.example"]) {
      expect(safeUserHtml(`<a href="${href}">x</a>`), href).toContain(`href="${href}"`);
    }
    for (const bad of [`<a href="javascript:alert(1)">x</a>`, `<a href="data:text/html,x">x</a>`, `<a href="vbscript:x">x</a>`, `<a href="file:///etc/passwd">x</a>`]) {
      expect(safeUserHtml(bad), bad).not.toContain("href");
    }
  });

  it("gives every link that opens elsewhere noopener", () => {
    expect(safeUserHtml(`<a href="https://x.example" target="other">x</a>`)).toContain('rel="noopener noreferrer"');
  });
});
