// The write tools (docs/plans/mcp-server.md 4.1, 4.3, Decision 11, step 3
// tests "tools-write: readOnly; assignees on a Personal list; unknown tags;
// an append keeps the old text and retries after a 409; Notepad by default;
// two places; a past reminder; kudos to oneself; links reduced to words in a
// title, a kudos message and a note; subtasks with one failing"). Run
// through the registry (runTool), so each answer is what an app reads. The
// create, doc and reminder routes' bodies (createItemAs, createDocAs,
// createReminderFor) run for real; the gates, PATCH and the comment route
// are the stand-ins of write-test-world.ts, over the in-memory store, and
// every activity row goes through the real item-thread.ts. Fails on the code
// before step 3: no write tool had a body.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/item-gate", async () => (await import("./write-test-world")).itemGateMock);
vi.mock("@/lib/agents/acting", async () => (await import("./write-test-world")).actingMock);
vi.mock("@/lib/board", async () => (await import("./write-test-world")).boardMock);
vi.mock("@/lib/board-items", async () => (await import("./write-test-world")).boardItemsMock);
vi.mock("@/lib/items/item-patch", async () => (await import("./write-test-world")).itemPatchMock);
vi.mock("@/lib/items/item-comment", async () => (await import("./write-test-world")).itemCommentMock);
vi.mock("@/lib/doc-access", async () => (await import("./write-test-world")).docAccessMock);
vi.mock("@/lib/access/node-access", async () => (await import("./write-test-world")).nodeAccessMock);
vi.mock("@/lib/access/node-placement", async () => (await import("./write-test-world")).nodePlacementMock);
vi.mock("@/lib/docs/doc-save", async () => (await import("./write-test-world")).docSaveMock);
vi.mock("@/lib/kudos-give", async () => (await import("./write-test-world")).kudosMock);
vi.mock("@/lib/notify-item", async () => (await import("./write-test-world")).quietMocks.notifyItem);
vi.mock("@/services/webhookDispatcher", async () => (await import("./write-test-world")).quietMocks.dispatcher);
vi.mock("@/lib/assignable", async () => (await import("./write-test-world")).quietMocks.assignable);
vi.mock("@/lib/list-connect-server", async () => (await import("./write-test-world")).quietMocks.connect);
vi.mock("@/lib/list-links-server", async () => (await import("./write-test-world")).quietMocks.links);

import { testDb as db } from "@/lib/oauth/oauth-test-db";
import { MCP_TOOL_COPY } from "./mcp-copy";
import { MCP_TOOLS } from "./registry";
import { schemaCheck } from "./schema-check";
import { remindAtOf } from "./tools/write";
import { APP, MAX, NOW, activityRows, call, data, reason, seedWriteWorld } from "./write-test-call";
import { world } from "./write-test-world";

const R = MCP_TOOL_COPY.refusals;
const item = (id: string) => db.rows.item.find((i) => i.id === id)!;

beforeEach(() => {
  seedWriteWorld();
});

/** Each tool's answer must hold to its own outputSchema. */
function holdsToSchema(name: string, payload: Record<string, unknown>): void {
  const tool = MCP_TOOLS.find((t) => t.name === name)!;
  const check = schemaCheck(tool.outputSchema, payload, "output");
  expect(check.ok ? [] : check.problems, name).toEqual([]);
}

describe("a read connection", () => {
  it("answers every write tool with readOnly, and runs nothing", async () => {
    for (const [name, args] of [
      ["create_task", { title: "x" }],
      ["update_task", { taskId: "t1", done: true }],
      ["add_comment", { taskId: "t1", text: "x" }],
      ["give_kudos", { toEmail: "olivia@acme.test", message: "x" }],
    ] as const) {
      const r = await call(name, args, { scopes: ["mcp:read"] });
      expect([r.isError, r.content[0].text], name).toEqual([true, MCP_TOOL_COPY.errors.readOnly]);
    }
    expect([world.calls.create, world.calls.patch, world.calls.comment, world.calls.kudos].map((c) => c.length)).toEqual([0, 0, 0, 0]);
  });
});

describe("create_task", () => {
  it("goes on the person's own Personal list with no listId, through the create route's body", async () => {
    const out = data(await call("create_task", { title: "Try MCP", dueDate: "2026-10-23", priority: "HIGH" }));
    holdsToSchema("create_task", out);
    expect(out.task).toMatchObject({ title: "Try MCP", list: { id: "b-pmax", personal: true }, priority: "HIGH", dueDate: "2026-10-23", status: "To Do", url: expect.stringMatching(/^https:\/\/app\.workwrk\.com\/item\//) });
    // Midnight in Max's zone (Europe/Berlin, summer time on 23 October).
    expect(item((out.task as { id: string }).id).dueAt).toEqual(new Date("2026-10-22T22:00:00.000Z"));
    expect(out.duplicate).toBe(false);
  });

  it("refuses people on a Personal list, and assigns them by email in a List", async () => {
    expect(reason(await call("create_task", { title: "Mine", assigneeEmails: ["olivia@acme.test"] }))).toBe(R.assigneesNeedList);
    expect(world.calls.create).toHaveLength(0);
    const out = data(await call("create_task", { title: "Ours", listId: "b-launch", assigneeEmails: ["olivia@acme.test"] }));
    expect(out.task).toMatchObject({ assignees: [{ id: "u-olivia", name: "Olivia Owner" }], owner: { id: "u-olivia" } });
    expect(reason(await call("create_task", { title: "Ours", listId: "b-launch", assigneeEmails: ["nobody@acme.test"] }))).toBe(R.unknownPerson("nobody@acme.test"));
  });

  it("matches tags by name and never makes one: an unknown tag, or an archived one, is refused and nothing is made", async () => {
    expect(reason(await call("create_task", { title: "Tagged", listId: "b-launch", tags: ["urgent", "brand-new"] }))).toBe(R.unknownTags(["brand-new"]));
    expect(reason(await call("create_task", { title: "Tagged", listId: "b-launch", tags: ["old"] }))).toBe(R.unknownTags(["old"]));
    expect(world.calls.create).toHaveLength(0);
    expect((db.rows.tag ?? []).map((t) => t.name).sort()).toEqual(["old", "urgent"]);
    const out = data(await call("create_task", { title: "Tagged", listId: "b-launch", tags: ["urgent"] }));
    expect(world.calls.create[0].body.tagIds).toEqual(["tag-urgent"]);
    expect((out.task as { id: string }).id).toBeTruthy();
  });

  it("matches a status by its name on that List, and lists the names when it is not one", async () => {
    const out = data(await call("create_task", { title: "Going", listId: "b-launch", status: "in progress" }));
    expect(out.task).toMatchObject({ status: "In Progress" });
    expect(reason(await call("create_task", { title: "Going", listId: "b-launch", status: "Shipped" }))).toBe("That isn't a status in this List. Its statuses are: To Do, In Progress, Done.");
  });

  it("refuses a List it cannot add to, one it cannot see, somebody else's Personal list, and a list with a parent", async () => {
    expect(reason(await call("create_task", { title: "x", listId: "b-view" }))).toBe(R.cantAddToList);
    expect(reason(await call("create_task", { title: "x", listId: "b-secret" }))).toBe(R.listNotFound);
    expect(reason(await call("create_task", { title: "x", listId: "b-poli" }))).toBe(R.listNotFound);
    expect(reason(await call("create_task", { title: "x", listId: "b-launch", parentTaskId: "t1" }))).toBe(R.listAndParent);
    expect(reason(await call("create_task", { title: "x", parentTaskId: "t-meet" }))).toBe(R.taskNotFound);
  });

  it("makes subtasks in order, under the task on its List; one that fails is reported and the rest are made", async () => {
    world.failCreate.add("Second");
    const out = data(
      await call("create_task", {
        title: "Launch day",
        listId: "b-launch",
        subtasks: [{ title: "First" }, { title: "Second" }, { title: "Third", assigneeEmails: ["nobody@acme.test"] }, { title: "Fourth", dueDate: "2026-10-24" }],
      }),
    );
    holdsToSchema("create_task", out);
    const task = out.task as { id: string };
    expect((out.subtasks as Array<{ title: string; parentTaskId: string; list: { id: string } }>).map((s) => [s.title, s.parentTaskId, s.list.id])).toEqual([
      ["First", task.id, "b-launch"],
      ["Fourth", task.id, "b-launch"],
    ]);
    expect(out.failedSubtasks).toEqual([
      { title: "Second", reason: "That task could not be saved." },
      { title: "Third", reason: R.unknownPerson("nobody@acme.test") },
    ]);
    expect(world.calls.create.map((c) => c.body.title)).toEqual(["Launch day", "First", "Second", "Fourth"]);
  });

  it("adds a subtask to a task the person can open, on that task's List", async () => {
    const out = data(await call("create_task", { title: "Part of it", parentTaskId: "t1" }));
    expect(out.task).toMatchObject({ parentTaskId: "t1", list: { id: "b-launch" } });
  });
});

describe("update_task", () => {
  it("adds to the end of the description and never replaces it, sending the text it read", async () => {
    const out = data(await call("update_task", { taskId: "t1", appendToDescription: "Then ship." }));
    holdsToSchema("update_task", out);
    expect(out.changed).toEqual(["description"]);
    expect(world.calls.patch[0].body).toEqual({ metadataPatch: { description: "The plan.\n\nThen ship." }, expectDescription: "The plan." });
    expect((item("t1").metadata as { description: string }).description).toBe("The plan.\n\nThen ship.");
  });

  it("sets an empty description to the text", async () => {
    await call("update_task", { taskId: "t-mine", appendToDescription: "First words." });
    expect(world.calls.patch[0].body).toEqual({ metadataPatch: { description: "First words." }, expectDescription: "" });
  });

  it("keeps the old text and tries again after a 409: what somebody saved in between stays, and the text goes after it", async () => {
    world.beforePatch = (id) => {
      world.beforePatch = null;
      (item(id).metadata as Record<string, unknown>).description = "The plan.\n\nOlivia's line.";
    };
    data(await call("update_task", { taskId: "t1", appendToDescription: "Then ship." }));
    expect(world.calls.patch.map((c) => c.body)).toEqual([
      { metadataPatch: { description: "The plan.\n\nThen ship." }, expectDescription: "The plan." },
      { metadataPatch: { description: "The plan.\n\nOlivia's line.\n\nThen ship." }, expectDescription: "The plan.\n\nOlivia's line." },
    ]);
    expect((item("t1").metadata as { description: string }).description).toBe("The plan.\n\nOlivia's line.\n\nThen ship.");
  });

  it("answers descriptionChanged when the description changes under it twice, and writes nothing", async () => {
    let n = 0;
    world.beforePatch = (id) => {
      n += 1;
      (item(id).metadata as Record<string, unknown>).description = `Edited ${n}`;
    };
    expect(reason(await call("update_task", { taskId: "t1", appendToDescription: "Then ship." }))).toBe(R.descriptionChanged);
    expect((item("t1").metadata as { description: string }).description).toBe("Edited 2");
  });

  it("assigns people only on a task in a List, and matches tags without making them", async () => {
    expect(reason(await call("update_task", { taskId: "t-mine", addAssigneeEmails: ["olivia@acme.test"] }))).toBe(R.assigneesNeedList);
    expect(world.calls.patch).toHaveLength(0);
    data(await call("update_task", { taskId: "t1", addAssigneeEmails: ["olivia@acme.test", "max@acme.test"] }));
    expect(item("t1").assigneeIds).toEqual(["u-olivia", "u-max"]);
    data(await call("update_task", { taskId: "t1", removeAssigneeEmails: ["olivia@acme.test"] }));
    expect(item("t1").assigneeIds).toEqual(["u-max"]);
    expect(reason(await call("update_task", { taskId: "t1", addTags: ["urgent", "nope"] }))).toBe(R.unknownTags(["nope"]));
    data(await call("update_task", { taskId: "t1", addTags: ["urgent"] }));
    expect((db.rows.tagAssignment ?? []).filter((t) => t.entityId === "t1").map((t) => t.tagId)).toEqual(["tag-urgent"]);
  });

  it("refuses status with done, nothing to change, and a meeting's Item", async () => {
    expect(reason(await call("update_task", { taskId: "t1", status: "Done", done: true }))).toBe(R.statusAndDone);
    expect(reason(await call("update_task", { taskId: "t1" }))).toBe(R.nothingToChange);
    expect(reason(await call("update_task", { taskId: "t-meet", done: true }))).toBe(R.taskNotFound);
    expect(world.calls.patch).toHaveLength(0);
  });
});

describe("create_doc", () => {
  it("goes in the person's own Notepad with no place, private, and says so", async () => {
    const r = await call("create_doc", { title: "Ideas", markdown: "# Big\nA line\n- [ ] Do it\n- [x] Done it\n***\nLast" });
    const out = data(r);
    holdsToSchema("create_doc", out);
    expect(out.doc).toMatchObject({ title: "Ideas", place: { kind: "notepad", name: null }, private: true, inNotepad: true, url: expect.stringMatching(/\/work\/docs\//) });
    expect(r.content[0].text.startsWith("Made the doc in your Notepad, where only you can see it.")).toBe(true);
    const doc = db.rows.doc.find((d) => d.id === (out.doc as { id: string }).id)!;
    expect([doc.entityType, doc.entityId, doc.createdById]).toEqual(["NOTEPAD", "u-max", "u-max"]);
    expect((doc.content as { blocks: Array<Record<string, unknown>> }).blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== "id")))).toEqual([
      { kind: "h1", text: "Big" },
      { kind: "paragraph", text: "A line" },
      { kind: "todo", text: "Do it", done: false },
      { kind: "todo", text: "Done it", done: true },
      { kind: "divider" },
      { kind: "paragraph", text: "Last" },
    ]);
  });

  it("refuses two places, and puts it in a Space it can edit", async () => {
    expect(reason(await call("create_doc", { title: "x", place: { spaceId: "s-proof", listId: "b-launch" } }))).toBe(R.twoPlaces);
    expect(db.rows.doc.filter((d) => d.title === "x")).toHaveLength(0);
    const out = data(await call("create_doc", { title: "Plan", place: { spaceId: "s-proof" } }));
    expect(out.doc).toMatchObject({ place: { kind: "space", name: "Proof Space" }, private: false, inNotepad: false });
  });

  it("never puts a doc on somebody else's Personal list or under their note", async () => {
    expect(reason(await call("create_doc", { title: "x", place: { listId: "b-poli" } }))).toBe(R.placeNotFound);
    expect(reason(await call("create_doc", { title: "x", place: { parentDocId: "n-oli" } }))).toBe(R.placeNotFound);
  });
});

describe("append_to_doc", () => {
  it("adds a section at the end, over the version it read", async () => {
    const out = data(await call("append_to_doc", { docId: "d-root", heading: "Update", text: "One\nTwo" }));
    holdsToSchema("append_to_doc", out);
    expect(out).toMatchObject({ doc: { id: "d-root", title: "Handbook" }, version: 2 });
    expect(world.calls.docSave[0].body.knownUpdatedAt).toBe(NOW.toISOString());
  });
});

describe("create_reminder", () => {
  it("refuses a time already past, and reads a time with no offset in the person's zone", async () => {
    expect(reason(await call("create_reminder", { title: "Call", remindAt: "2026-10-21T11:59" }))).toBe(R.reminderWhen);
    expect(reason(await call("create_reminder", { title: "Call", remindAt: "2026-02-30T09:00Z" }))).toBe(R.reminderWhen);
    expect(db.rows.reminder ?? []).toHaveLength(0);
    // 14:30 in Berlin on 21 October is 12:30 UTC.
    const out = data(await call("create_reminder", { title: "Call", remindAt: "2026-10-21T14:30" }));
    holdsToSchema("create_reminder", out);
    expect(out.reminder).toMatchObject({ remindAt: "2026-10-21T12:30:00.000Z", task: null });
    expect(remindAtOf("2026-10-21T14:30:00+02:00", MAX)?.toISOString()).toBe("2026-10-21T12:30:00.000Z");
  });

  it("links a task the person can open, and refuses one they cannot", async () => {
    seedSecretTask();
    expect(reason(await call("create_reminder", { title: "Check", remindAt: "2026-10-22T09:00Z", taskId: "t-secret" }))).toBe(R.taskNotFound);
    const out = data(await call("create_reminder", { title: "Check", remindAt: "2026-10-22T09:00Z", taskId: "t1", email: true }));
    expect(out.reminder).toMatchObject({ task: { id: "t1", name: "Ship it" } });
    expect(db.rows.reminder).toEqual([expect.objectContaining({ userId: "u-max", organizationId: "org-a", entityType: "BOARD_ITEM", entityId: "t1", notifyEmail: true })]);
  });
});

function seedSecretTask(): void {
  db.rows.item.push({ id: "t-secret", organizationId: "org-a", boardId: "b-secret", title: "Secret plan", itemType: "studio-item", status: "TO_DO", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: null });
}

describe("give_kudos", () => {
  it("refuses thanking yourself with the wall's own sentence, and someone unknown with ours", async () => {
    expect(reason(await call("give_kudos", { toEmail: "max@acme.test", message: "Me!" }))).toBe("You cannot give kudos to yourself");
    expect(reason(await call("give_kudos", { toEmail: "ghost@acme.test", message: "Hi" }))).toBe(R.unknownPerson("ghost@acme.test"));
    expect(db.rows.kudos ?? []).toHaveLength(0);
    const out = data(await call("give_kudos", { toEmail: "olivia@acme.test", message: "Great launch", companyValue: "Ownership" }));
    holdsToSchema("give_kudos", out);
    expect(out.kudos).toMatchObject({ message: "Great launch", companyValue: "Ownership", to: { id: "u-olivia", name: "Olivia Owner" } });
  });
});

describe("links are reduced to their words in what is written", () => {
  it("in a task title, a kudos message, a reminder note, a comment and a doc", async () => {
    const link = "[Open the report](https://evil.example/steal)";
    const task = data(await call("create_task", { title: `Read ${link}`, listId: "b-launch" }));
    expect(item((task.task as { id: string }).id).title).toBe("Read Open the report");
    await call("give_kudos", { toEmail: "olivia@acme.test", message: `Thanks, see ${link}` });
    expect(db.rows.kudos[0].message).toBe("Thanks, see Open the report");
    await call("create_reminder", { title: `Do ${link}`, note: `Note ${link}`, remindAt: "2026-10-22T09:00Z" });
    expect([db.rows.reminder[0].title, db.rows.reminder[0].body]).toEqual(["Do Open the report", "Note Open the report"]);
    await call("add_comment", { taskId: "t1", text: `See ${link}` });
    expect(db.rows.itemUpdate.map((u) => u.body)).toEqual(["See Open the report"]);
    const doc = data(await call("create_doc", { title: `Doc ${link}`, markdown: `Body ${link}` }));
    const row = db.rows.doc.find((d) => d.id === (doc.doc as { id: string }).id)!;
    expect(JSON.stringify([row.title, row.content])).not.toContain("evil.example");
    expect(JSON.stringify(db.rows)).not.toContain("evil.example");
  });
});

describe("move_task and add_comment", () => {
  it("move a task to a List the person can add to, and comment on one they can comment on", async () => {
    grant2("list:b-two", "EDIT");
    const moved = data(await call("move_task", { taskId: "t1", listName: "Two" }));
    holdsToSchema("move_task", moved);
    expect(moved).toMatchObject({ task: { id: "t1", title: "Ship it" }, list: { id: "b-two", name: "Two" } });
    const c = data(await call("add_comment", { taskId: "t1", text: "Done today." }));
    holdsToSchema("add_comment", c);
    expect(c).toMatchObject({ task: { id: "t1" }, duplicate: false });
    expect(reason(await call("move_task", { taskId: "t1", listName: "Viewing" }))).toBe("There's no List called Viewing that you can add tasks to.");
  });
});

function grant2(key: string, role: string): void {
  db.rows.board.push({ id: "b-two", organizationId: "org-a", name: "Two", slug: "two", spaceId: "s-proof", folderId: null, productSlug: null, ownerId: null, itemType: "studio-item", settings: {}, statuses: null, schema: { fields: [] }, archivedAt: null });
  world.roles.get("u-max")!.set(key, role);
}

describe("every activity row a write tool makes", () => {
  it("says it came through the app (MCP)", async () => {
    await call("create_task", { title: "A", listId: "b-launch", subtasks: [{ title: "B" }] });
    await call("update_task", { taskId: "t1", done: true, appendToDescription: "More." });
    await call("add_comment", { taskId: "t1", text: "Hello" });
    const rows = activityRows();
    expect(rows.map((r) => r.action).sort()).toEqual(["COMMENTED", "CREATED", "CREATED", "FIELDS_UPDATED", "STATUS_CHANGED", "SUBTASK_ADDED"]);
    for (const r of rows) expect((r.meta as { via?: unknown }).via, String(r.action)).toEqual({ kind: "mcp", app: APP });
  });
});
