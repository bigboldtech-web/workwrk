// DELETE /api/teammate-connections/google (docs/plans/ai-teammates-phase3.md
// step 2, Decisions 19 and 27): the person's own row only, no AI gate, the
// revoke queued with the delete and tried at once, and never sent for an
// account another live connection holds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ viewer: null as unknown, offered: true }));
const CFG = vi.hoisted(() => ({
  clientId: "agent-client",
  clientSecret: "agent-secret",
  authUrl: "https://g.test/o/oauth2/v2/auth",
  tokenUrl: "https://g.test/token",
  revokeUrl: "https://g.test/revoke",
  gmailBase: "https://g.test/gmail/v1",
  calendarBase: "https://g.test/calendar/v3",
  products: ["gmail", "calendar"],
  standIn: true,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
vi.mock("@/lib/connectors/google/config", () => ({
  googleConfig: () => (st.offered ? CFG : null),
  googleRevokeConfig: () => ({ revokeUrl: CFG.revokeUrl, standIn: true }),
  googleRedirectUri: () => "https://app.test/cb",
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: vi.fn(async () => st.viewer) }));
// No AI gate: the route must never ask for one (Decision 27).
vi.mock("@/lib/app-gate", () => ({ requireApp: vi.fn(async () => { throw new Error("the AI gate was asked"); }) }));

import { cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { sealToken } from "@/lib/connectors/seal";
import { DELETE as DELETE_ROUTE } from "./route";

/** The card's DELETE: it names the workspace the card was read in (review round 1 of Phase 3). */
function DELETE(organizationId: unknown = "org1") {
  return DELETE_ROUTE(new Request("https://app.test/api/teammate-connections/google", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) }));
}

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };

function revokeAnswers(status: number) {
  const fn = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "e".repeat(64);
  resetConnectorDb();
  st.viewer = MAX;
  st.offered = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DELETE /api/teammate-connections/google", () => {
  it("answers 404 not_connected with no connection, and 401 signed out", async () => {
    const res = await DELETE();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_connected" });
    st.viewer = null;
    expect((await DELETE()).status).toBe(401);
  });

  it("removes only the person's own row in this workspace", async () => {
    revokeAnswers(200);
    seedConnection({ organizationId: "org1", userId: "u-lea", accountSub: "sub-lea" });
    seedConnection({ organizationId: "org2", userId: "u-max", accountSub: "sub-max-2" });
    const mine = seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("rt-max") });
    const res = await DELETE();
    expect(await res.json()).toEqual({ disconnected: true, revoked: "now" });
    expect(cdb.connections.map((c) => c.id)).not.toContain(mine.id);
    expect(cdb.connections).toHaveLength(2);
    expect(cdb.revocations).toEqual([]);
    expect(cdb.activity.filter((a) => a.type === "teammate_connection.disconnected")).toHaveLength(1);
  });

  it("leaves the queued revoke for the cron when Google does not confirm, and says queued", async () => {
    const fetch = revokeAnswers(503);
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("rt-max") });
    const res = await DELETE();
    expect(await res.json()).toEqual({ disconnected: true, revoked: "queued" });
    expect(cdb.connections).toEqual([]);
    expect(cdb.revocations).toHaveLength(1);
    expect(cdb.revocations[0]).toMatchObject({ reason: "disconnected" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("queues nothing and tells Google nothing when another workspace's connection holds the account", async () => {
    const fetch = revokeAnswers(200);
    seedConnection({ organizationId: "org2", userId: "u-max", accountSub: "sub-shared" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-shared" });
    const res = await DELETE();
    expect(await res.json()).toEqual({ disconnected: true, revoked: "kept_shared" });
    expect(cdb.revocations).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(cdb.connections.map((c) => c.organizationId)).toEqual(["org2"]);
  });

  // Review of step 2: with GOOGLE_AGENT_PRODUCTS emptied (the feature switched
  // off) the route answered "queued" and never told Google, and nothing drained it.
  it("revokes at Google at once even when this WorkwrK no longer offers Google", async () => {
    st.offered = false;
    const fetch = revokeAnswers(200);
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("rt-max") });
    const res = await DELETE();
    expect(await res.json()).toEqual({ disconnected: true, revoked: "now" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cdb.revocations).toEqual([]);
  });

  // Review round 1 of Phase 3: a card open for workspace X removed the
  // connection of whichever workspace the session had moved to.
  it("removes nothing when the session is in another workspace than the card showed", async () => {
    const fetch = revokeAnswers(200);
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("rt-max") });
    const res = await DELETE("org-x");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "workspace_changed" });
    expect((await DELETE(null)).status).toBe(409);
    expect(cdb.connections).toHaveLength(1);
    expect(cdb.revocations).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    // A caller that names no workspace (a page from before this release) reloads too, and nothing changes.
    const unnamed = await DELETE_ROUTE(new Request("https://app.test/api/teammate-connections/google", { method: "DELETE" }));
    expect(unnamed.status).toBe(409);
    expect(await unnamed.json()).toMatchObject({ code: "workspace_changed" });
    expect(cdb.connections).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Review round 1 of Phase 3: an allow outlived the disconnect, and a
  // reconnect months later let a workspace teammate back into the mail.
  it("clears the person's allows for this workspace's teammates, in the delete's transaction, and no one else's", async () => {
    revokeAnswers(200);
    cdb.agents.push({ id: "a-ops", organizationId: "org1" }, { id: "a-far", organizationId: "org2" });
    cdb.settings.push(
      { id: "ps1", agentId: "a-ops", userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: { name: "x" } } },
      { id: "ps2", agentId: "a-far", userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: { name: "y" } } },
      { id: "ps3", agentId: "a-ops", userId: "u-lea", approvalRules: {}, connectorProducts: ["calendar"], connectorPrints: { calendar: { name: "z" } } },
    );
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("rt-max") });
    expect((await DELETE()).status).toBe(200);
    expect(cdb.settings.map((s) => [s.id, s.connectorProducts, s.connectorPrints])).toEqual([
      ["ps1", [], null],
      ["ps2", ["gmail"], { gmail: { name: "y" } }],
      ["ps3", ["calendar"], { calendar: { name: "z" } }],
    ]);
    expect(cdb.events.find((e) => e.op === "setting.clear")?.inTx).toBe(true);
  });
});
