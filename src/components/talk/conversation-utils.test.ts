// The feed's grouping, and what an edit does to a message AI wrote.
//
// WHY THIS TEST EXISTS. The "AI update" and "via {teammate}" labels live
// only on a group's head. A post an AI teammate made for Max a few minutes
// after his own message used to fold under that message's head, so it read
// as words Max typed; and Max's next message folded under the post's head,
// so his own words read as the teammate's. An edit made the words his, yet
// an edited teammate post kept its "via" label.
//
// Node-only, like the rest of the suite: the feed is a component and these
// cover the pure rules it renders from.

import { describe, expect, it } from "vitest";
import { editedKind, startsGroup } from "./conversation-utils";

const msg = (minute: number, over: { authorId?: string; kind?: string } = {}) => ({
  authorId: over.authorId ?? "max",
  createdAt: `2026-10-06T10:${String(minute).padStart(2, "0")}:00.000Z`,
  metadata: over.kind ? { kind: over.kind } : null,
});

describe("startsGroup", () => {
  it("folds one author's messages a few minutes apart under one head", () => {
    expect(startsGroup(msg(0), msg(3))).toBe(false);
  });
  it("starts a group for the day's first message, a new author, and a gap over five minutes", () => {
    expect(startsGroup(null, msg(0))).toBe(true);
    expect(startsGroup(msg(0), msg(1, { authorId: "lea" }))).toBe(true);
    expect(startsGroup(msg(0), msg(6))).toBe(true);
    expect(startsGroup(msg(0), msg(5))).toBe(false);
  });
  it("gives an AI teammate's post its own head, so its via label always shows", () => {
    expect(startsGroup(msg(0), msg(3, { kind: "agent_post" }))).toBe(true);
    expect(startsGroup(msg(3, { kind: "agent_post" }), msg(4, { kind: "agent_post" }))).toBe(true);
  });
  it("never folds the person's next message under an AI teammate's post", () => {
    expect(startsGroup(msg(3, { kind: "agent_post" }), msg(5))).toBe(true);
  });
  it("does the same for an AI update, as before", () => {
    expect(startsGroup(msg(0), msg(1, { kind: "ai_update" }))).toBe(true);
    expect(startsGroup(msg(1, { kind: "ai_update" }), msg(2))).toBe(true);
    expect(startsGroup(msg(0), msg(1, { kind: "ai_update_hidden" }))).toBe(true);
  });
  it("groups an edited one as the person's own words, which it is", () => {
    expect(startsGroup(msg(0), msg(1, { kind: "agent_post_edited" }))).toBe(false);
    expect(startsGroup(msg(1, { kind: "ai_update_edited" }), msg(2))).toBe(false);
    expect(startsGroup(msg(0), msg(1, { kind: "call" }))).toBe(false);
  });
});

describe("editedKind", () => {
  it("makes an edited AI update or AI teammate's post the person's own", () => {
    expect(editedKind("ai_update")).toBe("ai_update_edited");
    expect(editedKind("agent_post")).toBe("agent_post_edited");
  });
  it("leaves every other kind as it is", () => {
    for (const kind of [undefined, null, "", "call", "ai_update_edited", "agent_post_edited", "ai_update_hidden"]) {
      expect(editedKind(kind)).toBeNull();
    }
  });
});
