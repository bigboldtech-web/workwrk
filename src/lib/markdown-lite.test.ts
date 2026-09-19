import { describe, expect, it } from "vitest";
import {
  applyWrap,
  continueList,
  descriptionPreview,
  isBlankBody,
  parseInline,
  parseMarkdownLite,
  safeHref,
} from "./markdown-lite";

describe("safeHref", () => {
  it("passes http, https and mailto, and upgrades a bare www", () => {
    expect(safeHref("https://a.test/x")).toBe("https://a.test/x");
    expect(safeHref("http://a.test")).toBe("http://a.test");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("www.a.test")).toBe("https://www.a.test");
  });

  it("refuses everything that could execute", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,xx")).toBeNull();
    expect(safeHref("  JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});

describe("parseInline", () => {
  it("leaves plain text exactly as it was", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", value: "just words" }]);
  });

  it("reads bold, italic and both markers for italic", () => {
    expect(parseInline("a **b** c")).toContainEqual({ type: "bold", value: "b" });
    expect(parseInline("a *b* c")).toContainEqual({ type: "italic", value: "b" });
    expect(parseInline("a _b_ c")).toContainEqual({ type: "italic", value: "b" });
  });

  // The plain-text promise: markdown syntax that is not a pair stays literal.
  it("does not turn a lone asterisk or an underscored file name into formatting", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", value: "2 * 3 = 6" }]);
    expect(parseInline("see my_file_name.txt")).toEqual([{ type: "text", value: "see my_file_name.txt" }]);
  });

  // DATA INTEGRITY. A plain-text description written before the light editor
  // existed must come out of the renderer as the characters that went in. Two
  // asterisks on one line is the common shape (arithmetic, a glob, a footnote
  // marker) and the unguarded italic alternative ate both of them.
  it("keeps a PAIR of spaced asterisks literal in plain text", () => {
    expect(parseInline("5 * 3 * 2 math")).toEqual([{ type: "text", value: "5 * 3 * 2 math" }]);
    expect(parseInline("Use the * wildcard * here")).toEqual([
      { type: "text", value: "Use the * wildcard * here" },
    ]);
    expect(parseInline("*.ts and *.js")).toEqual([{ type: "text", value: "*.ts and *.js" }]);
    expect(parseInline("Budget check: 5 * 3 * 2 = 30 units")).toEqual([
      { type: "text", value: "Budget check: 5 * 3 * 2 = 30 units" },
    ]);
    // and the preview, which strips markers, must not strip these.
    expect(descriptionPreview("5 * 3 * 2 and a_b_c")).toBe("5 * 3 * 2 and a_b_c");
  });

  it("still reads a real italic run, including one holding a space", () => {
    expect(parseInline("a *two words* b")).toContainEqual({ type: "italic", value: "two words" });
    expect(parseInline("*x*")).toEqual([{ type: "italic", value: "x" }]);
  });

  it("prefers bold over italic so ** is never read as two *", () => {
    const nodes = parseInline("**shipped**");
    expect(nodes).toEqual([{ type: "bold", value: "shipped" }]);
  });

  it("reads a labelled link and drops an unsafe one back to text", () => {
    expect(parseInline("[docs](https://a.test)")).toEqual([
      { type: "link", href: "https://a.test", label: "docs" },
    ]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { type: "text", value: "[x](javascript:alert(1))" },
    ]);
  });

  it("auto-links a bare URL without swallowing the sentence's full stop", () => {
    const nodes = parseInline("see https://a.test/x now");
    expect(nodes).toContainEqual({ type: "link", href: "https://a.test/x", label: "https://a.test/x" });
    expect(nodes[nodes.length - 1]).toEqual({ type: "text", value: " now" });
  });

  it("reads an @mention token but not an email address", () => {
    expect(parseInline("ping @Ada Lovelace today")).toContainEqual({ type: "mention", label: "@Ada Lovelace" });
    expect(parseInline("write to ada@b.test")).not.toContainEqual(
      expect.objectContaining({ type: "mention" }),
    );
  });

  it("never loses a character: the nodes re-assemble into the source", () => {
    const samples = [
      "plain",
      "a **b** c *d* e",
      "see https://a.test and [x](https://y.test)",
      "ping @Ada Lovelace",
      "2 * 3",
    ];
    for (const s of samples) {
      const joined = parseInline(s)
        .map((n) => {
          switch (n.type) {
            case "bold": return `**${n.value}**`;
            case "italic": return `*${n.value}*`;
            // A bare URL is its own label; a labelled link re-writes as one.
            case "link": return n.label === n.href ? n.label : `[${n.label}](${n.href})`;
            case "mention": return n.label;
            default: return n.value;
          }
        })
        .join("");
      // Italic written with "_" re-assembles with "*", which is the same meaning.
      expect(joined.replace(/_/g, "*")).toBe(s.replace(/_/g, "*"));
    }
  });
});

describe("parseMarkdownLite", () => {
  it("keeps a plain paragraph with its line breaks", () => {
    const blocks = parseMarkdownLite("one\ntwo");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("splits paragraphs on a blank line", () => {
    expect(parseMarkdownLite("one\n\ntwo")).toHaveLength(2);
  });

  it("reads bullet and numbered lists and keeps their start number", () => {
    const blocks = parseMarkdownLite("- a\n- b\n\n3. c\n4. d");
    expect(blocks[0]).toMatchObject({ type: "bullets" });
    expect(blocks[1]).toMatchObject({ type: "numbers", start: 3 });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("does not read a hyphenated sentence as a list", () => {
    expect(parseMarkdownLite("well-known issue")[0].type).toBe("paragraph");
  });

  it("answers an empty list for an empty body", () => {
    expect(parseMarkdownLite("")).toEqual([]);
    expect(parseMarkdownLite("   \n  ")).toEqual([]);
  });

  it("normalises CRLF so a pasted Windows body is one paragraph, not doubled", () => {
    expect(parseMarkdownLite("one\r\ntwo")).toHaveLength(1);
  });
});

describe("isBlankBody", () => {
  it("treats null, empty and whitespace as blank", () => {
    expect(isBlankBody(null)).toBe(true);
    expect(isBlankBody("")).toBe(true);
    expect(isBlankBody("  \n ")).toBe(true);
    expect(isBlankBody("x")).toBe(false);
  });
});

describe("applyWrap", () => {
  it("wraps a selection and selects the wrapped text", () => {
    const r = applyWrap("hello world", 6, 11, "bold");
    expect(r.value).toBe("hello **world**");
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe("world");
  });

  it("toggles back off, so two clicks leave the text as it was", () => {
    const on = applyWrap("hello world", 6, 11, "bold");
    const off = applyWrap(on.value, on.selectionStart - 2, on.selectionEnd + 2, "bold");
    expect(off.value).toBe("hello world");
  });

  it("inserts a placeholder when nothing is selected, and selects it", () => {
    const r = applyWrap("", 0, 0, "italic");
    expect(r.value).toBe("*italic text*");
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe("italic text");
  });

  it("lands the caret inside the href of a new link", () => {
    const r = applyWrap("see ", 4, 4, "link");
    expect(r.value).toBe("see [link text](https://)");
    expect(r.selectionStart).toBe(r.value.length - 1);
  });

  it("marks every selected line as a bullet and unmarks them again", () => {
    const on = applyWrap("a\nb", 0, 3, "bullet");
    expect(on.value).toBe("- a\n- b");
    const off = applyWrap(on.value, 0, on.value.length, "bullet");
    expect(off.value).toBe("a\nb");
  });

  it("numbers a list from one and renumbers on toggle", () => {
    const r = applyWrap("a\nb\nc", 0, 5, "number");
    expect(r.value).toBe("1. a\n2. b\n3. c");
  });

  it("converts a bullet list to a numbered one without doubling the marker", () => {
    const r = applyWrap("- a\n- b", 0, 7, "number");
    expect(r.value).toBe("1. a\n2. b");
  });
});

describe("descriptionPreview", () => {
  it("leaves a plain-text description alone", () => {
    expect(descriptionPreview("Ship the invoice screen by Friday.")).toBe("Ship the invoice screen by Friday.");
  });

  it("strips list markers so a card never prints a raw dash", () => {
    expect(descriptionPreview("- one\n- two\n- three")).toBe("one two three");
    expect(descriptionPreview("1. first\n2. second")).toBe("first second");
    expect(descriptionPreview("  * indented")).toBe("indented");
  });

  it("spends emphasis and link syntax", () => {
    expect(descriptionPreview("**Blocked** on _legal_")).toBe("Blocked on legal");
    expect(descriptionPreview("See [the brief](https://a.test/brief)")).toBe("See the brief");
    expect(descriptionPreview("Ping @Nirajan Bohara today")).toBe("Ping @Nirajan Bohara today");
  });

  it("keeps a bare URL readable", () => {
    expect(descriptionPreview("Spec at https://a.test/spec")).toBe("Spec at https://a.test/spec");
  });

  it("collapses newlines and blank lines into one run of words", () => {
    expect(descriptionPreview("first line\n\nsecond line")).toBe("first line second line");
    expect(descriptionPreview("a\n   \nb")).toBe("a b");
  });

  it("does not invent a preview out of nothing", () => {
    expect(descriptionPreview("")).toBe("");
    expect(descriptionPreview(null)).toBe("");
    expect(descriptionPreview(undefined)).toBe("");
    expect(descriptionPreview("   \n  ")).toBe("");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const out = descriptionPreview("alpha bravo charlie delta echo foxtrot", 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).toBe("alpha bravo charlie…");
  });

  it("leaves an asterisk that is not emphasis as a character", () => {
    expect(descriptionPreview("2 * 3 = 6")).toBe("2 * 3 = 6");
    expect(descriptionPreview("file_name_here.txt")).toBe("file_name_here.txt");
  });
});

describe("continueList", () => {
  it("continues a bullet, carrying the marker and the indent", () => {
    const v = "- one";
    const next = continueList(v, v.length);
    expect(next?.value).toBe("- one\n- ");
    expect(next?.selectionStart).toBe(8);

    const indented = "  * one";
    expect(continueList(indented, indented.length)?.value).toBe("  * one\n  * ");
  });

  it("continues a numbered list with the next number and the same delimiter", () => {
    const v = "1. one";
    expect(continueList(v, v.length)?.value).toBe("1. one\n2. ");
    const paren = "3) three";
    expect(continueList(paren, paren.length)?.value).toBe("3) three\n4) ");
  });

  it("ends the list when Enter lands on an empty item", () => {
    const v = "- one\n- ";
    const next = continueList(v, v.length);
    expect(next?.value).toBe("- one\n");
    expect(next?.selectionStart).toBe(6);
  });

  it("returns null for prose, so a paragraph gets a plain newline", () => {
    expect(continueList("just a sentence", 15)).toBeNull();
    expect(continueList("", 0)).toBeNull();
    expect(continueList("-no space", 9)).toBeNull();
  });

  it("returns null when the caret sits inside the marker itself", () => {
    expect(continueList("- one", 1)).toBeNull();
    expect(continueList("- one", 0)).toBeNull();
  });

  it("at the very start of the text, Enter opens an empty item above", () => {
    // Caret right after "- ": the item splits, which is what every editor
    // does, and "one" is still there.
    expect(continueList("- one", 2)?.value).toBe("- \n- one");
  });

  // DATA INTEGRITY. Enter only ever edits the current line: every other
  // character a person wrote has to come back out untouched.
  it("never loses the rest of the body", () => {
    const body = "intro paragraph\n\n- one\n- two\n\nclosing paragraph";
    const caret = body.indexOf("- two") + "- two".length;
    const next = continueList(body, caret);
    expect(next?.value).toBe("intro paragraph\n\n- one\n- two\n- \n\nclosing paragraph");
    expect(next?.value).toContain("intro paragraph");
    expect(next?.value).toContain("closing paragraph");
  });

  it("splits an item at the caret instead of dropping the tail", () => {
    const v = "- onetwo";
    const next = continueList(v, 5);
    expect(next?.value).toBe("- one\n- two");
  });

  it("keeps the neighbours when it ends a list", () => {
    const body = "- one\n- \nafter";
    const next = continueList(body, 8);
    expect(next?.value).toBe("- one\n\nafter");
  });

  it("round-trips through the parser: what it writes is a real list", () => {
    const v = "- one";
    const next = continueList(v, v.length);
    const typed = `${next!.value}two`;
    expect(parseMarkdownLite(typed)).toEqual([
      { type: "bullets", items: [[{ type: "text", value: "one" }], [{ type: "text", value: "two" }]] },
    ]);
  });
});
