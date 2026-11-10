// Tagging someone while editing your own comment (founder report 2026-11-10).
// Editing needs only authorship, but telling somebody and adding them as a
// watcher is what a new comment does, so it asks what a new comment asks.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mayComment: true,
  announced: [] as Array<Record<string, unknown>>,
  edits: [] as string[],
}));

vi.mock("@/lib/item-gate", () => ({
  itemCtx: async () => ({ userId: "me", organizationId: "org" }),
  gateItem: async (_id: string, _c: unknown, floor: string) =>
    floor === "comment" && !h.mayComment
      ? { error: new Response(null, { status: 403 }) }
      : { item: { id: "t1", title: "Ship it", boardId: "b1" }, decision: { role: "VIEW" } },
}));
vi.mock("@/lib/item-thread", () => ({
  getUpdate: async () => ({ id: "u1", entityId: "t1", organizationId: "org", authorId: "me", archivedAt: null, body: "Hello" }),
  editUpdate: async (_id: string, body: string) => {
    h.edits.push(body);
    return { id: "u1", body };
  },
  deleteUpdate: async () => undefined,
}));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => undefined }));
vi.mock("@/lib/items/item-mentions", () => ({
  announceAddedMentions: async (a: Record<string, unknown>) => {
    h.announced.push(a);
  },
}));

import { PATCH } from "./route";

const send = (body: Record<string, unknown>) =>
  PATCH(new Request("http://x/", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "t1", updateId: "u1" }) });

beforeEach(() => {
  h.mayComment = true;
  h.announced = [];
  h.edits = [];
});

describe("PATCH a comment", () => {
  it("tells the people the edit tags, measured against the old words", async () => {
    const res = await send({ body: "Hello @Ravi Kumar", mentionedUserIds: ["ravi"] });
    expect(res.status).toBe(200);
    expect(h.announced).toHaveLength(1);
    expect(h.announced[0]).toMatchObject({ before: "Hello", after: "Hello @Ravi Kumar", claimed: ["ravi"], where: "comment", updateId: "u1", authorId: "me" });
  });

  it("saves the edit but tells nobody when the author may no longer comment here", async () => {
    h.mayComment = false;
    const res = await send({ body: "Hello @Ravi Kumar", mentionedUserIds: ["ravi"] });
    expect(res.status).toBe(200);
    expect(h.edits).toEqual(["Hello @Ravi Kumar"]);
    expect(h.announced).toEqual([]);
  });

  it("guard: an edit that tags nobody announces nothing", async () => {
    expect((await send({ body: "Hello there" })).status).toBe(200);
    expect(h.announced).toEqual([]);
  });
});
