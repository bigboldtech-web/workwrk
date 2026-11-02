// POST /api/me/switch-org and a seat its workspace ended (docs/plans/
// workspace-status.md, step 1 review H1). The switcher accepts any membership
// row, and the move swaps the person's status: Pat, live in A and deactivated
// in B (the one-time SQL step copied an old account-wide deactivation onto
// B), picking B was moved there and the account took B's INACTIVE, so Pat
// was signed out of A too, which nobody had ended. The move now refuses it
// and writes nothing; step 2 turns the refusal into the switcher's own answer.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

type Seat = { role: string; status: string; removedAt: Date | null; adminScopes: string[] };
const st = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  seats: new Map<string, Seat>(),
  writes: [] as string[],
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
        const s = st.seats.get(a.where.userId_organizationId.organizationId);
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
});

describe("POST /api/me/switch-org into a seat the workspace ended", () => {
  it("moves nothing and writes nothing, so the person stays live where they are", async () => {
    st.seats.set("org-b", { role: "EMPLOYEE", status: "INACTIVE", removedAt: null, adminScopes: [] });
    await expect(switchTo("org-b")).rejects.toThrow(/would end the account everywhere/);
    expect(st.writes).toEqual([]);
    // Before: anchored in B with B's INACTIVE, so signed out of every workspace.
    expect(st.user).toMatchObject({ organizationId: "org-a", status: "ACTIVE", deletedAt: null });
  });

  it("still switches into a live seat, the account taking that workspace's status", async () => {
    st.seats.set("org-b", { role: "MANAGER", status: "PROBATION", removedAt: null, adminScopes: [] });
    const res = await switchTo("org-b");
    expect(await res.json()).toMatchObject({ switched: true, organizationId: "org-b" });
    expect(st.user).toMatchObject({ organizationId: "org-b", status: "PROBATION", deletedAt: null });
    expect(legacyLevelOfRow(st.user)).toBe("MANAGER");
  });
});
