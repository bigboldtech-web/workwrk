// An AI teammate's request in the Inbox (notification-readability.ts): the
// row opens while the request is its person's own, whatever its status (its
// card says how it ended), and reads as deleted once the request is gone or
// when it is anyone else's, as GET /api/agents/actions/[id] answers. A link
// with no request in it (a paused routine's) is left openable.

import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  actions: [
    { id: "act1", organizationId: "org", actingForId: "me", status: "PENDING" },
    { id: "act2", organizationId: "org", actingForId: "me", status: "CANCELLED" },
    { id: "act3", organizationId: "org", actingForId: "u-max", status: "PENDING" },
    { id: "act4", organizationId: "other-org", actingForId: "me", status: "PENDING" },
  ],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentAction: {
      findMany: async (a: { where: { organizationId: string; actingForId: string; id: { in: string[] } } }) =>
        db.actions
          .filter((r) => r.organizationId === a.where.organizationId && r.actingForId === a.where.actingForId && a.where.id.in.includes(r.id))
          .map((r) => ({ id: r.id })),
    },
  },
}));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxFromLevel: () => ({}), nodeRoles: async () => new Map() }));

import { notificationTarget } from "./notification-target";
import { readableTargets, targetKey } from "./notification-readability";

const link = (action: string) => notificationTarget(`/agents?chat=t-chief&action=${action}`);

describe("readableTargets: an AI teammate's request", () => {
  it("opens this person's own requests, decided or not, and reads anyone else's as deleted", async () => {
    const targets = ["act1", "act2", "act3", "act4", "gone"].map(link);
    const map = await readableTargets("me", "org", targets);
    expect(targets.map((t) => [t.id, map.get(targetKey(t))])).toEqual([
      ["act1", { readable: true, reason: null }],
      ["act2", { readable: true, reason: null }],
      ["act3", { readable: false, reason: "deleted" }],
      ["act4", { readable: false, reason: "deleted" }],
      ["gone", { readable: false, reason: "deleted" }],
    ]);
  });

  it("leaves a teammate link with no request in it openable", async () => {
    const routines = notificationTarget("/agents?chat=t-chief&settings=routines");
    expect(routines).toMatchObject({ kind: "agent", id: null });
    const map = await readableTargets("me", "org", [routines]);
    expect(map.has(targetKey(routines))).toBe(false);
  });
});
