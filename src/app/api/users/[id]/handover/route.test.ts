// POST /api/users/[id]/handover and its preview. Docs-found fixes batch 5,
// from the batch 4 review:
//   - When the reports moved and the work did not (the WORK transaction
//     failed after LINES committed), the route answered a bare 500, so the
//     admin was never told the reports had already moved, and a retry's
//     "0 direct reports" was the only record. Now a 503 handover_partial
//     that says exactly that.
//   - The person picked to take the work had to be anchored here, so an
//     Owner who works here through a membership (last switched to another
//     workspace) was "not found", though the handover itself takes them.
// Docs-found fixes batch 9: the gate is the real one here
// (person-access.server.ts relationTo and mayHandOverPerson), over a viewer
// each test sets, since batch 8's rule let the org-wide levels and the
// People team read and take anyone's work who was not an Admin.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** People, by id: where each is anchored, and whether they have a membership here. */
  people: {} as Record<string, { organizationId: string; member?: boolean; status?: string; deletedAt?: Date | null; firstName: string; lastName: string; managerId?: string | null; level?: string; seatStatus?: string; seatRemovedAt?: Date | null; memberRole?: string }>,
  /** Whose account keeps working elsewhere once their seat here ends (workspace-status.ts leavesOnlyHere). */
  onlyHere: [] as string[],
  /** The live API keys the leaver made here (seat-api-keys.ts liveKeysMadeHere). */
  apiKeys: 0,
  /** previewReportHandover's calls. */
  previews: [] as unknown[][],
  /** Active KRA assignments: whose, and the workspace of the KRA (the step 3 review H1). */
  kras: [] as Array<{ id: string; userId: string; organizationId: string; name: string }>,
  outcome: "done" as "done" | "partial" | "busy" | "elsewhere" | "waiting",
  /** People who also belong to another live workspace. */
  alsoElsewhere: [] as string[],
  ran: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  /** The viewer, as peopleCtx answers it (batch 9: the real gate reads it). */
  ctx: {} as Record<string, unknown>,
  /** freshWorkspaceActor's answer (batch 8). */
  fresh: { ok: true } as { ok: true } | { ok: false; status: 403; error: string; code: string },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => "u-admin",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
// The real rules over the viewer each test sets (batch 9).
vi.mock("@/lib/people/person-access.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/person-access.server")>();
  return { ...real, peopleCtx: async () => st.ctx };
});
vi.mock("@/lib/access/workspace-admin", async (importOriginal) => ({
  freshWorkspaceActor: async () => st.fresh,
  freshActorRefusal: (await importOriginal<typeof import("@/lib/access/workspace-admin")>()).freshActorRefusal,
}));
vi.mock("@/lib/activity", () => ({ logActivity: (row: Record<string, unknown>) => { st.logs.push(row); } }));
vi.mock("@/lib/prisma", () => {
  type W = { id?: string | { in: string[] }; organizationId?: string | { not: string }; deletedAt?: null; managerId?: string };
  const match = (id: string, w: W) => {
    const p = st.people[id];
    if (!p) return false;
    if (typeof w.id === "string" && w.id !== id) return false;
    if (w.id && typeof w.id === "object" && !w.id.in.includes(id)) return false;
    if (typeof w.organizationId === "string" && p.organizationId !== w.organizationId) return false;
    // Anchored in another workspace (the dialog's "belongs elsewhere").
    if (w.organizationId && typeof w.organizationId === "object" && p.organizationId === w.organizationId.not) return false;
    if ("deletedAt" in w && p.deletedAt) return false;
    if (w.managerId !== undefined && p.managerId !== w.managerId) return false;
    return true;
  };
  const row = (id: string) => ({ id, ...st.people[id], status: st.people[id].status ?? "ACTIVE", ...legacyLevelRow(st.people[id].level ?? "EMPLOYEE") });
  const user = {
    findFirst: async (a: { where: W }) => { const id = Object.keys(st.people).find((x) => match(x, a.where)); return id ? row(id) : null; },
    findMany: async (a: { where: W }) => Object.keys(st.people).filter((x) => match(x, a.where)).map(row),
    findUnique: async (a: { where: { id: string } }) => (st.people[a.where.id] ? row(a.where.id) : null),
  };
  // A member's seat here: SUPER_ADMIN unless a test says otherwise, with its own status (step 3).
  const seatRow = (userId: string) => {
    const p = st.people[userId];
    return { userId, role: p.memberRole ?? "SUPER_ADMIN", status: p.seatStatus ?? "ACTIVE", removedAt: p.seatRemovedAt ?? null, adminScopes: [] };
  };
  const organizationMembership = {
    findMany: async (a: { where: { userId: { in: string[] } } }) => a.where.userId.in.filter((id) => st.people[id]?.member).map(seatRow),
    findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
      const { userId, organizationId } = a.where.userId_organizationId;
      return organizationId === "org" && st.people[userId]?.member ? seatRow(userId) : null;
    },
    // Live seats in another live workspace (the dialog's line).
    count: async (a: { where: { userId: string } }) => (st.alsoElsewhere.includes(a.where.userId) ? 1 : 0),
  };
  const apiKey = { count: async (a: { where: { organizationId: string; createdById: string; revokedAt: null } }) => (a.where.organizationId === "org" && a.where.createdById === "u-leo" && a.where.revokedAt === null ? st.apiKeys : 0) };
  const none = { findMany: async () => [] };
  // The where as Postgres would read it (T1): whose, the status, and the KRA's workspace when asked.
  const kRAAssignment = {
    findMany: async (a: { where: { userId: string; status: string; kra?: { organizationId: string } } }) => {
      const keys = Object.keys(a.where).filter((k) => !["userId", "status", "kra"].includes(k));
      if (keys.length) throw new Error(`fake: unknown kRAAssignment where ${keys.join(", ")}`);
      return st.kras
        .filter((k) => k.userId === a.where.userId && a.where.status === "ACTIVE" && (!a.where.kra || a.where.kra.organizationId === k.organizationId))
        .map((k) => ({ id: k.id, kra: { name: k.name } }));
    },
  };
  return { prisma: { user, organizationMembership, apiKey, item: none, oKR: none, kRAAssignment, asset: none, space: none, folder: none, board: none } };
});
vi.mock("@/lib/people/handover.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/handover.server")>();
  return {
    isOpenStatus: real.isOpenStatus,
    isHandoverWorkFailed: real.isHandoverWorkFailed,
    previewReportHandover: async (...args: unknown[]) => {
      st.previews.push(args);
      return { reports: 0, toRecipient: 0, recipientIsAgent: false, rehomed: [] };
    },
    runHandover: async (input: Record<string, unknown>) => {
      st.ran.push(input);
      if (st.outcome === "busy") throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
      if (st.outcome === "partial") {
        throw new real.HandoverWorkFailed(
          { reportsReassigned: 1, reportsRehomed: [{ id: "r2", name: "Kim", managerId: null, managerName: null }], reportsStaying: [], reportsAlsoElsewhere: [], reportsMoved: 2 },
          new Error("timeout"),
        );
      }
      // Batch 7: every report moves; one who also reported to the leaver in another workspace is named.
      if (st.outcome === "elsewhere") return { tasksReassigned: 3, reportsReassigned: 2, containersReassigned: 1, reportsRehomed: [], reportsStaying: [], reportsAtAccountEnd: [], reportsAlsoElsewhere: [{ id: "r1", name: "Ida Ray" }] };
      // Batch 8: the leaver's account is live, so r1's line waits for its end.
      if (st.outcome === "waiting") return { tasksReassigned: 3, reportsReassigned: 1, containersReassigned: 1, reportsRehomed: [], reportsStaying: [], reportsAtAccountEnd: [{ id: "r1", name: "Ida Ray" }], reportsAlsoElsewhere: [] };
      return { tasksReassigned: 3, reportsReassigned: 2, containersReassigned: 1, reportsRehomed: [], reportsStaying: [], reportsAtAccountEnd: [], reportsAlsoElsewhere: [] };
    },
  };
});

// Whose account keeps working elsewhere is workspace-status.ts's own read
// (tested in workspace-status.test.ts); here each test says it.
vi.mock("@/lib/access/workspace-status", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-status")>()),
  leavesOnlyHere: async (_org: string, id: string) => st.onlyHere.includes(id),
}));

import { GET, POST } from "./route";

/** A viewer as peopleCtx builds it: an Admin unless a test says otherwise. */
function viewer(extra: Record<string, unknown> = {}) {
  return {
    userId: "u-admin",
    organizationId: "org",
    ...legacyLevelRow("COMPANY_ADMIN"),
    orgRole: "ADMIN",
    isAgent: false,
    isAdmin: true,
    peopleTeam: false,
    orgWide: true,
    managerTier: true,
    chain: new Set<string>(),
    writeChain: new Set<string>(),
    viewer: {},
    ...extra,
  };
}

const params = { params: Promise.resolve({ id: "u-leo" }) };
const post = (reassignToId: string) =>
  POST(new NextRequest("https://app.test/api/users/u-leo/handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reassignToId }) }), params);

beforeEach(() => {
  st.alsoElsewhere = [];
  st.onlyHere = [];
  st.apiKeys = 0;
  st.previews = [];
  st.kras = [];
  st.people = {
    "u-leo": { organizationId: "org", firstName: "Leo", lastName: "Leaver" },
    "u-rae": { organizationId: "org", firstName: "Rae", lastName: "Recipient" },
    // Olga is an Owner here who last switched to another workspace.
    "u-olga": { organizationId: "client", member: true, firstName: "Olga", lastName: "Owner" },
    // Fay is in another workspace only.
    "u-fay": { organizationId: "client", firstName: "Fay", lastName: "Far" },
  };
  st.outcome = "done";
  st.ran = [];
  st.logs = [];
  st.ctx = viewer();
  st.fresh = { ok: true };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the handover's answer when the reports moved and the work did not", () => {
  it("is a 503 handover_partial that says so, with what moved, and no handover row claiming it all moved", async () => {
    st.outcome = "partial";
    const res = await post("u-rae");
    // Before: the WORK error rethrown, a bare 500.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = await res.json();
    expect(body).toEqual({
      error: "Their 2 direct reports moved, but their open tasks and their Spaces, Folders and Lists didn't. Try again to move the rest.",
      code: "handover_partial",
      partial: { reportsReassigned: 1, reportsRehomed: [{ id: "r2", name: "Kim", managerId: null, managerName: null }], reportsStaying: [], reportsAlsoElsewhere: [], reportsMoved: 2, tasksReassigned: 0, containersReassigned: 0 },
    });
    expect(st.logs.filter((l) => l.type === "user_handover")).toEqual([]);
  });

  it("a busy role lock is still the 503 roles_busy, and a full run is still logged", async () => {
    st.outcome = "busy";
    expect((await (await post("u-rae")).json()).code).toBe("roles_busy");
    st.outcome = "done";
    const res = await post("u-rae");
    expect(res.status).toBe(200);
    expect(st.logs.filter((l) => l.type === "user_handover")).toHaveLength(1);
  });
});

describe("the person picked to take the work", () => {
  it("may work here through a membership: an Owner anchored in another workspace takes it", async () => {
    const res = await post("u-olga");
    // Before: 404 "Reassignment target not found or inactive".
    expect(res.status).toBe(200);
    expect(st.ran[0]).toMatchObject({ fromId: "u-leo", toId: "u-olga" });
    const preview = await GET(new NextRequest("https://app.test/api/users/u-leo/handover?to=u-olga"), params);
    expect(preview.status).toBe(200);
  });

  it("is never someone who holds no level here", async () => {
    const res = await post("u-fay");
    expect(res.status).toBe(404);
    expect(st.ran).toEqual([]);
  });

  it("the summary says when the person also works in another workspace, so the dialog can say it is not affected", async () => {
    // Each workspace holds its own status (workspace-status D17): the dialog
    // says their other workspaces are not affected, only when they belong to one.
    const quiet = await (await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).json();
    expect(quiet.alsoElsewhere).toBe(false);
    // Leo is anchored here: the line follows the end's own pick (the step 3
    // review L2): a live seat elsewhere he can move to (leavesOnlyHere).
    st.alsoElsewhere = ["u-leo"];
    const blocked = await (await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).json();
    // Before: true, though a seat the move cannot reach leaves the account ended everywhere (D4).
    expect(blocked.alsoElsewhere).toBe(false);
    st.onlyHere = ["u-leo"];
    const warned = await (await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).json();
    expect(warned.alsoElsewhere).toBe(true);
  });

  it("the summary lists a direct report who works here through a membership", async () => {
    st.people["u-rio"] = { organizationId: "client", member: true, firstName: "Rio", lastName: "Ray", managerId: "u-leo" };
    st.people["u-fay"].managerId = "u-leo";
    const res = await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params);
    const body = await res.json();
    // Before: only reports anchored here, so the summary said none.
    expect(body.directReports).toEqual({ count: 1, items: [expect.objectContaining({ id: "u-rio" })] });
  });
});

// Docs-found fixes batch 7: every report moves, and a report who also
// reported to the leaver in another workspace is named in the answer and
// counted in the log. Batch 6 said they stayed "listed under them", untrue
// once the removal or deactivation that follows had landed.
describe("the handover's answer names the reports who also reported to them elsewhere", () => {
  it("answers them, and the user_handover row counts them in plain words", async () => {
    st.outcome = "elsewhere";
    const res = await post("u-rae");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportsAlsoElsewhere).toEqual([{ id: "r1", name: "Ida Ray" }]);
    expect(body.reportsStaying).toEqual([]);
    const row = st.logs.find((l) => l.type === "user_handover") as { description: string; metadata: Record<string, unknown> };
    expect(row.description).toBe("Handed over 3 open tasks, 2 direct reports and 1 Spaces, Folders and Lists from Leo Leaver to Rae Recipient. 1 of their reports also reported to them in another workspace, whose Audit log records the move");
    expect(row.description).not.toMatch(/stay|--|\u2014/);
    expect(row.metadata.reportsAlsoElsewhere).toBe(1);
  });
});

// Docs-found fixes batch 8, from the batch 7 review.
describe("the handover runs only where the removal that follows could land", () => {
  it("refuses whom DELETE would refuse (a manager-tier viewer on an Admin), before anything moves", async () => {
    // Leo is an Admin in Mia's solid tree.
    st.people["u-leo"].level = "COMPANY_ADMIN";
    st.ctx = viewer({ userId: "u-mia", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, chain: new Set(["u-leo"]), writeChain: new Set(["u-leo"]) });
    const res = await post("u-rae");
    // Before: 200 with the work moved, then the Remove refused.
    expect(res.status).toBe(403);
    expect(st.ran).toEqual([]);
    expect((await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).status).toBe(403);
  });

  it("reads the actor fresh, as DELETE does: an Admin demoted a moment ago moves nothing", async () => {
    st.fresh = { ok: false, status: 403, error: "Your access changed a moment ago. Reload the page and log in again if asked.", code: "stale_session" };
    const res = await post("u-rae");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("stale_session");
    expect(st.ran).toEqual([]);
  });

  it("says in the log which lines wait for the account's end", async () => {
    st.outcome = "waiting";
    const res = await post("u-rae");
    expect((await res.json()).reportsAtAccountEnd).toEqual([{ id: "r1", name: "Ida Ray" }]);
    const row = st.logs.find((l) => l.type === "user_handover") as { description: string; metadata: Record<string, unknown> };
    expect(row.description).toBe("Handed over 3 open tasks, 1 direct reports and 1 Spaces, Folders and Lists from Leo Leaver to Rae Recipient. 1 direct report also reports to them in another workspace, so that line moves only when their account ends");
    expect(row.metadata.reportsAtAccountEnd).toBe(1);
  });
});

// Docs-found fixes batch 9, from the batch 8 review: the gate read DELETE's
// rule, which admits the org-wide levels and the People team for everyone
// who is not an Admin, because relationTo answers "org-wide" or
// "people-team" before it asks the chain. Dan, a Director, read Leo's open
// tasks and Spaces and handed them, with Leo's reports, to himself.
describe("the handover goes by the viewer's own solid tree, whatever the relation's label", () => {
  const get = (query = "") => GET(new NextRequest(`https://app.test/api/users/u-leo/handover${query}`), params);
  // Dan is a Director, Leo a VP in another tree, neither an Admin.
  const director = (extra: Record<string, unknown> = {}) =>
    viewer({ userId: "u-dan", ...legacyLevelRow("DIRECTOR"), orgRole: "MEMBER", isAdmin: false, orgWide: true, ...extra });
  beforeEach(() => {
    st.people["u-leo"].level = "VP";
    st.people["u-dan"] = { organizationId: "org", firstName: "Dan", lastName: "Director", level: "DIRECTOR" };
  });

  it("an org-wide level at manager tier reads no summary and moves nothing outside their own tree", async () => {
    st.ctx = director();
    // Before: 200, the titles of Leo's open tasks and his Spaces, Folders and Lists.
    expect((await get()).status).toBe(403);
    expect((await get("?to=u-dan")).status).toBe(403);
    // Before: Dan took all of it, private Spaces too.
    const res = await post("u-dan");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can only run handover for people in your reporting line." });
    expect(st.ran).toEqual([]);
    expect(st.logs).toEqual([]);
  });

  it("the People team at manager tier, the same", async () => {
    st.ctx = viewer({ userId: "u-hana", ...legacyLevelRow("HR"), orgRole: "MEMBER", isAdmin: false, peopleTeam: true, orgWide: true });
    expect((await get()).status).toBe(403);
    expect((await post("u-rae")).status).toBe(403);
    expect(st.ran).toEqual([]);
  });

  it("either hands over inside their own solid tree, as any manager does, and never through a dotted line", async () => {
    st.ctx = director({ chain: new Set(["u-leo"]), writeChain: new Set(["u-leo"]) });
    expect((await get()).status).toBe(200);
    expect((await post("u-rae")).status).toBe(200);
    expect(st.ran).toHaveLength(1);
    st.ran = [];
    // A dotted line: in the read reach only.
    st.ctx = viewer({ userId: "u-mia", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, chain: new Set(["u-leo"]) });
    expect((await post("u-rae")).status).toBe(403);
    expect(st.ran).toEqual([]);
  });
});

// docs/plans/workspace-status.md step 3: the handover of someone who works
// here through a membership, and of someone whose account keeps working
// elsewhere once their seat here ends.
describe("the handover of someone whose account keeps working elsewhere", () => {
  const leaverParams = (id: string) => ({ params: Promise.resolve({ id }) });
  const getFor = (id: string, query = "") => GET(new NextRequest(`https://app.test/api/users/${id}/handover${query}`), leaverParams(id));
  const postFor = (id: string, reassignToId: string) =>
    POST(new NextRequest(`https://app.test/api/users/${id}/handover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reassignToId }) }), leaverParams(id));

  beforeEach(() => {
    // Mia is anchored in the client workspace and works here as a Member through a membership.
    st.people["u-mia"] = { organizationId: "client", member: true, memberRole: "EMPLOYEE", firstName: "Mia", lastName: "Member" };
    st.onlyHere = ["u-mia"];
  });

  it("finds someone who works here through a membership, and hands their work over as a leaver of this workspace only", async () => {
    const summary = await getFor("u-mia");
    // Before: 404 "User not found" (anchored people only).
    expect(summary.status).toBe(200);
    // She belongs to the workspace her account is anchored to.
    expect((await summary.json()).alsoElsewhere).toBe(true);
    const res = await postFor("u-mia", "u-rae");
    expect(res.status).toBe(200);
    // Before: 404, and SCIM's member path was the only one with leavesOnlyHere.
    expect(st.ran[0]).toMatchObject({ fromId: "u-mia", toId: "u-rae", leavesOnlyHere: true });
    // The preview says the same: the lines her other workspace relies on stay.
    await getFor("u-mia", "?to=u-rae");
    expect(st.previews.at(-1)).toEqual(["org", "u-mia", "u-rae", { leavesOnlyHere: true }]);
  });

  it("passes leavesOnlyHere for someone anchored here who moves to a usable seat elsewhere, and not for someone with nowhere else", async () => {
    await post("u-rae");
    expect(st.ran[0]).toMatchObject({ fromId: "u-leo", leavesOnlyHere: false });
    st.onlyHere = ["u-leo"];
    await post("u-rae");
    expect(st.ran[1]).toMatchObject({ fromId: "u-leo", leavesOnlyHere: true });
  });

  it("finds nobody with no seat here, and a manager only over a membership person in their tree who is no Admin here", async () => {
    expect((await getFor("u-fay")).status).toBe(404);
    // A Manager over Mia's solid line: allowed, at the level she holds HERE.
    st.ctx = viewer({ userId: "u-dan", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, chain: new Set(["u-mia"]), writeChain: new Set(["u-mia"]) });
    // Before: 403 (the gate read anchored people only).
    expect((await getFor("u-mia")).status).toBe(200);
    // An Admin here through the membership: never handed over by a manager.
    st.people["u-mia"].memberRole = "COMPANY_ADMIN";
    expect((await getFor("u-mia")).status).toBe(403);
  });

  it("answers how many API keys they made here, which stop working with the seat", async () => {
    st.apiKeys = 2;
    // Before: no such answer, so the dialogs could not warn.
    expect((await (await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).json()).apiKeys).toBe(2);
    st.apiKeys = 0;
    expect((await (await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params)).json()).apiKeys).toBe(0);
  });

  it("refuses a recipient deactivated HERE through their membership, though their account is live", async () => {
    st.people["u-olga"].seatStatus = "INACTIVE";
    const res = await post("u-olga");
    // Before: 200, the account's status read (ACTIVE in the client workspace).
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Olga Owner is deactivated, so they can't take over this work. Pick someone active.");
    expect(st.ran).toEqual([]);
    // Removed here: not in this workspace at all.
    st.people["u-olga"].seatRemovedAt = new Date("2026-10-01");
    expect((await post("u-olga")).status).toBe(404);
  });
});

// The step 3 review H1: the summary read every active KRA assignment of the
// person, so a membership person's own company's KRA names reached this
// workspace's dialog ("They hold 4 KRAs").
describe("the handover summary reads this workspace's KRAs only (H1)", () => {
  it("counts and names the KRAs of this workspace, never those of the workspace their account belongs to", async () => {
    st.people["u-mia"] = { organizationId: "client", member: true, memberRole: "EMPLOYEE", firstName: "Mia", lastName: "Member" };
    st.kras = [
      { id: "a1", userId: "u-mia", organizationId: "client", name: "Client revenue" },
      { id: "a2", userId: "u-mia", organizationId: "client", name: "Client churn" },
      { id: "b1", userId: "u-mia", organizationId: "org", name: "Our onboarding" },
    ];
    const res = await GET(new NextRequest("https://app.test/api/users/u-mia/handover"), { params: Promise.resolve({ id: "u-mia" }) });
    const body = await res.json();
    // Before: 3, with the client's names.
    expect(body.kras).toEqual({ count: 1, items: [{ id: "b1", name: "Our onboarding" }] });
    expect(JSON.stringify(body)).not.toContain("Client");
  });
});
