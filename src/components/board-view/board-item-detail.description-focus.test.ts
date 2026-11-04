import { describe, expect, it } from "vitest";
import { descriptionEditingAfter, descriptionRestsAsBody } from "./board-item-detail";

// Founder report 2026-11-04: "as soon as I type something I am able to write
// one single letter and then it comes out of the description". An empty
// description shows the editor without being marked as edited, so the first
// letter made it non-empty while `editing` was still false, and the field
// swapped the textarea for the rendered body under the cursor.

/** The field's state after a run of events, starting from rest. */
function play(events: Array<"open" | "focus" | "blur" | "escape" | { type: string }>) {
  let editing = false;
  let value = "";
  for (const e of events) {
    if (typeof e === "object") {
      editing = descriptionEditingAfter("type");
      value += e.type;
    } else {
      editing = descriptionEditingAfter(e);
    }
  }
  return { editing, value, body: descriptionRestsAsBody(editing, value) };
}

describe("the task description field", () => {
  it("an empty description shows the editor", () => {
    expect(descriptionRestsAsBody(false, "")).toBe(false);
    expect(descriptionRestsAsBody(false, "   ")).toBe(false);
  });

  it("stays the editor while someone types into an empty description, letter after letter", () => {
    const events: Array<"focus" | { type: string }> = ["focus"];
    for (const ch of "Hello") {
      events.push({ type: ch });
      const now = play(events);
      expect(now.body, `after "${now.value}"`).toBe(false);
      expect(now.editing).toBe(true);
    }
  });

  it("the first keystroke alone keeps it the editor, even with no focus event first", () => {
    expect(play([{ type: "H" }]).body).toBe(false);
  });

  it("rests as the rendered body once the person leaves it, by blur or Esc", () => {
    expect(play(["focus", { type: "H" }, { type: "i" }, "blur"]).body).toBe(true);
    expect(play(["focus", { type: "H" }, "escape"]).body).toBe(true);
  });

  it("a description with text rests as its body, and opening it edits it", () => {
    expect(descriptionRestsAsBody(false, "Hello")).toBe(true);
    expect(descriptionRestsAsBody(descriptionEditingAfter("open"), "Hello")).toBe(false);
  });
});
