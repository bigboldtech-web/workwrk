import { describe, expect, it } from "vitest";
import { parseInline, parseMarkup, stripMarkup } from "./chat-markup";

describe("parseInline", () => {
  it("pairs bold/italic/underline/strike, longest marker first", () => {
    expect(parseInline("**b**")).toEqual([{ t: "bold", children: [{ t: "text", text: "b" }] }]);
    expect(parseInline("_i_")).toEqual([{ t: "italic", children: [{ t: "text", text: "i" }] }]);
    expect(parseInline("__u__")).toEqual([{ t: "underline", children: [{ t: "text", text: "u" }] }]);
    expect(parseInline("~s~")).toEqual([{ t: "strike", children: [{ t: "text", text: "s" }] }]);
  });

  it("leaves unmatched markers as literal text", () => {
    expect(parseInline("2 * 3 = 6 _ok")).toEqual([{ t: "text", text: "2 * 3 = 6 _ok" }]);
    expect(parseInline("a ** b")).toEqual([{ t: "text", text: "a ** b" }]);
  });

  it("keeps code spans opaque and requires a same-line close", () => {
    expect(parseInline("run `a ** b` now")).toEqual([
      { t: "text", text: "run " },
      { t: "code", text: "a ** b" },
      { t: "text", text: " now" },
    ]);
    // two backticks split by a newline are two literals, never a span
    expect(parseInline("`hello\nworld`")).toEqual([{ t: "text", text: "`hello\nworld`" }]);
  });

  it("any number of sibling spans parse (no depth-by-sibling bug)", () => {
    const five = parseInline("**a** **b** **c** **d** **e**");
    expect(five.filter((n) => n.t === "bold")).toHaveLength(5);
  });

  it("leftmost pair wins: outer underline survives an inner bold", () => {
    expect(parseInline("__**x**__")).toEqual([
      { t: "underline", children: [{ t: "bold", children: [{ t: "text", text: "x" }] }] },
    ]);
  });

  it("links and URLs stay INSIDE a wrap pair", () => {
    expect(parseInline("**see https://x.dev now**")).toEqual([
      { t: "bold", children: [
        { t: "text", text: "see " },
        { t: "url", href: "https://x.dev" },
        { t: "text", text: " now" },
      ] },
    ]);
  });

  it("a whitespace-only pair is literal without disabling later pairs", () => {
    expect(parseInline("** ** but **this** bold")).toEqual([
      { t: "text", text: "** ** but " },
      { t: "bold", children: [{ t: "text", text: "this" }] },
      { t: "text", text: " bold" },
    ]);
  });

  it("parses labelled + bare links, https only; javascript: never links", () => {
    expect(parseInline("[docs](https://x.dev) and https://y.dev")).toEqual([
      { t: "link", label: "docs", href: "https://x.dev" },
      { t: "text", text: " and " },
      { t: "url", href: "https://y.dev" },
    ]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", text: "[x](javascript:alert(1))" }]);
  });

  it("mention text inside italic stays an intact text run", () => {
    expect(parseInline("_@Alice Smith_")).toEqual([
      { t: "italic", children: [{ t: "text", text: "@Alice Smith" }] },
    ]);
  });
});

describe("parseMarkup blocks", () => {
  it("splits fences, quotes, lists, paragraphs", () => {
    const blocks = parseMarkup("hi\n> q1\n> q2\n- a\n- b\n1. one\n```\ncode ** here\n```\nbye");
    expect(blocks.map((b) => b.t)).toEqual(["p", "quote", "ul", "ol", "codeblock", "p"]);
    const code = blocks.find((b) => b.t === "codeblock");
    expect(code && "text" in code && code.text).toBe("code ** here");
  });

  it("blank lines stay inside ONE paragraph — plain messages render unchanged", () => {
    const blocks = parseMarkup("para one\n\npara two");
    expect(blocks).toEqual([{ t: "p", children: [{ t: "text", text: "para one\n\npara two" }] }]);
  });

  it("ordered lists keep their typed start; years are not lists", () => {
    const blocks = parseMarkup("3. third thing");
    expect(blocks).toEqual([{ t: "ol", start: 3, items: [[{ t: "text", text: "third thing" }]] }]);
    expect(parseMarkup("2025. was a big year")).toEqual([
      { t: "p", children: [{ t: "text", text: "2025. was a big year" }] },
    ]);
  });

  it("a dangling fence stays visible as text", () => {
    expect(JSON.stringify(parseMarkup("before\n```oops"))).toContain("oops");
  });
});

describe("stripMarkup (derived from the parse — can never disagree)", () => {
  it("removes markers, keeps code content verbatim", () => {
    expect(stripMarkup("**b** _i_ __u__ ~s~ `c` [l](https://x.dev)")).toBe("b i u s c l");
    expect(stripMarkup("rename `user_id_field` please")).toBe("rename user_id_field please");
    expect(stripMarkup("run `__init__` now")).toBe("run __init__ now");
  });

  it("flattens structure to lines", () => {
    expect(stripMarkup("> quoted\n- item\n2. second")).toBe("quoted\nitem\nsecond");
  });

  it("fence content survives untouched", () => {
    expect(stripMarkup("```\n- item one\n> quoted\n```")).toBe("- item one\n> quoted");
  });
});

describe("performance guard", () => {
  it("hostile bracket runs parse in linear-ish time", () => {
    const hostile = "[".repeat(4000) + "x".repeat(4000);
    const t0 = performance.now();
    parseMarkup(hostile);
    stripMarkup(hostile);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
