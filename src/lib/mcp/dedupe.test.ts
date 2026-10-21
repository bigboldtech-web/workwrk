// Retried writes (docs/plans/mcp-server.md Decision 19, 4.6, review M4, step
// 3 tests "dedupe: update_task A, B, A writes three times and ends at A;
// add_comment A, an update on the same task, then A again, writes two; an
// identical comment within 60 seconds writes one"). Through the registry
// (runTool). Fails on the code before step 3: no write tool had a body, and
// nothing was deduped.

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
import { MCP_SUMMARY_COPY } from "./mcp-copy";
import { NOW, OLIVIA, activityRows, call, data, reason, seedWriteWorld } from "./write-test-call";
import { world } from "./write-test-world";

const at = (s: number) => new Date(NOW.getTime() + s * 1000);
const comments = () => (db.rows.itemUpdate ?? []).map((u) => u.body);
const statusOf = (id: string) => db.rows.item.find((i) => i.id === id)!.status;

beforeEach(() => {
  seedWriteWorld();
});

describe("a change that sets a value is never replayed", () => {
  it("update_task A, B, A writes three times and ends at A (Done, Open, Done ends Done)", async () => {
    data(await call("update_task", { taskId: "t1", done: true }, { at: at(0) }));
    data(await call("update_task", { taskId: "t1", done: false }, { at: at(1) }));
    data(await call("update_task", { taskId: "t1", done: true }, { at: at(2) }));
    expect(world.calls.patch.map((c) => c.body.status)).toEqual(["DONE", "TO_DO", "DONE"]);
    expect(statusOf("t1")).toBe("DONE");
    expect(activityRows().filter((r) => r.action === "STATUS_CHANGED")).toHaveLength(3);
  });

  it("update_task is never replayed: the same value again runs again and finds nothing to change; move_task is never replayed", async () => {
    data(await call("update_task", { taskId: "t1", priority: "HIGH" }, { at: at(0) }));
    const again = await call("update_task", { taskId: "t1", priority: "HIGH" }, { at: at(1) });
    expect(again.content[0].text.startsWith(MCP_SUMMARY_COPY.taskUnchanged)).toBe(true);
    expect(data(again).changed).toEqual([]);
    expect(world.calls.patch).toHaveLength(1);
    expect(reason(await call("move_task", { taskId: "t1", listId: "b-launch" }, { at: at(2) }))).toBe("That task is already in Launch.");
    expect(reason(await call("move_task", { taskId: "t1", listId: "b-launch" }, { at: at(3) }))).toBe("That task is already in Launch.");
  });
});

describe("a creating write or an append, repeated", () => {
  it("an identical comment within 60 seconds writes one, answered with the first comment marked duplicate; after 60 seconds it is written again", async () => {
    const first = data(await call("add_comment", { taskId: "t1", text: "Shipped." }, { at: at(0) }));
    const again = await call("add_comment", { taskId: "t1", text: "Shipped." }, { at: at(30) });
    expect(comments()).toEqual(["Shipped."]);
    expect(again.content[0].text.startsWith(MCP_SUMMARY_COPY.duplicate)).toBe(true);
    expect(data(again)).toEqual({ ...first, duplicate: true });
    data(await call("add_comment", { taskId: "t1", text: "Shipped." }, { at: at(61) }));
    expect(comments()).toEqual(["Shipped.", "Shipped."]);
  });

  it("add_comment A, an update on the same task, then A again, writes two", async () => {
    data(await call("add_comment", { taskId: "t1", text: "On it." }, { at: at(0) }));
    data(await call("update_task", { taskId: "t1", priority: "HIGH" }, { at: at(1) }));
    data(await call("add_comment", { taskId: "t1", text: "On it." }, { at: at(2) }));
    expect(comments()).toEqual(["On it.", "On it."]);
  });

  it("drops the remembered answer when another connection changes the task too", async () => {
    data(await call("add_comment", { taskId: "t1", text: "On it." }, { at: at(0) }));
    data(await call("update_task", { taskId: "t1", priority: "LOW" }, { at: at(1), as: OLIVIA }));
    data(await call("add_comment", { taskId: "t1", text: "On it." }, { at: at(2) }));
    expect(comments()).toEqual(["On it.", "On it."]);
  });

  it("an append-only update_task repeated is added once; A, B, A adds three", async () => {
    data(await call("update_task", { taskId: "t1", appendToDescription: "A" }, { at: at(0) }));
    data(await call("update_task", { taskId: "t1", appendToDescription: "A" }, { at: at(1) }));
    expect((db.rows.item.find((i) => i.id === "t1")!.metadata as { description: string }).description).toBe("The plan.\n\nA");
    data(await call("update_task", { taskId: "t1", appendToDescription: "B" }, { at: at(2) }));
    data(await call("update_task", { taskId: "t1", appendToDescription: "A" }, { at: at(3) }));
    expect((db.rows.item.find((i) => i.id === "t1")!.metadata as { description: string }).description).toBe("The plan.\n\nA\n\nB\n\nA");
    // An append with any other field sets a value too: never replayed.
    data(await call("update_task", { taskId: "t1", appendToDescription: "C", priority: "LOW" }, { at: at(4) }));
    data(await call("update_task", { taskId: "t1", appendToDescription: "C", priority: "LOW" }, { at: at(5) }));
    expect(world.calls.patch).toHaveLength(5);
  });

  it("a task, a doc, a reminder and a kudos repeated are made once on one connection, and again on another", async () => {
    const t = data(await call("create_task", { title: "Once", listId: "b-launch" }, { at: at(0) }));
    expect(data(await call("create_task", { title: "Once", listId: "b-launch" }, { at: at(5) }))).toEqual({ ...t, duplicate: true });
    data(await call("create_doc", { title: "Notes" }, { at: at(6) }));
    data(await call("create_doc", { title: "Notes" }, { at: at(7) }));
    data(await call("create_reminder", { title: "Ping", remindAt: "2026-10-22T09:00Z" }, { at: at(8) }));
    data(await call("create_reminder", { title: "Ping", remindAt: "2026-10-22T09:00Z" }, { at: at(9) }));
    data(await call("give_kudos", { toEmail: "olivia@acme.test", message: "Thanks" }, { at: at(10) }));
    data(await call("give_kudos", { toEmail: "olivia@acme.test", message: "Thanks" }, { at: at(11) }));
    expect(db.rows.item.filter((i) => i.title === "Once")).toHaveLength(1);
    expect(db.rows.doc.filter((d) => d.title === "Notes")).toHaveLength(1);
    expect(db.rows.reminder).toHaveLength(1);
    expect(db.rows.kudos).toHaveLength(1);
    data(await call("create_task", { title: "Once", listId: "b-launch" }, { at: at(12), as: OLIVIA }));
    expect(db.rows.item.filter((i) => i.title === "Once")).toHaveLength(2);
  });

  it("a repeat sent while the first is still running waits for it and makes nothing", async () => {
    let release!: () => void;
    world.hold = new Promise<void>((r) => {
      release = r;
    });
    const first = call("add_comment", { taskId: "t1", text: "Racing." }, { at: at(0) });
    const second = call("add_comment", { taskId: "t1", text: "Racing." }, { at: at(0) });
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(comments()).toEqual(["Racing."]);
    expect(data(b)).toEqual({ ...data(a), duplicate: true });
  });

  it("a refused write is not remembered: the same call runs again once it can", async () => {
    db.rows.item.push({ id: "t-secret", organizationId: "org-a", boardId: "b-secret", title: "Secret", itemType: "studio-item", status: "TO_DO", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: null });
    expect(reason(await call("add_comment", { taskId: "t-secret", text: "Hi" }, { at: at(0) }))).toBe("I can't find that task.");
    world.roles.get("u-max")!.set("list:b-secret", "EDIT");
    data(await call("add_comment", { taskId: "t-secret", text: "Hi" }, { at: at(1) }));
    expect(comments()).toEqual(["Hi"]);
  });
});
