// POST /api/v1/people invites a person. Docs-found fixes batch 2: firstName
// and lastName were accepted and dropped, though the invitation has both
// columns and the join form starts filled in from them (the People import
// keeps them already). They are kept now, cleaned as the form cleans them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["ADMIN"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", () => ({ hasPermission: async () => true }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: () => undefined }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: false, status: 401, error: "no" }) }));
vi.mock("@/lib/auth/invite-facts.server", () => ({ alreadyInOrg: async () => ({ member: false }) }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    invitation: {
      create: async (a: { data: Record<string, unknown> }) => {
        st.created.push(a.data);
        return { id: "inv1", email: a.data.email };
      },
    },
  };
  return {
    prisma: {
      organization: { findUnique: async () => ({ domain: "acme.test", settings: {} }) },
      invitation: { findFirst: async () => null },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/people", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.created = []; });

describe("POST /api/v1/people", () => {
  it("keeps the first and last name on the invitation, cleaned", async () => {
    const res = await post({ email: "ada@acme.test", firstName: "  Ada <b> ", lastName: "Lovelace" });
    expect(res.status).toBe(201);
    expect(st.created[0]).toMatchObject({ email: "ada@acme.test", firstName: "Ada b", lastName: "Lovelace" });
  });

  it("stores no name when none is given", async () => {
    await post({ email: "bo@acme.test", firstName: "   " });
    expect(st.created[0]).toMatchObject({ firstName: null, lastName: null });
  });
});
