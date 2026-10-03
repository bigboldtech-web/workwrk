import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text";

describe("htmlToText", () => {
  it("keeps paragraphs apart and decodes entities", () => {
    expect(htmlToText("<p>Ship it &amp; tell Lea.</p><p>Second&nbsp;line</p>")).toBe("Ship it & tell Lea.\n\nSecond line");
  });

  it("writes lists as bullets and numbers, nested ones indented", () => {
    const html = "<ul><li><p>Design</p><ul><li>Wireframes</li></ul></li><li>Build</li></ul><ol><li>One</li><li>Two</li></ol><p>After</p>";
    expect(htmlToText(html)).toBe("• Design\n  • Wireframes\n• Build\n\n1. One\n2. Two\n\nAfter");
  });

  it("writes a link as its words then its address, and only for web or mail addresses", () => {
    expect(htmlToText('<p>See <a href="https://x.test/a?b=1&amp;c=2">the plan</a></p>')).toBe("See the plan (https://x.test/a?b=1&c=2)");
    expect(htmlToText('<p><a href="javascript:alert(1)">click</a></p>')).toBe("click");
    expect(htmlToText('<p><a href="https://x.test">https://x.test</a></p>')).toBe("https://x.test");
  });

  it("drops scripts, styles, comments and every attribute, so nothing in it can run", () => {
    const html = '<p onclick="steal()">Hi<script>alert(1)</script><style>p{}</style><!-- note --><img src=x onerror=alert(1)></p>';
    expect(htmlToText(html)).toBe("Hi");
  });

  it("keeps plain text as it is, and copes with nothing", () => {
    expect(htmlToText("Just words\nand a break")).toBe("Just words\nand a break");
    expect(htmlToText("")).toBe("");
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("<p></p><p>  </p>")).toBe("");
  });

  it("turns a break into a new line", () => {
    expect(htmlToText("<p>one<br>two</p>")).toBe("one\ntwo");
  });
});
