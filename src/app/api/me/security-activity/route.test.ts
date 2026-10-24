// GET /api/me/security-activity: the person's own security events
// (docs/plans/mcp-server.md 7, step 4 tests "Security activity: an Admin's
// revocation and a system reuse row are listed for the person; others' rows
// are not"). Fails on the code before step 4: the route read only rows the
// person was the actor of, so an AI app an Owner or Admin's change or the
// system disconnected was never listed for them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ userId: "u-max" as string | null }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => (st.userId ? { user: { id: st.userId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { seed, testDb as db } from "@/lib/oauth/oauth-test-db";
import { GET } from "./route";

const at = (min: number) => new Date(Date.UTC(2026, 9, 21, 12, min));
const meta = (o: Record<string, unknown>) => ({ grantId: "gr-1", clientId: "wkc_x", redirectHost: "claude.ai", appName: "claude.ai", ...o });

beforeEach(() => {
  db.reset();
  st.userId = "u-max";
  // Max's own rows.
  seed(db, "activityLog", { id: "a-login", type: "login", actorId: "u-max", description: "Logged in", ipAddress: "10.0.0.1", severity: "info", organizationId: "org-a", createdAt: at(1) });
  seed(db, "activityLog", { id: "a-conn", type: "mcp.app.connected", actorId: "u-max", actingForId: "u-max", description: "Connected an AI app (MCP)", severity: "warning", organizationId: "org-a", metadata: meta({ access: "write", again: false }), createdAt: at(2) });
  // An Owner turned AI apps off: the row's actor is Olivia, for Max.
  seed(db, "activityLog", { id: "a-admin", type: "mcp.app.revoked", actorId: "u-olivia", actingForId: "u-max", description: "An AI app (MCP) was disconnected", severity: "warning", organizationId: "org-a", metadata: meta({ reason: "admin_off" }), createdAt: at(3) });
  // The system caught a key used twice: no actor, for Max.
  seed(db, "activityLog", { id: "a-reuse", type: "mcp.app.reuse_detected", actorId: null, actorType: "system", actorLabel: "WorkwrK", actingForId: "u-max", description: "An AI app (MCP) used one of its keys twice and was disconnected", severity: "critical", organizationId: "org-a", metadata: meta({ kind: "refresh" }), createdAt: at(4) });
  // Max's own Disconnect.
  seed(db, "activityLog", { id: "a-mine", type: "mcp.app.revoked", actorId: "u-max", actingForId: "u-max", description: "An AI app (MCP) was disconnected", severity: "info", organizationId: "org-a", metadata: meta({ reason: "person", appName: "an app on this computer" }), createdAt: at(5) });
  // Other people's rows, and Max's rows that are not security events.
  seed(db, "activityLog", { id: "o-login", type: "login", actorId: "u-mia", description: "Logged in", severity: "info", organizationId: "org-a", createdAt: at(6) });
  seed(db, "activityLog", { id: "o-revoked", type: "mcp.app.revoked", actorId: "u-olivia", actingForId: "u-mia", description: "An AI app (MCP) was disconnected", severity: "warning", organizationId: "org-a", metadata: meta({ reason: "admin_off" }), createdAt: at(7) });
  seed(db, "activityLog", { id: "o-reuse", type: "mcp.app.reuse_detected", actorId: null, actingForId: "u-mia", description: "x", severity: "critical", organizationId: "org-a", metadata: meta({}), createdAt: at(8) });
  seed(db, "activityLog", { id: "o-olivia", type: "mcp.app.connected", actorId: "u-olivia", actingForId: "u-olivia", description: "x", severity: "warning", organizationId: "org-a", metadata: meta({}), createdAt: at(9) });
  seed(db, "activityLog", { id: "m-tool", type: "mcp.tool.create_task", actorId: "u-max", actingForId: "u-max", actorType: "mcp", actorLabel: "claude.ai (MCP)", description: "Created a task through an AI app (MCP)", severity: "info", organizationId: "org-a", metadata: meta({ tool: "create_task" }), createdAt: at(10) });
  seed(db, "activityLog", { id: "m-other", type: "apps.mcp_changed", actorId: "u-max", description: "Turned off AI apps (MCP)", severity: "info", organizationId: "org-a", createdAt: at(11) });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function events(): Promise<Array<Record<string, unknown>>> {
  const r = await GET();
  expect(r.status).toBe(200);
  return (await r.json()).events;
}

describe("the person's security activity", () => {
  it("lists an Admin's revocation and a system reuse row for the person, newest first", async () => {
    const list = await events();
    expect(list.map((e) => e.id)).toEqual(["a-mine", "a-reuse", "a-admin", "a-conn", "a-login"]);
  });

  it("never lists another person's rows, nor the person's rows that are not security events", async () => {
    const ids = (await events()).map((e) => e.id);
    for (const id of ["o-login", "o-revoked", "o-reuse", "o-olivia", "m-tool", "m-other"]) expect(ids).not.toContain(id);
  });

  it("says which app, and for a disconnect why, never answering the row's metadata or who wrote it", async () => {
    const list = await events();
    const line = (id: string) => list.find((e) => e.id === id)?.description;
    expect(line("a-conn")).toBe("Connected claude.ai (MCP)");
    expect(line("a-admin")).toBe("claude.ai (MCP) was disconnected: an Owner or Admin turned off AI apps in the workspace");
    expect(line("a-reuse")).toBe("claude.ai (MCP) was disconnected for safety: one of its keys was used twice");
    expect(line("a-mine")).toBe("Disconnected an app on this computer (MCP)");
    // A row that is not an AI app's keeps its own sentence.
    expect(line("a-login")).toBe("Logged in");
    for (const e of list) for (const k of ["metadata", "actorId", "actingForId"]) expect(Object.keys(e)).not.toContain(k);
    expect(JSON.stringify(list)).not.toContain("wkc_x");
    expect(JSON.stringify(list)).not.toContain("u-olivia");
  });

  // Final review of the MCP server, contract L5: the same app connected again through a new client ends its
  // older connection as the person's own act; the line says so, never "Disconnected" as if they had pressed it.
  // Fails on fcca4075: the line read "Disconnected claude.ai (MCP)".
  it("reads a connection the same app's new one replaced as replaced", async () => {
    seed(db, "activityLog", { id: "a-replaced", type: "mcp.app.revoked", actorId: "u-max", actingForId: "u-max", description: "An AI app (MCP) was disconnected", severity: "info", organizationId: "org-a", metadata: meta({ reason: "person", replacedBy: "gr-2" }), createdAt: at(12) });
    const line = (await events()).find((e) => e.id === "a-replaced")?.description;
    expect(line).toBe("claude.ai (MCP) was disconnected: you connected it again, and the new connection took its place");
  });

  it("answers 401 with no session", async () => {
    st.userId = null;
    expect((await GET()).status).toBe(401);
  });
});
