// Contract test for POST /api/kudos/[id]/react.
//
// The route was a toggle, so a Try again after a save that landed but
// answered 500 flipped the saved reaction back off. A client now sends the
// state it wants ({ emoji, on }) and the same request twice leaves the same
// row; a body with no `on` (an older client) still toggles. The database is
// mocked as a real set of reaction rows, so the test reads what the route
// wrote, what it answered and whom it notified.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; kudosId: string; userId: string; emoji: string };
let rows: Row[];
let notifications: { userId: string; message: string }[];
let orgRole: string;
let createRaces: boolean;
let nextId = 0;

const match = (r: Row, w: { kudosId: string; userId?: string; emoji?: string }) =>
  r.kudosId === w.kudosId && (w.userId === undefined || r.userId === w.userId) && (w.emoji === undefined || r.emoji === w.emoji);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kudos: {
      findFirst: async (args: { where: { id: string; organizationId: string } }) =>
        args.where.id === "k-1" && args.where.organizationId === "org-1"
          ? { id: "k-1", receiverId: "u-receiver", giverId: "u-giver", message: "Thanks for the runbook" }
          : null,
    },
    kudosReaction: {
      findUnique: async (args: { where: { kudosId_userId_emoji: { kudosId: string; userId: string; emoji: string } } }) =>
        rows.find((r) => match(r, args.where.kudosId_userId_emoji)) ?? null,
      create: async (args: { data: Omit<Row, "id"> }) => {
        // A racing twin already wrote the same row: the unique index says no.
        if (createRaces) {
          rows.push({ id: `r-${++nextId}`, ...args.data });
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { id: `r-${++nextId}`, ...args.data };
        rows.push(row);
        return row;
      },
      deleteMany: async (args: { where: { kudosId: string; userId: string; emoji: string } }) => {
        const before = rows.length;
        rows = rows.filter((r) => !match(r, args.where));
        return { count: before - rows.length };
      },
      findMany: async (args: { where: { kudosId: string } }) => rows.filter((r) => r.kudosId === args.where.kudosId),
      groupBy: async (args: { where: { kudosId: string } }) => {
        const m = new Map<string, number>();
        for (const r of rows) if (r.kudosId === args.where.kudosId) m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1);
        return Array.from(m.entries()).map(([emoji, n]) => ({ emoji, _count: { emoji: n } }));
      },
    },
    user: { findUnique: async () => ({ firstName: "Asha", lastName: "Rao" }) },
    notification: {
      create: async (args: { data: { userId: string; message: string } }) => {
        notifications.push({ userId: args.data.userId, message: args.data.message });
        return args.data;
      },
    },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-me" } } }),
  getOrgId: () => "org-1",
  getUserId: () => "u-me",
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => ({ userId: "u-me", orgRole }) }));

import { POST } from "./route";

async function react(body: unknown, id = "k-1") {
  const res = await POST(
    new Request(`http://x/api/kudos/${id}/react`, { method: "POST", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const mine = () => rows.filter((r) => r.userId === "u-me").map((r) => r.emoji).sort();

beforeEach(() => {
  rows = [{ id: "r-0", kudosId: "k-1", userId: "u-other", emoji: "🔥" }];
  notifications = [];
  orgRole = "MEMBER";
  createRaces = false;
});

describe("POST /api/kudos/[id]/react with an explicit state", () => {
  it("adds once and a repeated add keeps it (the retry after a committed 500)", async () => {
    const first = await react({ emoji: "🙌", on: true });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ on: true, added: true, changed: true, myReactions: ["🙌"] });
    const again = await react({ emoji: "🙌", on: true });
    expect(again.body).toMatchObject({ on: true, added: true, changed: false, myReactions: ["🙌"] });
    expect(mine()).toEqual(["🙌"]);
  });

  it("notifies the receiver once, never again for a repeated add", async () => {
    await react({ emoji: "🙌", on: true });
    await react({ emoji: "🙌", on: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe("u-receiver");
  });

  it("removes once and a repeated remove keeps it removed", async () => {
    rows.push({ id: "r-9", kudosId: "k-1", userId: "u-me", emoji: "🔥" });
    const first = await react({ emoji: "🔥", on: false });
    expect(first.body).toMatchObject({ on: false, added: false, changed: true, myReactions: [] });
    const again = await react({ emoji: "🔥", on: false });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ on: false, changed: false });
    // Someone else's 🔥 is untouched and still counted.
    expect(again.body.byEmoji).toEqual([{ emoji: "🔥", count: 1 }]);
  });

  it("treats a racing twin add (unique index) as the state asked for, not a 500", async () => {
    createRaces = true;
    const res = await react({ emoji: "🙌", on: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ on: true, changed: false });
    expect(notifications).toHaveLength(0);
  });

  it("refuses an `on` that is not a boolean instead of guessing", async () => {
    for (const on of ["yes", 1, "false"]) {
      const res = await react({ emoji: "🙌", on });
      expect(res.status).toBe(400);
    }
    expect(mine()).toEqual([]);
  });
});

describe("POST /api/kudos/[id]/react from an older client (no `on`)", () => {
  it("still toggles on and then off", async () => {
    expect((await react({ emoji: "🎉" })).body).toMatchObject({ added: true, myReactions: ["🎉"] });
    expect((await react({ emoji: "🎉" })).body).toMatchObject({ added: false, myReactions: [] });
    expect(mine()).toEqual([]);
  });

  it("reads on: null as the old toggle", async () => {
    expect((await react({ emoji: "🎉", on: null })).body).toMatchObject({ added: true });
  });
});

describe("POST /api/kudos/[id]/react refusals", () => {
  it("refuses an emoji outside the picker", async () => {
    expect((await react({ emoji: "💩", on: true })).status).toBe(400);
  });

  it("answers Not found to a Guest and writes nothing", async () => {
    orgRole = "GUEST";
    const res = await react({ emoji: "🙌", on: true });
    expect(res.status).toBe(404);
    expect(mine()).toEqual([]);
  });

  it("answers Not found for a kudos outside the org", async () => {
    expect((await react({ emoji: "🙌", on: true }, "k-other")).status).toBe(404);
  });
});
