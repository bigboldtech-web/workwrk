// The Staff console's Set Owner (setWorkspaceOwner). Docs-found fixes batch 5,
// from the batch 4 review: it wrote the Owner level without the workspace's
// role lock, which every other writer of who holds Owner or Admin takes
// (membership.ts lockOrgRoles), so it could race a role change planned on
// the admins as they were; and it could make someone on the Agent tier an
// Owner, which Transfer ownership refuses.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  order: [] as string[],
  person: null as null | { level: string; anchored: boolean },
  writes: [] as Array<{ kind: string; data: unknown }>,
  rolesBusy: false,
  seatsBusy: false,
  /** What each ownerIdsFor call was given (batch 6). */
  ownerReads: [] as unknown[][],
  /** Set to move the person to this workspace when their row lock is taken: a switch committed while Set Owner waited for it. */
  movedOnLock: null as string | null,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    // The old code's own row lock, so it runs here as it ran.
    $queryRaw: async () => { st.order.push("org-row"); return []; },
    // The person's row lock (workspace-anchor.ts lockPerson, the final review M2).
    $executeRaw: async (_s: TemplateStringsArray, id: string) => {
      st.order.push(`person:${id}`);
      if (st.movedOnLock && st.person) st.person.anchored = st.movedOnLock === "co";
      return 1;
    },
    organization: { findUnique: async () => ({ id: "co", name: "Acme" }) },
    user: {
      findFirst: async () => {
        if (!st.person) return null;
        return {
          id: "u-pat",
          firstName: "Pat",
          lastName: "Lee",
          email: "pat@acme.test",
          createdAt: new Date("2026-05-01"),
          organizationId: st.person.anchored ? "co" : "client",
          ...legacyLevelRow(st.person.anchored ? st.person.level : "MANAGER"),
          // With when they joined here (joined-here.ts, the step 4 review H1).
          organizationMemberships: st.person.anchored ? [] : [{ id: "m1", role: st.person.level, createdAt: new Date("2026-06-01"), isPrimary: false }],
        };
      },
      findMany: async () => [],
      update: async (a: { data: unknown }) => { st.writes.push({ kind: "user", data: a.data }); return {}; },
      // Guarded by the workspace the person was read in: a row only while they are anchored there.
      updateMany: async (a: { where: { id: string; organizationId: string }; data: unknown }) => {
        const here = st.person?.anchored ? "co" : "client";
        if (a.where.organizationId !== here) return { count: 0 };
        st.writes.push({ kind: "user", data: a.data });
        return { count: 1 };
      },
    },
    organizationMembership: { update: async (a: { data: unknown }) => { st.writes.push({ kind: "membership", data: a.data }); return {}; } },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => { st.order.push("begin"); return fn(tx); } } };
});
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async () => {
    st.order.push("roles");
    if (st.rolesBusy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
  },
}));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async (_tx: unknown, _org: string, opts?: { bounded?: boolean }) => {
    st.order.push(opts?.bounded ? "seats-bounded" : "seats");
    if (st.seatsBusy) throw Object.assign(new Error("busy"), { name: "SeatsBusy" });
  },
}));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async (...args: unknown[]) => { st.ownerReads.push(args); return []; } }));
vi.mock("@/lib/staff-audit", () => ({ logStaffAction: async () => ({ id: "sa1" }), writeTenantRow: () => undefined }));

import { setWorkspaceOwner } from "./set-owner";

const run = () => setWorkspaceOwner({ companyId: "co", userId: "u-pat", reason: "Their Owner left the company", confirm: "Acme", actor: { id: "staff1" } as never, ip: null });

beforeEach(() => {
  st.order = [];
  st.person = { level: "COMPANY_ADMIN", anchored: true };
  st.writes = [];
  st.rolesBusy = false;
  st.seatsBusy = false;
  st.ownerReads = [];
  st.movedOnLock = null;
});

describe("Set Owner takes the role lock, as every writer of Owner and Admin does", () => {
  it("locks the roles first, then the workspace row (bounded), then writes", async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: true });
    // Before: the workspace row only, never the role lock. The person's row
    // lock comes after the workspace's (the final review, integrity M2).
    expect(st.order).toEqual(["begin", "roles", "seats-bounded", "person:u-pat"]);
    expect(st.writes).toEqual([{ kind: "user", data: legacyLevelRow("SUPER_ADMIN") }]);
  });

  it("answers 503 with nothing written when either lock is busy", async () => {
    st.rolesBusy = true;
    expect(await run()).toEqual({ ok: false, status: 503, error: "Someone else is changing roles or reporting lines in this workspace right now. Try again in a moment." });
    st.rolesBusy = false;
    st.seatsBusy = true;
    expect(await run()).toMatchObject({ ok: false, status: 503 });
    expect(st.writes).toEqual([]);
  });
});

describe("Set Owner never makes an Agent an Owner", () => {
  it("refuses someone on the Agent tier here, anchored or through a membership, and writes nothing", async () => {
    st.person = { level: "AGENT", anchored: true };
    const anchored = await run();
    // Before: { ok: true }, an Agent written as the workspace's Owner.
    expect(anchored).toEqual({ ok: false, status: 400, error: "Pat Lee is on the Agent tier here, and an Agent can't be an Owner. A workspace Admin can change their tier first." });
    st.person = { level: "AGENT", anchored: false };
    expect(await run()).toMatchObject({ ok: false, status: 400 });
    expect(st.writes).toEqual([]);
  });

  it("still promotes a member who is no Agent here through a membership", async () => {
    st.person = { level: "EMPLOYEE", anchored: false };
    expect(await run()).toMatchObject({ ok: true });
    expect(st.writes).toEqual([{ kind: "membership", data: { role: "SUPER_ADMIN" } }]);
  });
});

// Docs-found fixes batch 6, from the batch 5 review: the Owners were read on
// the global client, a second pooled connection, while this transaction held
// the role and seat locks.
describe("Set Owner reads the Owners in its own transaction", () => {
  it("passes its transaction to ownerIdsFor", async () => {
    await run();
    expect(st.ownerReads).toHaveLength(1);
    const db = st.ownerReads[0][1] as { user?: unknown } | undefined;
    // Before: ownerIdsFor(companyId) alone, on the global client.
    expect(st.ownerReads[0][0]).toBe("co");
    expect(db?.user).toBeDefined();
  });
});

// The final review, integrity M2: Set Owner read the person with no lock on
// their row and wrote the account by id, so a switch landing in between put
// the Owner level on an account now anchored in another workspace.
describe("Set Owner and a move between workspaces never cross", () => {
  it("reads the person under their row lock, so a switch that committed first is seen and the level goes on this workspace's seat", async () => {
    st.person = { level: "COMPANY_ADMIN", anchored: true };
    // Pat switched to the client while Set Owner waited for her row: she is read as a membership person here.
    st.movedOnLock = "client";
    expect(await run()).toMatchObject({ ok: true });
    expect(st.writes).toEqual([{ kind: "membership", data: { role: "SUPER_ADMIN" } }]);
  });
});
