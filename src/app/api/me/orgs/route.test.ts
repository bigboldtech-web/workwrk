// GET /api/me/orgs, the workspaces the switcher offers (docs/plans/
// workspace-status.md step 2): only seats the person can use. A workspace
// that deactivated or removed them is not listed, so the switcher never
// offers it (the workspace menu lists exactly what this answers). The
// anchored workspace's own membership row is stale while they are anchored
// there, so that workspace is listed by the account's own status, as before.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ sessionOrg: "org-a" }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "pat", organizationId: st.sessionOrg } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));

import { GET } from "./route";
import { seatDb as db } from "@/lib/access/seat-test-db";

let created = 0;
function membership(organizationId: string, extra: Record<string, unknown> = {}) {
  created += 1;
  return db.seed("organizationMembership", { id: `m-${organizationId}`, userId: "pat", organizationId, createdAt: new Date(Date.UTC(2026, 0, created)), ...extra });
}
const listed = async () => {
  const body = (await (await GET()).json()) as { memberships: Array<{ organization: { id: string }; isCurrent: boolean; role: string }> };
  return body.memberships.map((m) => m.organization.id);
};

beforeEach(() => {
  db.reset();
  created = 0;
  st.sessionOrg = "org-a";
  for (const [id, status] of [["org-a", "ACTIVE"], ["org-b", "ACTIVE"], ["org-c", "TRIAL"], ["org-d", "ACTIVE"], ["org-e", "ACTIVE"], ["org-sus", "SUSPENDED"], ["org-gone", "CANCELLED"]]) {
    db.seed("organization", { id, name: id, status });
  }
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "org-a" });
});

describe("GET /api/me/orgs", () => {
  it("lists the live seats, HR statuses included, and leaves out every seat a workspace ended", async () => {
    membership("org-b", { status: "INACTIVE" });
    membership("org-c", { status: "PROBATION" });
    membership("org-d", { status: "ACTIVE", removedAt: new Date("2026-10-01") });
    membership("org-e");
    // Before: org-b and org-d were offered, and picking one either failed or
    // (before step 1) ended the account everywhere.
    expect(await listed()).toEqual(["org-c", "org-e"]);
  });

  it("still leaves out suspended and closed workspaces", async () => {
    membership("org-sus");
    membership("org-gone");
    membership("org-b");
    expect(await listed()).toEqual(["org-b"]);
  });

  it("lists the anchored workspace by the account's own status, whatever its stale membership row says", async () => {
    // Pat left Acme once (its row then said INACTIVE) and came back: the seat in Acme is the account row now.
    membership("org-a", { status: "INACTIVE", isPrimary: true });
    membership("org-b");
    st.sessionOrg = "org-b";
    const body = (await (await GET()).json()) as { memberships: Array<{ organization: { id: string }; isCurrent: boolean }> };
    expect(body.memberships.map((m) => [m.organization.id, m.isCurrent])).toEqual([["org-a", false], ["org-b", true]]);
  });

  it("an account ended where it is anchored is not offered its anchored workspace", async () => {
    membership("org-a");
    membership("org-b");
    db.row("user", "pat").status = "INACTIVE";
    expect(await listed()).toEqual(["org-b"]);
  });
});
