// POST /api/reminders as a function of who is acting, with its task gate
// (docs/plans/mcp-server.md step 3 tests "the extractions: answers equal the
// routes'; the reminder task gate (fails today)", section 11 item 1). The
// route hands the caller and the body to createReminderFor; for the same
// caller and body the two answer the same. A reminder linked to a task is
// made only when the caller can open that task, through the one item gate
// (its 404, nothing made). Fails on the code before step 3: there was no
// createReminderFor, and the route linked any task id on trust.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  readableTasks: new Set<string>(["t-mine"]),
  gateAsks: [] as Array<{ id: string; userId: string; action: string }>,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("next-auth", async () => {
  const { legacyLevelRow } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => ({ user: { id: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org", name: "Max" } }) };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/item-gate", async () => {
  const { legacyLevelRow } = await import("@/lib/access/test-fixtures");
  const { NextResponse } = await import("next/server");
  return {
    itemCtx: async () => ({ userId: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org", userName: "Max" }),
    gateItem: async (id: string, c: { userId: string }, action: string) => {
      h.gateAsks.push({ id, userId: c.userId, action });
      return h.readableTasks.has(id) ? { item: { id } } : { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    },
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reminder: {
      create: async (a: { data: Record<string, unknown> }) => {
        h.rows.push(a.data);
        return { id: `r-${h.rows.length}`, ...a.data };
      },
    },
  },
}));

import { POST } from "@/app/api/reminders/route";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { createReminderFor } from "./create";

const C = { userId: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org", userName: "Max" };

async function read(res: Response) {
  return { status: res.status, body: await res.json() };
}
const viaRoute = async (body: unknown) =>
  read(await POST(new Request("https://app.workwrk.com/api/reminders", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) })));

beforeEach(() => {
  h.gateAsks = [];
  h.rows = [];
});

describe("the task gate", () => {
  it("refuses a link to a task the caller cannot open with the gate's own 404, and makes nothing", async () => {
    const r = await viaRoute({ title: "Check", remindAt: "2026-10-22T09:00:00.000Z", entityType: "BOARD_ITEM", entityId: "t-secret" });
    expect(r).toEqual({ status: 404, body: { error: "Not found" } });
    expect(h.rows).toEqual([]);
    expect(h.gateAsks).toEqual([{ id: "t-secret", userId: "u-max", action: "view" }]);
  });

  it("links a task the caller can open, and a reminder with no task asks no gate", async () => {
    expect((await viaRoute({ title: "Check", remindAt: "2026-10-22T09:00:00.000Z", entityType: "BOARD_ITEM", entityId: "t-mine" })).status).toBe(201);
    expect((await viaRoute({ title: "Call", remindAt: "2026-10-22T09:00:00.000Z" })).status).toBe(201);
    expect(h.gateAsks.map((g) => g.id)).toEqual(["t-mine"]);
    expect(h.rows.map((r) => [r.userId, r.organizationId, r.entityType, r.entityId])).toEqual([
      ["u-max", "org", "BOARD_ITEM", "t-mine"],
      ["u-max", "org", null, null],
    ]);
  });
});

describe("createReminderFor answers as the route does", () => {
  it("for each body", async () => {
    for (const body of [
      { title: "Call", remindAt: "2026-10-22T09:00:00.000Z", body: "Note", notifyEmail: true },
      { title: "Check", remindAt: "2026-10-22T09:00:00.000Z", entityType: "BOARD_ITEM", entityId: "t-mine" },
      { title: "Check", remindAt: "2026-10-22T09:00:00.000Z", entityType: "BOARD_ITEM", entityId: "t-secret" },
      { title: "", remindAt: "2026-10-22T09:00:00.000Z" },
      { title: "When", remindAt: "not a time" },
      "not json",
    ]) {
      h.rows = [];
      const route = await viaRoute(body);
      const routeRows = h.rows;
      h.rows = [];
      const fn = await read(await createReminderFor(C, typeof body === "string" ? {} : body));
      expect(fn, JSON.stringify(body)).toEqual(route);
      expect(h.rows).toEqual(routeRows);
    }
  });
});
