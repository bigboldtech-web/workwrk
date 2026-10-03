import { describe, expect, it } from "vitest";
import { docToMarkdown, escapeText } from "./content-markdown";

const text = (t: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: t, styles });

describe("docToMarkdown: BlockNote (bnDoc), the editor's own tree", () => {
  const bnDoc = [
    { type: "heading", props: { level: 2 }, content: [text("Plan")], children: [] },
    { type: "paragraph", content: [text("Ship "), text("on time", { bold: true }), text(" with "), { type: "mention", props: { label: "Lea Alpha", href: "/people/x" } }], children: [] },
    {
      type: "bulletListItem",
      content: [text("Design")],
      children: [{ type: "bulletListItem", content: [text("Wireframes")], children: [] }],
    },
    { type: "bulletListItem", content: [text("Build")], children: [] },
    { type: "paragraph", content: [text("After the list")], children: [] },
    { type: "numberedListItem", content: [text("One")], children: [] },
    { type: "numberedListItem", content: [text("Two")], children: [] },
    { type: "checkListItem", props: { checked: true }, content: [text("Done thing")], children: [] },
    { type: "codeBlock", props: { language: "ts" }, content: [text("const a = `x`;")], children: [] },
    { type: "callout", props: { emoji: "💡" }, content: [text("Remember")], children: [] },
    { type: "subpage", props: { childDocId: "d2", title: "Child page" }, children: [] },
    {
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[text("A")], [text("B|C")]] }, { cells: [[text("1")], [text("2")]] }] },
      children: [],
    },
    { type: "paragraph", content: [{ type: "link", href: "https://example.com", content: [text("site")] }], children: [] },
    { type: "equation", props: { latex: "e=mc^2" }, children: [] },
  ];
  const md = docToMarkdown("Launch plan", { meta: {}, bnDoc, blocks: [] }, (id) => (id === "d2" ? "child-page-d2.md" : null));

  it("keeps headings, styles, mentions and links", () => {
    expect(md).toContain("# Launch plan\n");
    expect(md).toContain("## Plan\n");
    expect(md).toContain("Ship **on time** with @Lea Alpha");
    expect(md).toContain("[site](https://example.com)");
  });

  it("nests list items, numbers runs, and ends a list before the next paragraph", () => {
    expect(md).toContain("- Design\n  - Wireframes\n- Build\n\nAfter the list");
    expect(md).toContain("1. One\n2. Two\n");
    expect(md).toContain("- [x] Done thing");
  });

  it("writes code, callouts, sub-pages (linked to their own file), tables and equations", () => {
    expect(md).toContain("```ts\nconst a = `x`;\n```");
    expect(md).toContain("> 💡 Remember");
    expect(md).toContain("[Child page](child-page-d2.md)");
    expect(md).toContain("| A | B\\|C |\n| --- | --- |\n| 1 | 2 |");
    expect(md).toContain("$$\ne=mc^2\n$$");
  });

  it("reads bnDoc first, never the flat copy beside it", () => {
    const out = docToMarkdown("T", { bnDoc: [{ type: "paragraph", content: [text("real")] }], blocks: [{ kind: "paragraph", text: "flat copy" }] });
    expect(out).toContain("real");
    expect(out).not.toContain("flat copy");
  });
});

describe("docToMarkdown: TipTap (type: doc), older docs the single export used to drop", () => {
  const pm = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Notes" }] },
      { type: "paragraph", content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "text", text: " and " }, { type: "text", text: "a link", marks: [{ type: "link", attrs: { href: "https://x.test" } }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] }] },
      { type: "codeBlock", attrs: { language: "sql" }, content: [{ type: "text", text: "select 1;" }] },
      { type: "horizontalRule" },
    ],
  };
  const md = docToMarkdown("Old doc", pm);

  it("keeps its body, not just the title", () => {
    expect(md).toContain("# Notes");
    expect(md).toContain("**bold** and [a link](https://x.test)");
    expect(md).toContain("- first");
    expect(md).toContain("3. third");
    expect(md).toContain("- [ ] todo");
    expect(md).toContain("```sql\nselect 1;\n```");
    expect(md).toContain("---");
  });
});

describe("docToMarkdown: the first block editor", () => {
  it("still exports as before, mentions and all", () => {
    const md = docToMarkdown("Legacy", {
      blocks: [
        { kind: "h2", text: "Section" },
        { kind: "bullet", text: 'Ask <a class="bmen-inline" data-kind="user">@Mona</a>' },
        { kind: "paragraph", text: "Body &amp; more" },
        { kind: "todo", text: "Check", done: true },
        { kind: "data_table" },
      ],
      version: 2,
    });
    expect(md).toContain("## Section");
    expect(md).toContain("- Ask @Mona\n\nBody & more");
    expect(md).toContain("- [x] Check");
    expect(md).toContain("_Embedded data table_");
  });

  it("writes the title alone for an empty doc, and never throws on odd content", () => {
    expect(docToMarkdown("Empty", {})).toBe("# Empty\n");
    expect(docToMarkdown("Odd", { bnDoc: [null, 3, { type: "paragraph", content: "plain" }] })).toContain("plain");
    expect(docToMarkdown("", null)).toBe("\n");
  });
});

describe("escapeText", () => {
  it("escapes what Markdown would read as formatting", () => {
    expect(escapeText("a_b *c* [d] `e` \\")).toBe("a\\_b \\*c\\* \\[d\\] \\`e\\` \\\\");
  });
});

describe("docToMarkdown: page mentions", () => {
  const doc = [
    {
      type: "paragraph",
      content: [
        text("See "),
        { type: "mention", props: { mkind: "doc", refId: "d9", label: "Pricing page", href: "/docs/d9" } },
        text(" and ask "),
        { type: "mention", props: { mkind: "user", refId: "u1", label: "Lea Alpha", href: "/people/u1" } },
      ],
      children: [],
    },
  ];

  it("links a page mention to the page's file when it has one, a person mention stays a name", () => {
    const md = docToMarkdown("Notes", { bnDoc: doc }, (id) => (id === "d9" ? "pricing-page-d9.md" : null));
    expect(md).toContain("See [@Pricing page](pricing-page-d9.md) and ask @Lea Alpha");
  });

  it("keeps a page mention as its name when the page is not in the copy", () => {
    expect(docToMarkdown("Notes", { bnDoc: doc })).toContain("See @Pricing page and ask @Lea Alpha");
  });
});
