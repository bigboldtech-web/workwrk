import { describe, expect, it } from "vitest";
import type { StatusOption } from "../board-items-shared";
import { DEFAULT_STATUS_OPTIONS } from "../board-items-shared";
import {
  LEGACY_REDIRECT_KINDS,
  legacyTarget,
  mapIdeaStatus,
  mapLegacyDates,
  mapLegacyPriority,
  mapLegacyStatus,
  resolveLegacyOwner,
} from "./legacy-task-map";

const DEFAULTS = [...DEFAULT_STATUS_OPTIONS];

/** A renamed Personal list: no value is spelled the way the default trio is. */
const RENAMED: StatusOption[] = [
  { value: "backlog", label: "Backlog", color: "#111", group: "ACTIVE" },
  { value: "wip", label: "Working on it", color: "#222", group: "ACTIVE" },
  { value: "shipped", label: "Shipped", color: "#333", group: "DONE" },
  { value: "dropped", label: "Dropped", color: "#444", group: "CLOSED" },
];

describe("mapLegacyStatus", () => {
  it("sends PLANNED to the first active status", () => {
    expect(mapLegacyStatus("PLANNED", DEFAULTS)).toEqual({ value: "TO_DO", done: false });
    expect(mapLegacyStatus("PLANNED", RENAMED)).toEqual({ value: "backlog", done: false });
  });

  it("sends IN_PROGRESS to the status that reads as progress, by label as well as value", () => {
    expect(mapLegacyStatus("IN_PROGRESS", DEFAULTS).value).toBe("IN_PROGRESS");
    // "Working on it" matches on the label, not the value.
    expect(mapLegacyStatus("IN_PROGRESS", RENAMED).value).toBe("wip");
  });

  it("falls back to the second active status when no name reads as progress", () => {
    const noProgressWord: StatusOption[] = [
      { value: "a", label: "New", color: "#1", group: "ACTIVE" },
      { value: "b", label: "Up next", color: "#2", group: "ACTIVE" },
      { value: "c", label: "Finished", color: "#3", group: "DONE" },
    ];
    expect(mapLegacyStatus("IN_PROGRESS", noProgressWord).value).toBe("b");
  });

  it("falls back to the only active status when there is just one", () => {
    const one: StatusOption[] = [
      { value: "open", label: "Open", color: "#1", group: "ACTIVE" },
      { value: "shut", label: "Shut", color: "#2", group: "DONE" },
    ];
    expect(mapLegacyStatus("IN_PROGRESS", one).value).toBe("open");
  });

  it("sends COMPLETED to the first DONE status and marks it done", () => {
    expect(mapLegacyStatus("COMPLETED", DEFAULTS)).toEqual({ value: "DONE", done: true });
    expect(mapLegacyStatus("COMPLETED", RENAMED)).toEqual({ value: "shipped", done: true });
  });

  it("sends COMPLETED to a CLOSED status when the List has no DONE one", () => {
    const noDone: StatusOption[] = [
      { value: "open", label: "Open", color: "#1", group: "ACTIVE" },
      { value: "cancelled", label: "Cancelled", color: "#2", group: "CLOSED" },
    ];
    expect(mapLegacyStatus("COMPLETED", noDone)).toEqual({ value: "cancelled", done: true });
  });

  it("sends COMPLETED to the last status when the List has no terminal status at all", () => {
    const allActive: StatusOption[] = [
      { value: "a", label: "A", color: "#1", group: "ACTIVE" },
      { value: "b", label: "B", color: "#2", group: "ACTIVE" },
    ];
    expect(mapLegacyStatus("COMPLETED", allActive)).toEqual({ value: "b", done: false });
  });

  it("migrates an unknown value onto the first active status and flags it", () => {
    const r = mapLegacyStatus("ON_HOLD", DEFAULTS);
    expect(r.value).toBe("TO_DO");
    expect(r.unmapped).toBe(true);
  });

  it("treats a null or empty status as PLANNED without flagging it", () => {
    expect(mapLegacyStatus(null, DEFAULTS)).toEqual({ value: "TO_DO", done: false });
    expect(mapLegacyStatus("", DEFAULTS).unmapped).toBeUndefined();
  });

  it("never throws on an empty status set", () => {
    expect(mapLegacyStatus("PLANNED", [])).toEqual({ value: "TO_DO", done: false, unmapped: true });
  });

  it("is case and spacing tolerant", () => {
    expect(mapLegacyStatus(" in progress ", DEFAULTS).value).toBe("IN_PROGRESS");
    expect(mapLegacyStatus("completed", DEFAULTS).done).toBe(true);
  });
});

describe("mapLegacyPriority", () => {
  it("passes the four live enum members through", () => {
    expect(mapLegacyPriority("URGENT")).toBe("URGENT");
    expect(mapLegacyPriority("HIGH")).toBe("HIGH");
    expect(mapLegacyPriority("NORMAL")).toBe("NORMAL");
    expect(mapLegacyPriority("LOW")).toBe("LOW");
  });

  it("maps the two names the spec calls out", () => {
    expect(mapLegacyPriority("Critical")).toBe("URGENT");
    expect(mapLegacyPriority("Medium")).toBe("NORMAL");
  });

  it("returns null for absent or unreadable values rather than guessing", () => {
    expect(mapLegacyPriority(null)).toBeNull();
    expect(mapLegacyPriority("")).toBeNull();
    expect(mapLegacyPriority("   ")).toBeNull();
    expect(mapLegacyPriority("sometime")).toBeNull();
  });
});

describe("mapLegacyDates", () => {
  const d = (s: string) => new Date(s);

  it("prefers endAt as the due date", () => {
    const r = mapLegacyDates({ date: d("2026-01-01"), startAt: d("2026-01-02"), endAt: d("2026-01-03") });
    expect(r.dueAt?.toISOString()).toBe(d("2026-01-03").toISOString());
    expect(r.startAt?.toISOString()).toBe(d("2026-01-02").toISOString());
  });

  it("falls back to the legacy day anchor", () => {
    const r = mapLegacyDates({ date: d("2026-01-01"), startAt: null, endAt: null });
    expect(r.dueAt?.toISOString()).toBe(d("2026-01-01").toISOString());
    // `date` is a deadline anchor, never a start: copying it would turn a point
    // into a same-day span on the Gantt.
    expect(r.startAt).toBeNull();
  });

  it("makes a task that only has a start due when it starts", () => {
    const r = mapLegacyDates({ date: null, startAt: d("2026-02-05"), endAt: null });
    expect(r.dueAt?.toISOString()).toBe(d("2026-02-05").toISOString());
    expect(r.startAt?.toISOString()).toBe(d("2026-02-05").toISOString());
  });

  it("leaves an unscheduled task unscheduled", () => {
    expect(mapLegacyDates({ date: null, startAt: null, endAt: null })).toEqual({ startAt: null, dueAt: null });
  });
});

describe("mapIdeaStatus", () => {
  const IDEAS: StatusOption[] = [
    { value: "SUBMITTED", label: "Submitted", color: "#1", group: "ACTIVE" },
    { value: "UNDER_REVIEW", label: "Under review", color: "#2", group: "ACTIVE" },
    { value: "APPROVED", label: "Approved", color: "#3", group: "ACTIVE" },
    { value: "IMPLEMENTED", label: "Implemented", color: "#4", group: "DONE" },
    { value: "REWARDED", label: "Rewarded", color: "#5", group: "DONE" },
    { value: "REJECTED", label: "Rejected", color: "#6", group: "CLOSED" },
  ];

  it("maps every member of the live IdeaStatus enum onto its own row", () => {
    for (const v of ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "IMPLEMENTED", "REWARDED"]) {
      expect(mapIdeaStatus(v, IDEAS).value).toBe(v);
    }
  });

  it("reads the terminal groups as done", () => {
    expect(mapIdeaStatus("IMPLEMENTED", IDEAS).done).toBe(true);
    expect(mapIdeaStatus("REJECTED", IDEAS).done).toBe(true);
    expect(mapIdeaStatus("SUBMITTED", IDEAS).done).toBe(false);
  });

  it("falls back to the first status and flags an unknown value", () => {
    const r = mapIdeaStatus("PARKED", IDEAS);
    expect(r.value).toBe("SUBMITTED");
    expect(r.unmapped).toBe(true);
  });

  it("does not flag an absent status", () => {
    expect(mapIdeaStatus(null, IDEAS).unmapped).toBeUndefined();
  });
});

describe("resolveLegacyOwner", () => {
  const live = new Set(["u-assignee", "u-creator", "u-owner"]);

  it("prefers the assignee", () => {
    expect(
      resolveLegacyOwner({ assigneeId: "u-assignee", createdById: "u-creator", liveUserIds: live, fallbackOwnerId: "u-owner" }),
    ).toEqual({ userId: "u-assignee", via: "assignee" });
  });

  it("falls back to the creator when the assignee has left the org", () => {
    expect(
      resolveLegacyOwner({ assigneeId: "u-gone", createdById: "u-creator", liveUserIds: live, fallbackOwnerId: "u-owner" }),
    ).toEqual({ userId: "u-creator", via: "creator" });
  });

  it("falls back to the org owner when both have left", () => {
    expect(
      resolveLegacyOwner({ assigneeId: "u-gone", createdById: "u-also-gone", liveUserIds: live, fallbackOwnerId: "u-owner" }),
    ).toEqual({ userId: "u-owner", via: "org-owner" });
  });

  it("resolves to nobody when the org has no live member, so the row is reported not written", () => {
    expect(
      resolveLegacyOwner({ assigneeId: "u-gone", createdById: null, liveUserIds: new Set(), fallbackOwnerId: "u-owner" }),
    ).toEqual({ userId: null, via: "none" });
  });
});

describe("the forwarding address", () => {
  it("names the four kinds these migrations write", () => {
    // `ideaComment` is the twin of `taskComment`. Without a per-comment marker
    // an idea's comments had no idempotence key at all, so a comment written
    // between two runs (and /ideas stays live and writable until the
    // production run) was counted as already moved and never migrated.
    expect(LEGACY_REDIRECT_KINDS).toEqual({
      task: "task",
      taskComment: "task_comment",
      idea: "idea",
      ideaComment: "idea_comment",
    });
  });

  it("points at the one task URL", () => {
    expect(legacyTarget("itm_1")).toBe("/item/itm_1");
  });
});
