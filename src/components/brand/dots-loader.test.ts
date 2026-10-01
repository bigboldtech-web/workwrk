import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DotsLoader } from "./dots-loader";

// The loader's markup, pinned (spec-account-auth section 0: /loader-preview
// is dev-only now, so this snapshot is what guards the loader everywhere).
describe("DotsLoader", () => {
  it("renders four pips with a status role and the caption", () => {
    const html = renderToStaticMarkup(createElement(DotsLoader, { size: 40, label: "Loading workspace" }));
    expect(html).toMatchSnapshot();
    expect(html.match(/wwk-dots__pip/g)?.length).toBe(4);
    expect(html).toContain('role="status"');
  });
  it("scales the dot, gap and jump with size", () => {
    const html = renderToStaticMarkup(createElement(DotsLoader, { size: 100 }));
    expect(html).toContain("--wwk-dot:22.00px");
    expect(html).toContain("--wwk-gap:16.00px");
    expect(html).toContain("--wwk-jump:28.00px");
  });
});
