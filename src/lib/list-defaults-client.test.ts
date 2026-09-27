import { describe, expect, it } from "vitest";
import type { FieldDef } from "./field-catalog";
import type { StatusOption } from "./board-items-shared";
import { applyDefaultsToCreateBody, pruneListDefaults, subtaskCreateBody, type LoadedListSettings } from "./list-defaults-client";

const statuses: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#000", group: "ACTIVE" },
  { value: "REVIEW", label: "Review", color: "#000", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#000", group: "DONE" },
];
const fields: FieldDef[] = [
  { key: "points", label: "Points", type: "NUMBER", position: 0 },
  { key: "size", label: "Size", type: "DROPDOWN", position: 1, options: { choices: [{ value: "s", label: "S" }, { value: "l", label: "L" }] } },
  { key: "reviewer", label: "Reviewer", type: "USER", position: 2 },
  { key: "team", label: "Team", type: "PEOPLE", position: 3 },
];

const loaded = (over: Partial<LoadedListSettings["defaults"]> = {}, boardId = "b1"): LoadedListSettings => ({
  boardId,
  statuses,
  defaults: { status: "REVIEW", priority: "HIGH", assigneeIds: ["u1"], tagIds: ["t1"], itemTypeId: "type1", fields: { points: 3 }, ...over },
});

const body = () => ({
  title: "New",
  status: "TO_DO",
  priority: null,
  ownerId: "u9",
  assigneeIds: ["u9"],
  tagIds: [] as string[],
  itemTypeId: "orgDefault",
  metadata: { points: 1, description: "x" } as Record<string, unknown>,
});

describe("applyDefaultsToCreateBody", () => {
  it("returns the body unchanged, same keys, while nothing is loaded", () => {
    const b = body();
    const out = applyDefaultsToCreateBody(b, null, new Set(), "b1");
    expect(out).toEqual(body());
    expect(Object.keys(out)).toEqual(Object.keys(body()));
  });

  it("returns the body unchanged when the loaded settings are another List's", () => {
    const out = applyDefaultsToCreateBody(body(), loaded({}, "other"), new Set(), "b1");
    expect(out).toEqual(body());
    expect(Object.keys(out)).toEqual(Object.keys(body()));
  });

  it("removes an untouched status that the List's default names and the List still declares", () => {
    const out = applyDefaultsToCreateBody(body(), loaded(), new Set(["priority", "assigneeIds", "tagIds", "itemTypeId", "metadata.points"]), "b1");
    expect("status" in out).toBe(false);
  });

  it("never removes the status for a stale default the List no longer declares", () => {
    const out = applyDefaultsToCreateBody(body(), loaded({ status: "GONE" }), new Set(), "b1");
    expect(out.status).toBe("TO_DO");
  });

  it("removes an untouched ownerId and assigneeIds together", () => {
    const out = applyDefaultsToCreateBody(body(), loaded(), new Set(), "b1");
    expect("ownerId" in out).toBe(false);
    expect("assigneeIds" in out).toBe(false);
  });

  it("removes only the untouched metadata key a default names", () => {
    const out = applyDefaultsToCreateBody(body(), loaded(), new Set(), "b1");
    expect(out.metadata).toEqual({ description: "x" });
  });

  it("never removes a value the person chose", () => {
    const touched = new Set(["status", "priority", "ownerId", "tagIds", "itemTypeId", "metadata.points"]);
    const out = applyDefaultsToCreateBody(body(), loaded(), touched, "b1");
    expect(out).toEqual(body());
  });

  it("leaves keys with no default alone", () => {
    const out = applyDefaultsToCreateBody(body(), loaded({ status: undefined, priority: undefined, assigneeIds: undefined, tagIds: undefined, itemTypeId: null, fields: undefined }), new Set(), "b1");
    expect(out).toEqual(body());
  });

  it("removes an untouched priority, tag set and task type that have defaults", () => {
    const out = applyDefaultsToCreateBody(body(), loaded(), new Set(), "b1");
    expect("priority" in out).toBe(false);
    expect("tagIds" in out).toBe(false);
    expect("itemTypeId" in out).toBe(false);
    expect(out.title).toBe("New");
  });
});

describe("the create modal's explicit choices", () => {
  it("keeps a cleared assignee as an explicit null, so default people never come back", () => {
    const out = applyDefaultsToCreateBody({ title: "x", ownerId: null }, loaded(), new Set(["ownerId"]), "b1");
    expect(JSON.parse(JSON.stringify(out))).toEqual({ title: "x", ownerId: null });
  });

  it("keeps a tag the person made or chose once tagIds is touched", () => {
    expect(applyDefaultsToCreateBody({ title: "x", tagIds: ["new"] }, loaded(), new Set(["tagIds"]), "b1")).toEqual({ title: "x", tagIds: ["new"] });
    // Untouched, the List's default tags apply on the server instead.
    expect(applyDefaultsToCreateBody({ title: "x", tagIds: ["new"] }, loaded(), new Set(), "b1")).toEqual({ title: "x" });
  });
});

describe("subtaskCreateBody", () => {
  const base = { title: "Sub", parentItemId: "p1", homeBoardId: "b1", firstStatus: "TO_DO" };

  it("lets the home List's default status apply", () => {
    expect(subtaskCreateBody({ ...base, linked: false, home: loaded() })).toEqual({ title: "Sub", parentItemId: "p1" });
  });

  it("sends today's first status when the home has no default or has not answered", () => {
    expect(subtaskCreateBody({ ...base, linked: false, home: loaded({ status: undefined }) })).toEqual({ title: "Sub", parentItemId: "p1", status: "TO_DO" });
    expect(subtaskCreateBody({ ...base, linked: false, home: null })).toEqual({ title: "Sub", parentItemId: "p1", status: "TO_DO" });
  });

  it("under a linked parent never sends the context List's status", () => {
    const ctxFirst = { ...base, firstStatus: "CTX_ONLY" };
    expect(subtaskCreateBody({ ...ctxFirst, linked: true, home: null })).toEqual({ title: "Sub", parentItemId: "p1" });
    expect(subtaskCreateBody({ ...ctxFirst, linked: true, home: loaded({ status: undefined }) })).toEqual({ title: "Sub", parentItemId: "p1", status: "TO_DO" });
    expect(subtaskCreateBody({ ...ctxFirst, linked: true, home: loaded() })).toEqual({ title: "Sub", parentItemId: "p1" });
    // Settings read for another List are ignored.
    expect(subtaskCreateBody({ ...ctxFirst, linked: true, home: loaded({ status: undefined }, "other") })).toEqual({ title: "Sub", parentItemId: "p1" });
  });
});

describe("pruneListDefaults", () => {
  const ctx = {
    statuses,
    fields,
    liveUserIds: new Set(["u1", "u2"]),
    liveTagIds: new Set(["t1"]),
    liveItemTypeIds: new Set(["type1"]),
  };

  it("keeps defaults that still apply, stale 0", () => {
    const d = { status: "REVIEW", priority: "HIGH" as const, assigneeIds: ["u1"], tagIds: ["t1"], itemTypeId: "type1", fields: { points: 3, size: "s", reviewer: "u2", team: ["u1", "u2"] } };
    expect(pruneListDefaults(d, ctx)).toEqual({ defaults: d, stale: 0 });
  });

  it("drops an unknown field, a value the field no longer takes, and counts each", () => {
    const out = pruneListDefaults({ fields: { gone: 1, size: "xl", points: 2 } }, ctx);
    expect(out.defaults.fields).toEqual({ points: 2 });
    expect(out.stale).toBe(2);
  });

  it("drops a status the List no longer declares", () => {
    const out = pruneListDefaults({ status: "ARCHIVED" }, ctx);
    expect(out.defaults.status).toBeUndefined();
    expect(out.stale).toBe(1);
  });

  it("drops dead people, partially for PEOPLE and assignees", () => {
    const out = pruneListDefaults({ assigneeIds: ["u1", "dead"], fields: { reviewer: "dead", team: ["u2", "dead", "dead2"] } }, ctx);
    expect(out.defaults.assigneeIds).toEqual(["u1"]);
    expect(out.defaults.fields).toEqual({ team: ["u2"] });
    expect(out.stale).toBe(4);
  });

  it("drops the whole key when nobody on it is left", () => {
    const out = pruneListDefaults({ assigneeIds: ["dead"] }, ctx);
    expect(out.defaults.assigneeIds).toBeUndefined();
    expect(out.stale).toBe(1);
  });

  it("drops a dead tag and a dead item type", () => {
    const out = pruneListDefaults({ tagIds: ["t1", "gone"], itemTypeId: "typeGone" }, ctx);
    expect(out.defaults.tagIds).toEqual(["t1"]);
    expect(out.defaults.itemTypeId ?? null).toBeNull();
    expect(out.stale).toBe(2);
  });
});
