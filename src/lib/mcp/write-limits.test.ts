// The write limits (docs/plans/mcp-server.md Decision 15, 3.10, step 3
// tests "limits: the burst, the day caps, and subtasks counted"). A
// connection makes at most 10 changes in 10 seconds and 30 in a minute, and
// 1,000 changes and 5,000 calls a UTC day; a subtask is a change. Through
// the registry (runTool). Fails on the code before step 3: no write tool
// had a body, and nothing counted a change.

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
import { utcDay } from "./usage";
import { NOW, call, data, seedWriteWorld } from "./write-test-call";

const E = MCP_TOOL_COPY.errors;
const at = (s: number) => new Date(NOW.getTime() + s * 1000);
const comments = () => (db.rows.itemUpdate ?? []).length;
const usage = () => db.rows.mcpUsageDay.find((u) => u.grantId === "gr-u-max" && u.day === utcDay(NOW))!;
let n = 0;
const comment = (s: number) => call("add_comment", { taskId: "t1", text: `Note ${(n += 1)}` }, { at: at(s) });

beforeEach(() => {
  seedWriteWorld();
});

describe("the write bursts", () => {
  it("the eleventh write in 10 seconds answers tooFast, runs nothing, and is counted refused; 10 seconds later it goes", async () => {
    for (let i = 0; i < 10; i += 1) data(await comment(0));
    const r = await comment(0);
    expect([r.isError, r.content[0].text]).toEqual([true, E.tooFast(10)]);
    expect(comments()).toBe(10);
    expect(usage()).toMatchObject({ writes: 10, refused: 1 });
    data(await comment(10));
    expect(comments()).toBe(11);
  });

  it("allows 30 in a minute and refuses the 31st until the first of them is a minute old", async () => {
    for (const s of [0, 10, 20]) for (let i = 0; i < 10; i += 1) data(await comment(s));
    const r = await comment(30);
    expect(r.content[0].text).toBe(E.tooFast(30));
    data(await comment(60));
    expect(comments()).toBe(31);
  });

  it("never slows a read", async () => {
    for (let i = 0; i < 10; i += 1) data(await comment(0));
    expect((await comment(0)).isError).toBe(true);
    expect((await call("who_am_i", {}, { at: at(0) })).isError).toBeUndefined();
  });

  it("counts each subtask: a task with 3 subtasks is 4 changes, so 6 more go in those 10 seconds and the next is refused", async () => {
    data(await call("create_task", { title: "Big", listId: "b-launch", subtasks: [{ title: "a" }, { title: "b" }, { title: "c" }] }, { at: at(0) }));
    expect(usage()).toMatchObject({ writes: 4, calls: 1 });
    for (let i = 0; i < 6; i += 1) data(await comment(1));
    expect((await comment(1)).content[0].text).toBe(E.tooFast(9));
    expect(usage()).toMatchObject({ writes: 10 });
  });

  it("lets a task with its 25 subtasks through as one call, and the calls after it wait", async () => {
    const subtasks = Array.from({ length: 25 }, (_, i) => ({ title: `Step ${i + 1}` }));
    const out = data(await call("create_task", { title: "Launch plan", listId: "b-launch", subtasks }, { at: at(0) }));
    expect((out.subtasks as unknown[]).length).toBe(25);
    expect(usage()).toMatchObject({ writes: 26 });
    expect((await comment(5)).content[0].text).toBe(E.tooFast(5));
  });
});

describe("the day caps", () => {
  it("past 1,000 changes a write answers dailyCap and a read still works; it starts again the next UTC day", async () => {
    data(await comment(0));
    usage().writes = 1000;
    const r = await comment(1);
    expect([r.isError, r.content[0].text]).toEqual([true, E.dailyCap]);
    expect(comments()).toBe(1);
    expect((await call("who_am_i", {}, { at: at(1) })).isError).toBeUndefined();
    data(await call("add_comment", { taskId: "t1", text: "Tomorrow" }, { at: new Date(NOW.getTime() + 86_400_000) }));
  });

  it("past 5,000 calls every tool answers dailyCap", async () => {
    data(await comment(0));
    usage().calls = 5000;
    expect((await call("who_am_i", {}, { at: at(1) })).content[0].text).toBe(E.dailyCap);
    expect((await comment(1)).content[0].text).toBe(E.dailyCap);
  });
});

// ── The step 3 review (2026-10-22), M1: calls sent together ──

describe("review M1: a write's whole cost is charged and reserved before it runs", () => {
  const subtasks = Array.from({ length: 25 }, (_, i) => ({ title: `Step ${i + 1}` }));

  it("ten creates of 25 subtasks sent at once make one task and its subtasks; the other nine answer tooFast", async () => {
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => call("create_task", { title: `Plan ${i}`, listId: "b-launch", subtasks }, { at: at(0) })),
    );
    expect(answers.filter((r) => !r.isError)).toHaveLength(1);
    expect(answers.filter((r) => r.isError).map((r) => r.content[0].text)).toEqual(Array(9).fill(E.tooFast(10)));
    expect(db.rows.item.filter((i) => i.boardId === "b-launch" && i.id !== "t1" && i.id !== "t-meet")).toHaveLength(26);
    expect(usage().writes).toBe(26);
  });

  it("at 998, five comments sent at once make two, and the day ends at exactly 1,000", async () => {
    data(await comment(0));
    usage().writes = 998;
    const answers = await Promise.all(Array.from({ length: 5 }, () => comment(1)));
    expect(answers.filter((r) => !r.isError)).toHaveLength(2);
    expect(answers.filter((r) => r.isError).map((r) => r.content[0].text)).toEqual(Array(3).fill(E.dailyCap));
    expect(usage().writes).toBe(1000);
    expect(comments()).toBe(3);
  });

  it("near the line a create makes its task and the subtasks the day allows, reports the rest, and never passes 1,000", async () => {
    data(await comment(0));
    usage().writes = 990;
    const out = data(await call("create_task", { title: "Near the line", listId: "b-launch", subtasks }, { at: at(1) }));
    expect((out.subtasks as unknown[]).length).toBe(9);
    expect((out.failedSubtasks as Array<{ reason: string }>).map((f) => f.reason)).toEqual(Array(16).fill(E.dailyCap));
    expect(usage().writes).toBe(1000);
  });

  it("guard: gives back what a write did not make: a refused create keeps one charge", async () => {
    const refused = await call("create_task", { title: "x", listId: "b-launch", tags: ["nope"], subtasks }, { at: at(0) });
    expect(refused.isError).toBe(true);
    expect(usage()).toMatchObject({ writes: 0, refused: 1 });
    for (let i = 0; i < 9; i += 1) data(await comment(0));
    expect((await comment(0)).content[0].text).toBe(E.tooFast(10));
    expect(usage().writes).toBe(9);
  });

  it("guard: a create whose subtasks partly fail is charged only what it made", async () => {
    const { world } = await import("./write-test-world");
    world.failCreate.add("Step 2");
    world.failCreate.add("Step 3");
    data(await call("create_task", { title: "Five", listId: "b-launch", subtasks: subtasks.slice(0, 5) }, { at: at(0) }));
    expect(usage().writes).toBe(4);
    for (let i = 0; i < 6; i += 1) data(await comment(0));
    expect((await comment(0)).content[0].text).toBe(E.tooFast(10));
  });
});
