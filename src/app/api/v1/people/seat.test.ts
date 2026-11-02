// POST /api/v1/people for an address whose seat here this workspace ended
// (docs/plans/workspace-status.md step 2, the review M1): the invitation
// would bring the seat back (D13), so only an Admin read fresh, or an API
// key with the ADMIN scope, may send it. A Manager is refused, nothing made.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  via: "session" as "session" | "api_key",
  level: "MANAGER",
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["ADMIN", "WRITE"], via: st.via, userId: "boss", ...(st.via === "api_key" ? { apiKeyId: "k1" } : {}) }, error: null }),
}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { ...legacyTestSession("boss", st.level, "org").user, email: "boss@acme.test" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", () => ({ hasPermission: async () => true }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: () => undefined }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: true, level: st.level, admin: st.level === "COMPANY_ADMIN", owner: false }), freshActorRefusal: () => Response.json({}, { status: 403 }) }));
vi.mock("@/lib/auth/invite-facts.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  alreadyInOrg: async () => ({ member: false, inactive: true, removed: true, elsewhere: true }),
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/prisma", () => {
  const tx = { invitation: { create: async (a: { data: Record<string, unknown> }) => { st.created.push(a.data); return { id: "inv1", email: a.data.email }; } } };
  return {
    prisma: {
      organization: { findUnique: async () => ({ domain: "acme.test", settings: {} }) },
      invitation: { findFirst: async () => null },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const post = () => POST(new Request("https://app.test/api/v1/people", { method: "POST", body: JSON.stringify({ email: "pat@acme.test" }) }) as never);

beforeEach(() => {
  st.via = "session";
  st.level = "MANAGER";
  st.created = [];
});

describe("POST /api/v1/people for someone this workspace ended", () => {
  it("refuses a Manager, read fresh, and makes no invitation", async () => {
    const res = await post();
    // Before: 201, and accepting it brought the seat back.
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "They were deactivated or removed here. An Admin can bring them back from Members.", code: "seat_ended" });
    expect(st.created).toEqual([]);
  });

  it("lets an Admin, or an API key with the ADMIN scope, invite them back", async () => {
    st.level = "COMPANY_ADMIN";
    expect((await post()).status).toBe(201);
    st.via = "api_key";
    st.level = "MANAGER";
    expect((await post()).status).toBe(201);
    expect(st.created).toHaveLength(2);
  });
});
