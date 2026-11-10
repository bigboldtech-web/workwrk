import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Founder report 2026-11-10: "not able to tag anyone in the comment section and
// edit mode". Proven in a real browser before the fix: from six people up the
// list drew a search field that took the caret. Read from the source because
// the suite runs without a DOM; scripts' real typing covers the behaviour.

const src = (p: string) => readFileSync(p, "utf8");

describe("the @ list", () => {
  const typeahead = src("src/components/comments/mention-typeahead.tsx");

  it("never draws a search field, so the caret stays in the text", () => {
    expect(typeahead).toMatch(/\bnoSearch\b/);
    expect(typeahead).not.toMatch(/alwaysSearch/);
  });

  it("keeps focus in the text when a person is clicked", () => {
    expect(typeahead).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("stays on screen", () => {
    expect(typeahead).toMatch(/\bautoPlace\b/);
  });
});

describe("editing a comment", () => {
  const thread = src("src/components/comments/comment-thread.tsx");

  it("offers the @ list and reports who it tagged", () => {
    expect(thread).toMatch(/editTypeahead = useMentionTypeahead/);
    expect(thread).toMatch(/\{editTypeahead\.popover\}/);
    expect(thread).toMatch(/onEditSave\(update\.id, body, surviving\(editTypeahead\.mentions, body\)\)/);
  });
});

describe("the description", () => {
  it("reports who it tagged with each save", () => {
    const detail = src("src/components/board-view/board-item-detail.tsx");
    expect(detail).toMatch(/onMentionsChange=\{rememberTagged\}/);
    expect(detail).toMatch(/onSave\(value, surviving\(taggedRef\.current, value\)\)/);
  });
});

describe("the + Task window", () => {
  it("reaches every view of the List, the Board included", () => {
    const canvas = src("src/components/board-view/board-canvas.tsx");
    expect(canvas).toMatch(/addEventListener\("workwrk:item-created", onCreated\)/);
    expect(canvas).toMatch(/detail\.boardId === boardId\) handleItemCreated\(detail\.item\)/);
  });
});
