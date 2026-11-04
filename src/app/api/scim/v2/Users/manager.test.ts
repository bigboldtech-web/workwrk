// SCIM's manager attribute is THIS workspace's line (docs/plans/
// workspace-status-2.md E9 i, step 7; src/lib/scim-manager.ts), through the
// real routes on the in-memory database (seat-test-db.ts), with the real
// seat reads, the real manager checks and the real writes.
//
// The case. Pat is anchored at her agency A, where she reports to Max, and
// works for client B through a membership, where Dana leads her. Max works
// in B too (a Manager there, under Dana). Lee is anchored in B under Dana.
// Ada is anchored in A and an Agent in B. Rita is anchored in A, live
// there, and B deactivated her through her membership. Zed works in A only.
// Ari owns A, Bo owns B. Each workspace's identity provider pushes its own
// view of who reports to whom.
//
// Before this step SCIM ignored the enterprise extension: B's identity
// provider could never set Pat's manager in B, nothing said why, and no
// resource named anyone's manager.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  org: "b",
  inactive: false,
  followed: [] as Array<{ org: string; ids: string[]; actor: string }>,
  seatLocks: [] as boolean[],
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/scim-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: st.org, workspaceInactive: st.inactive }),
}));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "staff" }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async (_tx: unknown, _org: string, opts?: { bounded?: boolean }) => void st.seatLocks.push(!!opts?.bounded),
  seatsFor: async () => ({ ok: true }),
}));
// Open reviews following the line is review-cycle's own (tested there); who they follow to is recorded.
vi.mock("@/lib/performance/review-cycle.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/performance/review-cycle.server")>()),
  followReportingLine: async (org: string, ids: string[], actor: string) => { st.followed.push({ org, ids, actor }); return 0; },
}));
// The handover after a deprovision is handover.server.test.ts's.
vi.mock("@/lib/people/handover.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/handover.server")>()),
  runHandover: async () => ({ tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [] }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET as list, POST } from "./route";
import { GET, PATCH, PUT } from "./[id]/route";

type Row = Record<string, unknown> & { id: string };
const EXT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, ops: unknown[]) => PATCH(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method: "PATCH", body: JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: ops }) }), params(id));
const put = (id: string, body: unknown) => PUT(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method: "PUT", body: JSON.stringify(body) }), params(id));
const post = (body: unknown) => POST(new NextRequest("https://app.test/api/scim/v2/Users", { method: "POST", body: JSON.stringify(body) }));
const get = async (id: string) => (await (await GET(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`), params(id))).json()) as Record<string, unknown>;
const byName = async (email: string) =>
  (await (await list(new NextRequest(`https://app.test/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`))).json()) as { Resources: Array<Record<string, unknown>> };
const managerOf = (resource: Record<string, unknown>) => (resource[EXT] as { manager?: { value: string; displayName: string } } | undefined)?.manager ?? null;

const account = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
/** Each person's line as each workspace holds it: the account's where anchored, the membership's elsewhere. */
const lineIn = (userId: string, organizationId: string) => (account(userId).organizationId === organizationId ? account(userId).managerId : seatOf(userId, organizationId)?.managerId) ?? null;
const rows = (type: string, organizationId = "b") => ((db.tables.activityLog ?? []) as Row[]).filter((r) => r.type === type && r.organizationId === organizationId);
const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
/**
 * Each push a second after the last, as a real sync's are: the double
 * stamps an Audit row with Date, and two rows in one millisecond would be
 * read back in the order they were made, not newest first.
 */
const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));
/** Whether this workspace's role lock was taken (membership.ts lockOrgRoles), in the order the calls ran. */
const roleLocked = () => db.log.some((e) => e.includes("pg_advisory_xact_lock"));

let made = 0;
function person(id: string, organizationId: string, level: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level), managerId,
    createdAt: new Date(Date.UTC(2025, 0, made)), updatedAt: new Date(Date.UTC(2025, 0, made)), ...extra,
  });
}
const membership = (userId: string, organizationId: string, role: string, managerId: string | null, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, managerId, createdAt: new Date("2026-06-01"), ...extra });

/** The resource as Azure's PATCH sets a manager: the extension's path, a bare id. */
const azureSet = (value: string) => ({ op: "Add", path: `${EXT}:manager`, value });

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  db.reset();
  made = 0;
  st.org = "b";
  st.inactive = false;
  st.followed = [];
  st.seatLocks = [];
  db.onQueryRaw = () => [{ n: 0 }];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE", plan: "STARTER", settings: {}, domain: null });
  // A.
  person("ari", "a", "SUPER_ADMIN", null);
  person("max", "a", "MANAGER", "ari");
  person("pat", "a", "EMPLOYEE", "max");
  person("ada", "a", "MANAGER", "ari");
  person("rita", "a", "MANAGER", "ari");
  person("zed", "a", "EMPLOYEE", "ari");
  // B.
  person("bo", "b", "SUPER_ADMIN", null);
  person("dana", "b", "MANAGER", "bo");
  person("lee", "b", "EMPLOYEE", "dana");
  // Seats through a membership, each with that workspace's own line (E1).
  membership("pat", "b", "EMPLOYEE", null);
  membership("max", "b", "MANAGER", "dana");
  membership("ada", "b", "AGENT", "bo");
  membership("rita", "b", "MANAGER", "bo", { status: "INACTIVE" });
});

describe("B's identity provider sets Pat's manager to Dana: B's line only, and A's line to Max stays (E9 i)", () => {
  it("an Okta-shaped PATCH (a value with no path, the extension's manager.value) writes her B membership, under the role lock first", async () => {
    const res = await patch("pat", [{ op: "replace", value: { [EXT]: { manager: { value: "dana", displayName: "Dana Ng" } } } }]);
    expect(res.status).toBe(200);
    // Before: 200 answered as stored, nothing written (the extension was ignored).
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
    expect(account("pat")).toMatchObject({ organizationId: "a", managerId: "max", firstName: "Pat" });
    expect(managerOf(await res.json())).toEqual({ value: "dana", displayName: "Dana Ng" });
    expect(rows("reporting_line_changed")).toEqual([
      expect.objectContaining({ actorType: "scim", actorLabel: "Identity provider", targetId: "pat", description: "Changed who Pat Ng reports to", oldValue: { managerId: null }, newValue: { managerId: "dana" } }),
    ]);
    expect(rows("reporting_line_changed", "a")).toEqual([]);
    // Her open B reviews follow the new line, to B's first Owner when no person acted.
    expect(st.followed).toEqual([{ org: "b", ids: ["pat"], actor: "bo" }]);
    // This workspace's role lock, then her row lock (seat-writes.ts's order).
    const roleLock = db.log.findIndex((e) => e.startsWith("tx.SELECT pg_advisory_xact_lock"));
    expect(roleLock).toBeGreaterThanOrEqual(0);
    expect(roleLock).toBeLessThan(db.log.indexOf("tx.lock:pat"));
  });

  it("an Azure-shaped PATCH (the extension's path, a bare id) does the same, and so does the manager.value path", async () => {
    expect((await patch("pat", [azureSet("dana")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
    expect((await patch("pat", [{ op: "replace", path: `${EXT}:manager.value`, value: "bo" }])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("bo");
    expect(lineIn("pat", "a")).toBe("max");
  });

  it("an Azure-shaped PUT of the full resource writes her B line and never her names, which A shares (phase 1's identity rule)", async () => {
    const res = await put("pat", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", EXT],
      userName: "pat.b@client.test",
      name: { givenName: "Patricia", familyName: "Other" },
      active: true,
      [EXT]: { manager: { value: "dana" } },
    });
    expect(res.status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
    // The manager line is B's own; her names and address are the account's, read by A too.
    expect(account("pat")).toMatchObject({ email: "pat@x.test", firstName: "Pat", lastName: "Ng" });
  });

  it("for someone anchored in B too: Lee's account line, with her name change in the same push", async () => {
    const res = await put("lee", { userName: "lee@x.test", name: { givenName: "Leela", familyName: "Ng" }, [EXT]: { manager: { value: "bo" } } });
    expect(res.status).toBe(200);
    expect(account("lee")).toMatchObject({ firstName: "Leela", managerId: "bo" });
  });

  it("a manager named by address, this service keeping no externalId, is found at their seat in B", async () => {
    expect((await patch("pat", [azureSet("DANA@x.test")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
  });

  it("A's identity provider sets Pat's A line, and B's line to Dana stays", async () => {
    seatOf("pat", "b").managerId = "dana";
    st.org = "a";
    expect((await patch("pat", [azureSet("ari")])).status).toBe(200);
    expect(lineIn("pat", "a")).toBe("ari");
    expect(lineIn("pat", "b")).toBe("dana");
  });

  it("a loop only across workspaces is no loop (E5): Max under Pat in B, though Pat reports to Max in A", async () => {
    expect((await patch("max", [azureSet("pat")])).status).toBe(200);
    expect(lineIn("max", "b")).toBe("pat");
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("max", "a")).toBe("ari");
    expect(rows("reporting_line_refused")).toEqual([]);
  });

  it("the manager she already has, sent again, is no change: nothing written, nothing logged, and the answer names her", async () => {
    seatOf("pat", "b").managerId = "dana";
    const writes = db.writes.length;
    const res = await patch("pat", [azureSet("dana")]);
    expect(res.status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
    expect(db.writes.length).toBe(writes);
    expect(rows("reporting_line_changed")).toEqual([]);
    expect(rows("reporting_line_refused")).toEqual([]);
    // Before: the answer named no manager at all.
    expect(managerOf(await res.json())).toEqual({ value: "dana", displayName: "Dana Ng" });
    // The step 7 review L3: no change, so no role lock (before: every push carrying a manager took it).
    expect(roleLocked()).toBe(false);
  });

  it("an unchanged manager riding on a name change takes no role lock, and a clear of an empty line takes none either (the step 7 review L3)", async () => {
    const res = await put("lee", { userName: "lee@x.test", name: { givenName: "Leela", familyName: "Ng" }, [EXT]: { manager: { value: "dana@x.test" } } });
    expect(res.status).toBe(200);
    expect(account("lee")).toMatchObject({ firstName: "Leela", managerId: "dana" });
    expect(db.log).toContain("tx.lock:lee");
    expect(roleLocked()).toBe(false);
    expect((await patch("pat", [{ op: "remove", path: `${EXT}:manager` }])).status).toBe(200);
    expect(roleLocked()).toBe(false);
    expect(rows("reporting_line_changed")).toEqual([]);
  });

  it("a change seen before the lock is checked again under it: Dana made an Agent meanwhile is refused (the step 7 review L3)", async () => {
    // The role lock is where a role change making Dana an Agent would have committed first.
    db.onCall = async (entry) => { if (entry.startsWith("tx.SELECT pg_advisory_xact_lock")) Object.assign(account("dana"), legacyLevelRow("AGENT")); };
    expect((await patch("pat", [azureSet("dana")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBeNull();
    expect(rows("reporting_line_refused").map((r) => (r.metadata as { reason: string }).reason)).toEqual(["agent"]);
  });
});

describe("a manager B can't give her is refused in words: nothing of the line is written, and the rest of the push goes on", () => {
  it("someone with no seat in B (Zed): never named, and the reactivation in the same push lands", async () => {
    seatOf("pat", "b").status = "INACTIVE";
    seatOf("pat", "b").managerId = "dana";
    const res = await patch("pat", [{ op: "replace", path: "active", value: true }, azureSet("zed")]);
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b").status).toBe("ACTIVE");
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
    const refused = rows("reporting_line_refused");
    expect(refused).toEqual([
      expect.objectContaining({
        actorType: "scim",
        targetId: "pat",
        description: "The identity provider's manager for Pat Ng was not set: that manager isn't anyone who works in this workspace. Their manager here is unchanged.",
        metadata: { scim: true, asked: "zed", reason: "not_here" },
      }),
    ]);
    expect(JSON.stringify(refused[0].description)).not.toContain("Zed");
    expect(managerOf(await res.json())).toEqual({ value: "dana", displayName: "Dana Ng" });
  });

  it("a reactivation clears a stale B line first, then logs the refused manager, and A's line stays (the step 7 review L6)", async () => {
    // While Pat was away from B, B deactivated Rita, her B manager.
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE", managerId: "rita" });
    const res = await patch("pat", [{ op: "replace", path: "active", value: true }, azureSet("ada")]);
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b").status).toBe("ACTIVE");
    expect(lineIn("pat", "b")).toBeNull();
    expect(lineIn("pat", "a")).toBe("max");
    const lines = ((db.tables.activityLog ?? []) as Row[]).filter((r) => r.targetId === "pat" && r.organizationId === "b" && String(r.type).startsWith("reporting_line_"));
    expect(lines.map((r) => [r.type, r.oldValue])).toEqual([
      ["reporting_line_changed", { managerId: "rita" }],
      ["reporting_line_refused", { managerId: null }],
    ]);
    expect(lines[0].description).toBe("Reactivated Pat Ng with no manager: Rita Ng is deactivated");
    expect((lines[1].metadata as { reason: string }).reason).toBe("agent");
  });

  it("Rita, whom B deactivated through her membership: refused as deactivated, and Lee's name change lands", async () => {
    const res = await put("lee", { userName: "lee@x.test", name: { givenName: "Leela", familyName: "Ng" }, [EXT]: { manager: { value: "rita" } } });
    expect(res.status).toBe(200);
    expect(account("lee")).toMatchObject({ firstName: "Leela", managerId: "dana" });
    expect(rows("reporting_line_refused").map((r) => r.description)).toEqual([
      "The identity provider's manager for Leela Ng was not set: Rita Ng is deactivated here, and a deactivated person can't have reports. Their manager here is unchanged.",
    ]);
  });

  it("Ada, an Agent in B (a Manager in A): refused, and Pat's B line stays as it was", async () => {
    seatOf("pat", "b").managerId = "dana";
    expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
    expect(rows("reporting_line_refused").map((r) => (r.metadata as { reason: string }).reason)).toEqual(["agent"]);
    expect(rows("reporting_line_refused")[0].description).toContain("Ada Ng is an Agent here, and an Agent can't be anyone's manager");
  });

  it("a loop in B's lines: Dana under Pat while Pat is under Dana in B, and Dana's name change lands", async () => {
    seatOf("pat", "b").managerId = "dana";
    const res = await put("dana", { userName: "dana@x.test", name: { givenName: "Danielle", familyName: "Ng" }, [EXT]: { manager: { value: "pat" } } });
    expect(res.status).toBe(200);
    expect(account("dana")).toMatchObject({ firstName: "Danielle", managerId: "bo" });
    expect(rows("reporting_line_refused").map((r) => r.description)).toEqual([
      "The identity provider's manager for Danielle Ng was not set: that would make a reporting loop, since Danielle Ng already manages Pat Ng, directly or further down. Their manager here is unchanged.",
    ]);
  });

  it("the person themself, and a value that names nobody (an employee number)", async () => {
    expect((await patch("pat", [azureSet("pat")])).status).toBe(200);
    expect((await patch("pat", [{ op: "replace", path: `${EXT}:manager`, value: { value: 40213 } }])).status).toBe(200);
    expect(lineIn("pat", "b")).toBeNull();
    expect(rows("reporting_line_refused").map((r) => r.metadata)).toEqual([
      { scim: true, asked: "pat", reason: "self" },
      { scim: true, asked: "40213", reason: "not_here" },
    ]);
  });

  it("the same refusal pushed again makes one row; after anyone changes the line, the next push logs again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 3; i += 1) {
      tick();
      expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    }
    expect(rows("reporting_line_refused")).toHaveLength(1);
    // B's provider names Dana (written), then Ada again: a new row, since the line is not the one the first was logged against.
    tick();
    expect((await patch("pat", [azureSet("dana")])).status).toBe(200);
    tick();
    expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    expect(rows("reporting_line_refused")).toHaveLength(2);
    expect(rows("reporting_line_refused")[1].oldValue).toEqual({ managerId: "dana" });
    tick();
    // A different refusal is its own row.
    expect((await patch("pat", [azureSet("zed")])).status).toBe(200);
    expect(rows("reporting_line_refused")).toHaveLength(3);
    expect(lineIn("pat", "b")).toBe("dana");
  });

  it("a line changed outside SCIM, by a door that logs no row for the person (a bulk change, the Agent move), logs the next refusal again (the step 7 review L1)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    // Bo's bulk Change manager writes Pat's B line and one bulk_update row naming no one.
    seatOf("pat", "b").managerId = "lee";
    tick();
    expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    // Before (the reviewed step 7): no line change row for Pat, so the second refusal was held back.
    expect(rows("reporting_line_refused").map((r) => r.oldValue)).toEqual([{ managerId: null }, { managerId: "lee" }]);
    tick();
    expect((await patch("pat", [azureSet("ada")])).status).toBe(200);
    expect(rows("reporting_line_refused")).toHaveLength(2);
    expect(lineIn("pat", "b")).toBe("lee");
  });

  it("a seat B removed takes no line, logged, and A's line stays; a refused clear says it was not cleared (the step 7 review L8)", async () => {
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE", removedAt: new Date("2026-10-01"), managerId: "bo" });
    expect((await patch("pat", [azureSet("dana")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("bo");
    expect(lineIn("pat", "a")).toBe("max");
    expect(rows("reporting_line_refused").map((r) => (r.metadata as { reason: string }).reason)).toEqual(["removed"]);
    expect((await patch("pat", [{ op: "remove", path: `${EXT}:manager` }])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("bo");
    expect(rows("reporting_line_refused").map((r) => r.description)).toEqual([
      "The identity provider's manager for Pat Ng was not set: Pat Ng was removed from this workspace. Their manager here is unchanged.",
      "The identity provider's manager for Pat Ng was not cleared: Pat Ng was removed from this workspace. Their manager here is unchanged.",
    ]);
  });

  it("an address: a live seat before a deactivated twin, the account anchored here before one through a membership, a removed seat never (the step 7 review L6, L7)", async () => {
    // Max's old account, anchored in B and deactivated there, shares his address with his live account from A.
    person("oldmax", "b", "MANAGER", "bo", { email: "max@x.test", status: "INACTIVE" });
    expect((await patch("pat", [azureSet("max@x.test")])).status).toBe(200);
    // Before (the reviewed step 7): the deactivated twin anchored here was taken, and the push refused.
    expect(lineIn("pat", "b")).toBe("max");
    // Two live accounts at one address: the one anchored here is this workspace's own.
    person("sam", "b", "MANAGER", "bo", { email: "sam@x.test" });
    person("sama", "a", "MANAGER", "ari", { email: "sam@x.test" });
    membership("sama", "b", "MANAGER", "bo");
    expect((await patch("pat", [azureSet("SAM@x.test")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("sam");
    // A lone deactivated match is refused as deactivated, by name; a removed seat's address names nobody.
    expect((await patch("pat", [azureSet("rita@x.test")])).status).toBe(200);
    person("gus", "b", "MANAGER", "bo", { deletedAt: new Date("2026-10-01"), status: "INACTIVE" });
    expect((await patch("pat", [azureSet("gus@x.test")])).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("sam");
    const refused = rows("reporting_line_refused");
    expect(refused.map((r) => (r.metadata as { reason: string }).reason)).toEqual(["inactive", "not_here"]);
    expect(refused[0].description).toContain("Rita Ng is deactivated here");
    expect(refused[1].description).not.toContain("Gus");
  });
});

describe("a remove, or a null, clears B's line only", () => {
  beforeEach(() => {
    seatOf("pat", "b").managerId = "dana";
  });

  it("a PATCH remove of the extension's manager clears her B membership's line, and A's line to Max stays", async () => {
    const res = await patch("pat", [{ op: "Remove", path: `${EXT}:manager` }]);
    expect(res.status).toBe(200);
    // Before: the remove was skipped, and Dana stayed.
    expect(lineIn("pat", "b")).toBeNull();
    expect(lineIn("pat", "a")).toBe("max");
    expect(rows("reporting_line_changed")).toEqual([expect.objectContaining({ description: "Cleared who Pat Ng reports to", oldValue: { managerId: "dana" }, newValue: { managerId: null } })]);
    expect(managerOf(await res.json())).toBeNull();
  });

  it("a replace with an empty manager.value, and a PUT with a null manager, clear it; a PUT that leaves the manager out keeps it", async () => {
    expect((await patch("pat", [{ op: "replace", path: `${EXT}:manager.value`, value: "" }])).status).toBe(200);
    expect(lineIn("pat", "b")).toBeNull();
    seatOf("pat", "b").managerId = "dana";
    expect((await put("lee", { userName: "lee@x.test", name: { givenName: "Lee", familyName: "Ng" } })).status).toBe(200);
    expect(account("lee").managerId).toBe("dana");
    expect((await put("lee", { userName: "lee@x.test", [EXT]: { manager: null } })).status).toBe(200);
    expect(account("lee").managerId).toBeNull();
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
  });
});

describe("GET answers each workspace's line as the enterprise manager, a reference to the manager's SCIM id", () => {
  beforeEach(() => {
    seatOf("pat", "b").managerId = "dana";
  });

  it("shows Dana for Pat in B's SCIM and Max in A's, by id and by the address filter", async () => {
    // Before: no manager in any resource.
    const inB = await get("pat");
    expect(managerOf(inB)).toEqual({ value: "dana", displayName: "Dana Ng" });
    expect(inB.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:User", EXT]);
    expect(managerOf((await byName("pat@x.test")).Resources[0])).toEqual({ value: "dana", displayName: "Dana Ng" });
    st.org = "a";
    expect(managerOf(await get("pat"))).toEqual({ value: "max", displayName: "Max Ng" });
    expect(managerOf((await byName("pat@x.test")).Resources[0])).toEqual({ value: "max", displayName: "Max Ng" });
    // A's unfiltered list: the people anchored in A, each with A's line.
    const all = (await (await list(new NextRequest("https://app.test/api/scim/v2/Users"))).json()) as { Resources: Array<Record<string, unknown>> };
    expect(managerOf(all.Resources.find((r) => r.id === "pat")!)).toEqual({ value: "max", displayName: "Max Ng" });
  });

  it("names a manager only while they hold a seat here (never one with no seat, or a removed one), and leaves the extension out for someone with no manager", async () => {
    // Max, here through a membership, under Dana in B: named (before: no manager in any resource).
    expect(managerOf(await get("max"))).toEqual({ value: "dana", displayName: "Dana Ng" });
    account("lee").managerId = "zed";
    const lee = await get("lee");
    expect(managerOf(lee)).toBeNull();
    expect(lee.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:User"]);
    // Rita's seat here is deactivated, not removed: still named. Once B removes it, never.
    account("lee").managerId = "rita";
    expect(managerOf(await get("lee"))).toEqual({ value: "rita", displayName: "Rita Ng" });
    seatOf("rita", "b").removedAt = new Date("2026-10-01");
    expect(managerOf(await get("lee"))).toBeNull();
    expect(managerOf(await get("bo"))).toBeNull();
  });
});

describe("POST takes the manager in the create's own transaction", () => {
  const create = (email: string, manager: unknown) => post({ userName: email, name: { givenName: "Nia", familyName: "Ng" }, [EXT]: { manager } });

  it("makes the account under Dana here, with the role lock first and the seat lock bounded", async () => {
    const res = await create("nia@x.test", { value: "dana" });
    expect(res.status).toBe(201);
    const made = await res.json();
    const nia = db.tables.user.find((u) => u.email === "nia@x.test")!;
    expect(nia).toMatchObject({ organizationId: "b", managerId: "dana" });
    expect(managerOf(made)).toEqual({ value: "dana", displayName: "Dana Ng" });
    expect(st.seatLocks).toEqual([true]);
    expect(rows("reporting_line_changed")).toEqual([expect.objectContaining({ targetId: nia.id, newValue: { managerId: "dana" } })]);
  });

  it("still makes the account when the manager is refused, with its row", async () => {
    const res = await create("nia@x.test", { value: "ada" });
    expect(res.status).toBe(201);
    const nia = db.tables.user.find((u) => u.email === "nia@x.test")!;
    expect(nia.managerId ?? null).toBeNull();
    expect(rows("reporting_line_refused").map((r) => r.targetId)).toEqual([nia.id]);
  });

  it("a revive of Pat's deactivated B seat takes the manager in the reactivation's transaction", async () => {
    seatOf("pat", "b").status = "INACTIVE";
    const res = await post({ userName: "pat@x.test", name: { givenName: "Pat", familyName: "Ng" }, [EXT]: { manager: { value: "dana" } } });
    expect(res.status).toBe(201);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", managerId: "dana" });
    expect(lineIn("pat", "a")).toBe("max");
    expect(managerOf(await res.json())).toEqual({ value: "dana", displayName: "Dana Ng" });
  });
});

describe("busy, a deadlock, and the workspaces that take no write", () => {
  it("a deadlock Postgres breaks under Pat's lock is the 503 the provider retries, with nothing written", async () => {
    db.onCall = async (entry) => { if (entry === "tx.lock:pat") throw deadlock(); };
    const res = await patch("pat", [azureSet("dana")]);
    // Before: 200, the manager ignored.
    expect(res.status).toBe(503);
    expect(lineIn("pat", "b")).toBeNull();
    expect(rows("reporting_line_changed")).toEqual([]);
    expect(rows("reporting_line_refused")).toEqual([]);
  });

  it("a deadlock in an anchored person's push, after her names were written, rolls them back too, so the retry writes them all (the step 7 review L5)", async () => {
    // Her lock is taken twice: before the names' write, and again by the manager's write after it.
    let locks = 0;
    db.onCall = async (entry) => { if (entry === "tx.lock:lee" && (locks += 1) === 2) throw deadlock(); };
    const res = await put("lee", { userName: "lee@x.test", name: { givenName: "Leela", familyName: "Ng" }, [EXT]: { manager: { value: "bo" } } });
    expect(res.status).toBe(503);
    expect(locks).toBe(2);
    // The names were written through the transaction (its client logs "tx."), before the deadlock, and rolled back with it.
    const wrote = db.log.indexOf("tx.user.updateMany");
    expect(wrote).toBeGreaterThanOrEqual(0);
    expect(wrote).toBeLessThan(db.log.lastIndexOf("tx.lock:lee"));
    expect(db.log).not.toContain("user.updateMany");
    expect(account("lee")).toMatchObject({ firstName: "Lee", managerId: "dana" });
  });

  it("a deadlock in POST, after the account was made, makes no account (the step 7 review L5)", async () => {
    const seeded = new Set(db.tables.user.map((u) => u.id));
    let locked: string | null = null;
    db.onCall = async (entry) => {
      // The new account's own lock, taken by the manager's write after the create.
      if (entry.startsWith("tx.lock:") && !seeded.has(entry.slice("tx.lock:".length))) {
        locked = entry.slice("tx.lock:".length);
        throw deadlock();
      }
    };
    const res = await post({ userName: "nia@x.test", name: { givenName: "Nia", familyName: "Ng" }, [EXT]: { manager: { value: "dana" } } });
    expect(res.status).toBe(503);
    expect(locked).not.toBeNull();
    // Made through the transaction (its client logs "tx."), before the deadlock, and rolled back with it.
    const made = db.log.indexOf("tx.user.create");
    expect(made).toBeGreaterThanOrEqual(0);
    expect(made).toBeLessThan(db.log.indexOf(`tx.lock:${locked}`));
    expect(db.log).not.toContain("user.create");
    expect(db.tables.user.find((u) => u.email === "nia@x.test")).toBeUndefined();
  });

  it("a reactivation that runs out of its time is the 503 the provider retries, never a 500, with nothing written (the step 7 review L2)", async () => {
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE" });
    db.onCall = async (entry) => { if (entry === "tx.lock:pat") throw Object.assign(new Error("Transaction already closed: the timeout for this transaction was 10000 ms"), { code: "P2028" }); };
    const res = await patch("pat", [{ op: "replace", path: "active", value: true }, azureSet("dana")]);
    expect(res.status).toBe(503);
    expect(seatOf("pat", "b")).toMatchObject({ status: "INACTIVE", managerId: null });
    expect(rows("reporting_line_changed")).toEqual([]);
  });

  it("a suspended or cancelled workspace takes no manager (403), and a deprovision there drops it", async () => {
    st.inactive = true;
    expect((await patch("pat", [azureSet("dana")])).status).toBe(403);
    expect((await put("lee", { [EXT]: { manager: { value: "bo" } } })).status).toBe(403);
    expect((await patch("lee", [{ op: "replace", path: "active", value: false }, azureSet("bo")])).status).toBe(200);
    expect(account("lee")).toMatchObject({ status: "INACTIVE", managerId: "dana" });
    expect(lineIn("pat", "b")).toBeNull();
  });
});
