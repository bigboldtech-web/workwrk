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
import { DELETE } from "./route";

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
});
