import { describe, expect, it } from "vitest";
import { ITEM_MENU_KEYS, buildItemMenu, type ItemMenuContext, type ItemMenuHost } from "./item-menu";
import type { ItemRole } from "./item-role";

function ctx(over: Partial<ItemMenuContext> = {}): ItemMenuContext {
  return {
    host: "page",
    role: "EDIT",
    isAssignee: false,
    isDone: false,
    isWatching: false,
    hasItemTypes: true,
    timeTrackingOn: true,
    timerRunning: false,
    personalList: false,
    canMoveElsewhere: true,
    assigneeOnly: false,
    isCreator: false,
    isAgent: false,
    isGuest: false,
    archived: false,
    ...over,
  };
}

const keys = (c: ItemMenuContext) => buildItemMenu(c).map((r) => r.key);

describe("buildItemMenu", () => {
  it("renders nothing for a viewer with no role", () => {
    expect(buildItemMenu(ctx({ role: "none" }))).toEqual([]);
  });

  it("emits rows in the canon order for every host and role", () => {
    const hosts: ItemMenuHost[] = ["page", "drawer", "row"];
    const roles: ItemRole[] = ["VIEW", "COMMENT", "EDIT", "FULL"];
    for (const host of hosts) {
      for (const role of roles) {
        const got = keys(ctx({ host, role }));
        const canon = ITEM_MENU_KEYS.filter((k) => got.includes(k));
        expect(got, `${host}/${role}`).toEqual(canon);
      }
    }
  });

  // The three host-dependent rows, and nothing else may differ.
  it("differs between hosts only in Open and Open in new tab", () => {
    const page = new Set(keys(ctx({ host: "page" })));
    const drawer = new Set(keys(ctx({ host: "drawer" })));
    const row = new Set(keys(ctx({ host: "row" })));
    expect(page.has("open")).toBe(false);
    expect(drawer.has("open")).toBe(false);
    expect(row.has("open")).toBe(true);
    expect(page.has("open-new-tab")).toBe(false);
    expect(drawer.has("open-new-tab")).toBe(true);
    expect(row.has("open-new-tab")).toBe(true);
    const drop = (s: Set<string>) => [...s].filter((k) => k !== "open" && k !== "open-new-tab");
    expect(drop(drawer)).toEqual(drop(page));
    expect(drop(row)).toEqual(drop(page));
  });

  it("gives Can view only the read rows", () => {
    const got = keys(ctx({ role: "VIEW", host: "row" }));
    // No "save-template": section 1's Can view row lists templates among the
    // things it never renders.
    expect(got).toEqual(["open", "open-new-tab", "copy-link", "copy-id", "remind", "watch", "share"]);
  });

  it("gives Can comment the same rows as Can view (commenting is in the thread)", () => {
    expect(keys(ctx({ role: "COMMENT" }))).toEqual(keys(ctx({ role: "VIEW" })));
  });

  it("flips Mark complete, Watch and Start timer on state", () => {
    const label = (c: ItemMenuContext, key: string) => buildItemMenu(c).find((r) => r.key === key)?.label;
    expect(label(ctx(), "complete")).toBe("Mark complete");
    expect(label(ctx({ isDone: true }), "complete")).toBe("Reopen");
    expect(label(ctx(), "watch")).toBe("Watch");
    expect(label(ctx({ isWatching: true }), "watch")).toBe("Unwatch");
    expect(label(ctx(), "timer")).toBe("Start timer");
    expect(label(ctx({ timerRunning: true }), "timer")).toBe("Stop timer");
  });

  it("hides Assign to me when the viewer is already an assignee", () => {
    expect(keys(ctx({ isAssignee: true }))).not.toContain("assign-to-me");
  });

  it("hides Task type when the org has one type, and the timer when the module is off", () => {
    const got = keys(ctx({ hasItemTypes: false, timeTrackingOn: false }));
    expect(got).not.toContain("type");
    expect(got).not.toContain("timer");
  });

  it("hides Move when there is nowhere to move to, and for an assignee-only viewer", () => {
    expect(keys(ctx({ canMoveElsewhere: false }))).not.toContain("move");
    expect(keys(ctx({ assigneeOnly: true }))).not.toContain("move");
  });

  it("hides Share on a Personal List task and for an assignee-only viewer", () => {
    expect(keys(ctx({ personalList: true }))).not.toContain("share");
    expect(keys(ctx({ assigneeOnly: true }))).not.toContain("share");
  });

  it("reads Who has access for a viewer who cannot grant", () => {
    const row = buildItemMenu(ctx({ role: "VIEW" })).find((r) => r.key === "share");
    expect(row?.label).toBe("Who has access");
  });

  it("never offers Templates to a Guest", () => {
    expect(keys(ctx({ isGuest: true }))).not.toContain("save-template");
  });

  // access section 9 tasks.delete.
  it("offers Delete to Full access and to the creator with Can edit, and to nobody else", () => {
    expect(keys(ctx({ role: "FULL" }))).toContain("delete");
    expect(keys(ctx({ role: "EDIT", isCreator: true }))).toContain("delete");
    expect(keys(ctx({ role: "EDIT", isCreator: false }))).not.toContain("delete");
    expect(keys(ctx({ role: "VIEW", isCreator: true }))).not.toContain("delete");
  });

  it("never offers Delete to an Agent, whatever their role", () => {
    expect(keys(ctx({ role: "FULL", isAgent: true }))).not.toContain("delete");
    expect(keys(ctx({ role: "EDIT", isCreator: true, isAgent: true }))).not.toContain("delete");
  });

  it("drops Archive on an already archived task", () => {
    expect(keys(ctx({ archived: true }))).not.toContain("archive");
  });

  it("marks Delete destructive and separates the tail", () => {
    const rows = buildItemMenu(ctx({ role: "FULL" }));
    const archive = rows.find((r) => r.key === "archive");
    expect(archive?.separatorBefore).toBe(true);
    expect(rows.find((r) => r.key === "delete")?.destructive).toBe(true);
  });

  // Phase 5b, tasks in more than one List (decision 7).
  describe("tasks in more than one List", () => {
    it("puts Add to another List right after Move, only with canAddToList and at least Can edit", () => {
      const got = keys(ctx({ canAddToList: true }));
      expect(got.indexOf("add-to-list")).toBe(got.indexOf("move") + 1);
      expect(buildItemMenu(ctx({ canAddToList: true })).find((r) => r.key === "add-to-list")?.label).toBe("Add to another List…");
      expect(keys(ctx({ canAddToList: false }))).not.toContain("add-to-list");
      expect(keys(ctx({ canAddToList: true, role: "VIEW" }))).not.toContain("add-to-list");
      expect(keys(ctx({ canAddToList: true, role: "COMMENT" }))).not.toContain("add-to-list");
    });

    it("never offers Add to another List to an assignee-only viewer, a Personal List task or a linked subtask", () => {
      expect(keys(ctx({ canAddToList: true, assigneeOnly: true }))).not.toContain("add-to-list");
      expect(keys(ctx({ canAddToList: true, personalList: true }))).not.toContain("add-to-list");
      expect(keys(ctx({ canAddToList: true, inSecondaryList: true, linkedSubtask: true }))).not.toContain("add-to-list");
    });

    it("offers Remove from this List only in a secondary List and only with canRemoveFromList", () => {
      const got = keys(ctx({ inSecondaryList: true, canRemoveFromList: true }));
      expect(got).toContain("remove-from-list");
      expect(keys(ctx({ inSecondaryList: true, canRemoveFromList: false }))).not.toContain("remove-from-list");
      expect(keys(ctx({ inSecondaryList: false, canRemoveFromList: true }))).not.toContain("remove-from-list");
      expect(buildItemMenu(ctx({ inSecondaryList: true, canRemoveFromList: true })).find((r) => r.key === "remove-from-list")?.label).toBe("Remove from this List");
    });

    it("never offers Remove from this List for a linked subtask", () => {
      expect(keys(ctx({ inSecondaryList: true, canRemoveFromList: true, linkedSubtask: true }))).not.toContain("remove-from-list");
    });

    it("gives a view-only reader without canRemoveFromList no Remove row at all", () => {
      expect(keys(ctx({ role: "VIEW", inSecondaryList: true }))).not.toContain("remove-from-list");
      expect(keys(ctx({ role: "VIEW", inSecondaryList: true }))).toEqual(["copy-link", "copy-id", "remind", "watch", "share"]);
    });

    it("lets a reader who may remove it do so whatever their role on the task", () => {
      expect(keys(ctx({ role: "VIEW", inSecondaryList: true, canRemoveFromList: true }))).toContain("remove-from-list");
    });

    it("drops Archive in a secondary List and labels Delete as Delete everywhere", () => {
      const rows = buildItemMenu(ctx({ role: "FULL", inSecondaryList: true, canRemoveFromList: true }));
      expect(rows.map((r) => r.key)).not.toContain("archive");
      expect(rows.find((r) => r.key === "delete")?.label).toBe("Delete everywhere");
      // The tail starts with Remove from this List.
      const remove = rows.find((r) => r.key === "remove-from-list");
      expect(remove?.separatorBefore).toBe(true);
      expect(rows.map((r) => r.key).slice(-2)).toEqual(["remove-from-list", "delete"]);
      // A linked subtask is still deleted everywhere, never archived here.
      const sub = buildItemMenu(ctx({ role: "FULL", inSecondaryList: true, linkedSubtask: true }));
      expect(sub.find((r) => r.key === "delete")?.label).toBe("Delete everywhere");
      expect(sub.map((r) => r.key)).not.toContain("archive");
    });

    it("hides Move for a linked subtask, and gates it on the link move flag in a secondary List", () => {
      expect(keys(ctx({ inSecondaryList: true, linkedSubtask: true, canMoveElsewhere: true }))).not.toContain("move");
      expect(keys(ctx({ inSecondaryList: true, canMoveElsewhere: false }))).not.toContain("move");
      expect(keys(ctx({ inSecondaryList: true, canMoveElsewhere: true }))).toContain("move");
    });

    it("keeps the canon order with every new row present", () => {
      const got = keys(ctx({ role: "FULL", host: "row", canAddToList: true, inSecondaryList: true, canRemoveFromList: true }));
      expect(got).toEqual(ITEM_MENU_KEYS.filter((k) => got.includes(k)));
    });

    it("changes nothing at all while the new flags are absent", () => {
      const base = ctx();
      expect(keys(base)).toEqual(keys({ ...base, canAddToList: undefined, inSecondaryList: undefined, canRemoveFromList: undefined, linkedSubtask: undefined }));
      expect(keys(base)).not.toContain("add-to-list");
      expect(keys(base)).not.toContain("remove-from-list");
      expect(buildItemMenu(ctx({ role: "FULL" })).find((r) => r.key === "delete")?.label).toBe("Delete");
    });
  });
});
