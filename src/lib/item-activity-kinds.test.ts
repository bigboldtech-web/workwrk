import { describe, expect, it } from "vitest";
import {
  ITEM_ACTIVITY_ACTIONS,
  ITEM_ACTIVITY_KINDS,
  actionsForKind,
  isItemActivityKind,
  kindOfAction,
  parseActivityKind,
} from "./item-activity-kinds";

describe("the action table is total", () => {
  it("every declared action maps to a declared kind", () => {
    for (const action of ITEM_ACTIVITY_ACTIONS) {
      expect(ITEM_ACTIVITY_KINDS).toContain(kindOfAction(action));
    }
  });

  it("every kind owns at least one action, so no filter is an empty promise", () => {
    for (const kind of ITEM_ACTIVITY_KINDS) {
      expect(actionsForKind(kind).length).toBeGreaterThan(0);
    }
  });

  it("the buckets partition the actions exactly once", () => {
    const seen = ITEM_ACTIVITY_KINDS.flatMap((k) => actionsForKind(k));
    expect(seen.length).toBe(ITEM_ACTIVITY_ACTIONS.length);
    expect(new Set(seen).size).toBe(ITEM_ACTIVITY_ACTIONS.length);
  });

  it("an unknown action reads as lifecycle rather than disappearing", () => {
    expect(kindOfAction("SOMETHING_A_FUTURE_PHASE_WRITES")).toBe("lifecycle");
    expect(kindOfAction("")).toBe("lifecycle");
  });
});

describe("the six kinds the spec names land where a reader expects", () => {
  it("status", () => {
    expect(kindOfAction("STATUS_CHANGED")).toBe("status");
  });

  it("assignees covers both the legacy owner row and the new multi-assignee row", () => {
    expect(kindOfAction("OWNER_CHANGED")).toBe("assignees");
    expect(kindOfAction("ASSIGNEES_CHANGED")).toBe("assignees");
  });

  it("dates covers start, due and the recurrence rule", () => {
    expect(kindOfAction("DUE_CHANGED")).toBe("dates");
    expect(kindOfAction("START_CHANGED")).toBe("dates");
    expect(kindOfAction("RECUR_SET")).toBe("dates");
    expect(kindOfAction("RECUR_CLEARED")).toBe("dates");
  });

  it("fields covers title, priority, tags, type and the custom-field blob", () => {
    expect(kindOfAction("TITLE_CHANGED")).toBe("fields");
    expect(kindOfAction("PRIORITY_CHANGED")).toBe("fields");
    expect(kindOfAction("TAGS_CHANGED")).toBe("fields");
    expect(kindOfAction("TYPE_CHANGED")).toBe("fields");
    expect(kindOfAction("FIELDS_UPDATED")).toBe("fields");
  });

  it("comments", () => {
    expect(kindOfAction("COMMENTED")).toBe("comments");
  });

  it("attachments covers uploads and entity links alike", () => {
    expect(kindOfAction("ATTACHMENT_ADDED")).toBe("attachments");
    expect(kindOfAction("ATTACHMENT_REMOVED")).toBe("attachments");
    expect(kindOfAction("LINK_ADDED")).toBe("attachments");
    expect(kindOfAction("LINK_REMOVED")).toBe("attachments");
  });

  it("lifecycle holds create, archive, restore, move and subtask added", () => {
    expect(actionsForKind("lifecycle").sort()).toEqual(
      ["ARCHIVED", "CREATED", "MOVED", "RESTORED", "SUBTASK_ADDED"],
    );
  });
});

describe("parseActivityKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of ITEM_ACTIVITY_KINDS) expect(parseActivityKind(kind)).toBe(kind);
  });

  it("an unknown or absent value means no filter, never a 400", () => {
    expect(parseActivityKind(null)).toBeNull();
    expect(parseActivityKind(undefined)).toBeNull();
    expect(parseActivityKind("")).toBeNull();
    expect(parseActivityKind("STATUS")).toBeNull();
    expect(parseActivityKind("everything")).toBeNull();
  });

  it("isItemActivityKind is the same guard", () => {
    expect(isItemActivityKind("status")).toBe(true);
    expect(isItemActivityKind(7)).toBe(false);
  });
});
