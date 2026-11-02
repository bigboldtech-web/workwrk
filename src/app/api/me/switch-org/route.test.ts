// POST /api/me/switch-org and a seat its workspace ended (docs/plans/
// workspace-status.md, step 1 review H1). The switcher accepts any membership
// row, and the move swaps the person's status: Pat, live in A and deactivated
// in B (the one-time SQL step copied an old account-wide deactivation onto
// B), picking B was moved there and the account took B's INACTIVE, so Pat
// was signed out of A too, which nobody had ended. The move refuses it and
// writes nothing (step 1), and the switcher answers it itself, before any
// write, with a plain sentence and a 403, never a 500 (step 2).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

type Seat = { role: string; status: string; removedAt: Date | null; adminScopes: string[] };
const st = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  seats: new Map<string, Seat>(),
  writes: [] as string[],
  /** Each read of a seat, by workspace; `endAfterReads` ends that seat once it has been read that many times. */
  reads: new Map<string, number>(),
  endAfterReads: null as null | { organizationId: string; reads: number },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "pat", organizationId: "org-a" } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined }));
vi.mock("@/lib/prisma", () => {
  const client: Record<string, unknown> = {
    $executeRaw: async () => 1,
    user: {
      findUnique: async () => ({ ...st.user }),
      update: async (a: { data: Record<string, unknown> }) => {
        st.writes.push("user.update");
        Object.assign(st.user, a.data);
        return {};
      },
    },
    organizationMembership: {
      findUnique: async (a: { where: { userId_organizationId: { organizationId: string } } }) => {
        const org = a.where.userId_organizationId.organizationId;
        const n = (st.reads.get(org) ?? 0) + 1;
        st.reads.set(org, n);
        const s = st.seats.get(org);
        if (s && st.endAfterReads?.organizationId === org && n > st.endAfterReads.reads) s.status = "INACTIVE";
        return s ? { ...s, organization: { status: "ACTIVE" } } : null;
      },
      findFirst: async () => ({ id: "primary" }),
      upsert: async () => {
        st.writes.push("membership.upsert");
        return {};
      },
    },
    consentRecord: { findFirst: async () => null },
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  return { prisma: client };
});

import { POST } from "./route";

const switchTo = (organizationId: string) =>
  POST(new NextRequest("https://app.test/api/me/switch-org", { method: "POST", body: JSON.stringify({ organizationId }), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  st.user = { organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), adminScopes: [], status: "ACTIVE", deletedAt: null };
  st.seats = new Map();
  st.writes = [];
  st.reads = new Map();
  st.endAfterReads = null;
});

describe("POST /api/me/switch-org into a seat the workspace ended", () => {
  it("refuses a deactivated or removed seat with a plain 403 before anything is written, so the person stays live where they are", async () => {
    st.seats.set("org-b", { role: "EMPLOYEE", status: "INACTIVE", removedAt: null, adminScopes: [] });
    st.seats.set("org-c", { role: "EMPLOYEE", status: "INACTIVE", removedAt: new Date("2026-10-01"), adminScopes: [] });
    for (const org of ["org-b", "org-c"]) {
      const res = await switchTo(org);
      expect(res.status, org).toBe(403);
      expect(await res.json(), org).toEqual({ error: "You no longer have access to that workspace." });
    }
    expect(st.writes).toEqual([]);
    // Before step 1: anchored in B with B's INACTIVE, so signed out of every workspace.
    expect(st.user).toMatchObject({ organizationId: "org-a", status: "ACTIVE", deletedAt: null });
  });

  it("a seat ended between the check and the move answers the same 403, never a 500, with nothing written", async () => {
    st.seats.set("org-b", { role: "EMPLOYEE", status: "ACTIVE", removedAt: null, adminScopes: [] });
    // Live when the route reads it, ended when the move reads it under the person's lock.
    st.endAfterReads = { organizationId: "org-b", reads: 1 };
    const res = await switchTo("org-b");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You no longer have access to that workspace." });
    expect(st.writes).toEqual([]);
    expect(st.user).toMatchObject({ organizationId: "org-a", status: "ACTIVE" });
  });

  it("never refuses the workspace the person is anchored to over its stale membership row: the seat there is the account's", async () => {
    st.user.organizationId = "org-b";
    st.seats.set("org-b", { role: "EMPLOYEE", status: "INACTIVE", removedAt: null, adminScopes: [] });
    const res = await switchTo("org-b");
    expect(await res.json()).toMatchObject({ switched: false, organizationId: "org-b" });
    expect(st.writes).toEqual([]);
  });

  it("still switches into a live seat, the account taking that workspace's status", async () => {
    st.seats.set("org-b", { role: "MANAGER", status: "PROBATION", removedAt: null, adminScopes: [] });
    const res = await switchTo("org-b");
    expect(await res.json()).toMatchObject({ switched: true, organizationId: "org-b" });
    expect(st.user).toMatchObject({ organizationId: "org-b", status: "PROBATION", deletedAt: null });
    expect(legacyLevelOfRow(st.user)).toBe("MANAGER");
  });
});
