// GET /api/teammate-connections/google/callback (docs/plans/ai-teammates-phase3.md
// step 2): the state is the signed-in person's own, used once, in the
// workspace it began in; Google's refusal stores nothing; a product Google
// did not fully grant is not connected; and a second connect keeps the same
// account's row or queues the replaced account's revoke.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: null as unknown,
  acting: null as unknown,
}));

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
  googleConfig: () => CFG,
  googleRevokeConfig: () => ({ revokeUrl: CFG.revokeUrl, standIn: true }),
  googleRedirectUri: () => "https://app.workwrk.test/api/teammate-connections/google/callback",
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: vi.fn(async () => st.viewer) }));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: vi.fn(async () => st.acting) }));

import { cdb, connectorDb, keyOf, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { createState } from "@/lib/connectors/oauth-state";
import { openToken, sealToken } from "@/lib/connectors/seal";
import { GET } from "./route";

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };
const CAL = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];
const GMAIL = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];

function idToken(sub: string, email: string): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, email })}.`;
}

/** Google's token endpoint and revoke endpoint, as the stand-in answers them. */
function google(o: { scope: string[]; sub?: string; email?: string; revoke?: number; noIdToken?: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url) === CFG.tokenUrl) {
        return Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          scope: ["openid", "email", ...o.scope].join(" "),
          ...(o.noIdToken ? {} : { id_token: idToken(o.sub ?? "sub-max", o.email ?? "max@mail.test") }),
        });
      }
      if (String(url) === CFG.revokeUrl) return new Response(null, { status: o.revoke ?? 200 });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

async function begin(products: Array<"gmail" | "calendar"> = ["gmail", "calendar"]) {
  return (await createState({ organizationId: "org1", userId: "u-max", products, verifier: "verifier-1" })).state;
}

function callback(query: string, cookie: string | null) {
  return GET(
    new NextRequest(`https://app.workwrk.test/api/teammate-connections/google/callback?${query}`, {
      headers: cookie ? { cookie: `wk_tc_state=${cookie}` } : {},
    }),
  );
}

function outcome(res: Response): URLSearchParams {
  return new URL(res.headers.get("location") ?? "https://x").searchParams;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.workwrk.test");
  process.env.SECRETS_ENCRYPTION_KEY = "d".repeat(64);
  resetConnectorDb();
  cdb.policy.set("org1", ["gmail", "calendar"]);
  st.viewer = MAX;
  st.acting = { ok: true, person: { ...MAX } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the state", () => {
  it("refuses a cookie that is not this state, and leaves the state for the person's own flow", async () => {
    const state = await begin();
    const res = await callback(`code=c1&state=${state}`, "someone-elses-state");
    expect(outcome(res).get("ai_error")).toBe("state_invalid");
    // Not consumed: the real flow can still finish, and its cookie stays.
    expect(cdb.states).toHaveLength(1);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an expired state", async () => {
    const state = await begin();
    cdb.states[0].expiresAt = new Date(Date.now() - 1000);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("state_invalid");
  });

  it("is used once: a replayed callback is refused", async () => {
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai")).toBe("connected");
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("state_invalid");
    expect(calls.filter((u) => u === CFG.tokenUrl)).toHaveLength(1);
  });

  it("refuses someone else signed in meanwhile, and another workspace", async () => {
    let state = await begin();
    st.viewer = { ...MAX, userId: "u-mia" };
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("wrong_person");
    state = await begin();
    st.viewer = { ...MAX, organizationId: "org2" };
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("workspace_changed");
    state = await begin();
    st.viewer = null;
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("signed_out");
    expect(cdb.connections).toEqual([]);
  });

  it("stores and audits nothing when the person said no at Google", async () => {
    const calls = google({ scope: CAL });
    const state = await begin();
    const res = await callback(`error=access_denied&state=${state}`, state);
    expect(outcome(res).get("ai_error")).toBe("access_denied");
    expect(cdb.connections).toEqual([]);
    expect(cdb.activity).toEqual([]);
    expect(calls).toEqual([]);
    // The flow is over: its cookie goes.
    expect(res.headers.get("set-cookie")).toMatch(/wk_tc_state=;.*Max-Age=0/i);
  });
});

describe("what is stored", () => {
  it("stores calendar only when Google granted calendar only, and says so", async () => {
    google({ scope: [...CAL, GMAIL[0]] });
    const state = await begin(["gmail", "calendar"]);
    const res = await callback(`code=c1&state=${state}`, state);
    const q = outcome(res);
    expect(q.get("ai")).toBe("connected");
    expect(q.getAll("ai_partial")).toEqual(["gmail"]);
    expect(new URL(res.headers.get("location") ?? "").hash).toBe("#ai-google");
    expect(cdb.connections).toHaveLength(1);
    expect(cdb.connections[0]).toMatchObject({ organizationId: "org1", userId: "u-max", products: ["calendar"], accountSub: "sub-max", tokenVersion: 1 });
    // Sealed, never the token itself.
    expect(JSON.stringify(cdb.connections[0].refreshTokenSealed)).not.toContain("refresh-new");
    expect(openToken(cdb.connections[0].refreshTokenSealed)).toBe("refresh-new");
  });

  it("revokes what Google granted and stores nothing when none of the asked products came back", async () => {
    const calls = google({ scope: [GMAIL[0]] });
    const state = await begin(["gmail"]);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("no_access");
    expect(cdb.connections).toEqual([]);
    expect(calls).toContain(CFG.revokeUrl);
  });

  it("keeps the row of a reconnect with the same account, bumps tokenVersion, and revokes nothing", async () => {
    const row = seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", tokenVersion: 3, refreshTokenSealed: sealToken("refresh-old") });
    const calls = google({ scope: [...GMAIL, ...CAL] });
    const state = await begin();
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai")).toBe("connected");
    expect(cdb.connections).toHaveLength(1);
    expect(cdb.connections[0]).toMatchObject({ id: row.id, tokenVersion: 4, products: ["gmail", "calendar"] });
    expect(calls).not.toContain(CFG.revokeUrl);
    expect(cdb.revocations).toEqual([]);
  });

  it("queues the replaced account's token when another account connects, and tries it at once", async () => {
    const old = sealToken("refresh-old");
    const row = seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-old", refreshTokenSealed: old });
    // Google does not answer the revoke: the queue keeps it for the cron.
    const calls = google({ scope: CAL, sub: "sub-new", email: "other@mail.test", revoke: 503 });
    const state = await begin(["calendar"]);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai")).toBe("connected");
    expect(cdb.connections[0]).toMatchObject({ id: row.id, accountSub: "sub-new", accountEmail: "other@mail.test", tokenVersion: 2 });
    expect(cdb.revocations).toHaveLength(1);
    expect(cdb.revocations[0]).toMatchObject({ reason: "replaced", tokenSealed: old });
    expect(calls.filter((u) => u === CFG.revokeUrl)).toHaveLength(1);
  });

  // Review round 3 of Phase 3: another account ends the person's allows,
  // and the card they land on says why their teammates ask again.
  it("says on the card when another account ended the person's allows, and only then", async () => {
    cdb.agents.push({ id: "a-ops", organizationId: "org1" });
    cdb.settings.push({ id: "ps1", agentId: "a-ops", userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: { name: "x" } } });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", refreshTokenSealed: sealToken("refresh-old") });
    google({ scope: GMAIL });
    let state = await begin(["gmail"]);
    let q = outcome(await callback(`code=c1&state=${state}`, state));
    expect(q.get("ai")).toBe("connected");
    expect(q.get("ai_allows")).toBeNull();
    expect(cdb.settings[0].connectorProducts).toEqual(["gmail"]);
    google({ scope: GMAIL, sub: "sub-personal", email: "max@personal.test" });
    state = await begin(["gmail"]);
    q = outcome(await callback(`code=c2&state=${state}`, state));
    expect(q.get("ai")).toBe("connected");
    expect(q.get("ai_allows")).toBe("cleared");
    expect(cdb.settings[0].connectorProducts).toEqual([]);
  });

  it("writes an audit line with products and ids, never the account", async () => {
    google({ scope: CAL, email: "private@mail.test" });
    const state = await begin(["calendar"]);
    await callback(`code=c1&state=${state}`, state);
    const line = cdb.activity.find((a) => a.type === "teammate_connection.connected");
    expect(line).toBeTruthy();
    expect(JSON.stringify(line)).not.toContain("private@mail.test");
    expect(JSON.stringify(line)).not.toContain("sub-max");
  });
});

// Review of step 2: after a successful exchange, two exits left the new grant
// at Google and one answered a raw 500 with the cookie still set.
describe("after the code exchange", () => {
  it("answers exchange_failed, clearing the cookie, when the database fails, and revokes the new grant", async () => {
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    vi.spyOn(connectorDb, "$transaction").mockRejectedValueOnce(new Error("connection timed out"));
    const res = await callback(`code=c1&state=${state}`, state);
    expect(res.status).toBe(302);
    expect(outcome(res).get("ai_error")).toBe("exchange_failed");
    expect(res.headers.get("set-cookie")).toMatch(/wk_tc_state=;.*Max-Age=0/i);
    expect(cdb.connections).toEqual([]);
    expect(calls).toContain(CFG.revokeUrl);
  });

  it("never revokes a grant another live connection holds, when the save fails", async () => {
    seedConnection({ organizationId: "org2", userId: "u-max", accountSub: "sub-max" });
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    vi.spyOn(connectorDb, "$transaction").mockRejectedValueOnce(new Error("connection timed out"));
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("exchange_failed");
    expect(calls).not.toContain(CFG.revokeUrl);
  });

  it("revokes nothing when Google names no account, since whether it is shared cannot be known", async () => {
    const calls = google({ scope: CAL, noIdToken: true });
    const state = await begin(["calendar"]);
    const res = await callback(`code=c1&state=${state}`, state);
    expect(outcome(res).get("ai_error")).toBe("exchange_failed");
    expect(res.headers.get("set-cookie")).toMatch(/wk_tc_state=;.*Max-Age=0/i);
    expect(calls).not.toContain(CFG.revokeUrl);
    expect(cdb.connections).toEqual([]);
  });

  it("refuses a workspace deleted meanwhile, and revokes the grant it just made", async () => {
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    cdb.closedOrgs.add("org1");
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("workspace_closed");
    expect(cdb.connections).toEqual([]);
    expect(calls).toContain(CFG.revokeUrl);
  });

  // Review round 1 of Phase 3: a suspended workspace took new connections.
  it("refuses a workspace suspended meanwhile, and revokes the grant it just made", async () => {
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    cdb.suspendedOrgs.add("org1");
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("workspace_closed");
    expect(cdb.connections).toEqual([]);
    expect(calls).toContain(CFG.revokeUrl);
  });

  // Review round 1 of Phase 3: the callback read the switch before the code
  // exchange, so a connect finishing after "Turn off and disconnect everyone"
  // stored a connection after everyone's had ended.
  it("stores nothing when the product was turned off after the callback read the switch, and lets the grant go", async () => {
    const calls = google({ scope: CAL });
    const state = await begin(["calendar"]);
    // The callback's read saw Calendar on; an Admin turned it off before the save.
    vi.spyOn(connectorDb.teammateConnectorPolicy, "findUnique").mockResolvedValueOnce({ products: ["calendar"], updatedAt: new Date() } as never);
    cdb.policy.set("org1", []);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("workspace_off");
    expect(cdb.connections).toEqual([]);
    expect(calls).toContain(CFG.revokeUrl);
    // The save read the switch under a share lock, in its own transaction.
    expect(cdb.policyReads).toEqual([{ lock: "share", inTx: true }]);
  });
});

describe("a grant nothing keeps (review round 1 of Phase 3)", () => {
  // Before: revoked once and forgotten; a Google that did not answer left
  // WorkwrK listed in the person's Google account for good.
  it("queues the revoke with its account key when Google does not confirm it, for the cron to drain", async () => {
    const calls = google({ scope: [GMAIL[0]], revoke: 503 });
    const state = await begin(["gmail"]);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("no_access");
    expect(calls.filter((u) => u === CFG.revokeUrl)).toHaveLength(1);
    expect(cdb.revocations).toHaveLength(1);
    expect(cdb.revocations[0]).toMatchObject({ reason: "disconnected", accountKey: keyOf("google", "sub-max") });
    expect(openToken(cdb.revocations[0].tokenSealed)).toBe("refresh-new");
    expect(cdb.events.find((e) => e.op === "revocation.create")?.inTx).toBe(true);
  });

  // Before: whether the account was held elsewhere was a count with no lock,
  // so a connect of it saving elsewhere at that moment could be revoked.
  it("decides whether the account is held elsewhere under the account's lock, before the held check", async () => {
    google({ scope: [GMAIL[0]] });
    const state = await begin(["gmail"]);
    await callback(`code=c1&state=${state}`, state);
    // The decision's own lock, and the queue's again just before it tells Google.
    expect(cdb.locks).toEqual([
      { keys: [keyOf("google", "sub-max")], inTx: true },
      { keys: [keyOf("google", "sub-max")], inTx: true },
    ]);
    // Revoked and gone from the queue once Google confirmed.
    expect(cdb.revocations).toEqual([]);
  });

  it("queues nothing and tells Google nothing when another live connection holds the account", async () => {
    seedConnection({ organizationId: "org2", userId: "u-max", accountSub: "sub-max" });
    const calls = google({ scope: [GMAIL[0]] });
    const state = await begin(["gmail"]);
    expect(outcome(await callback(`code=c1&state=${state}`, state)).get("ai_error")).toBe("no_access");
    expect(calls).not.toContain(CFG.revokeUrl);
    expect(cdb.revocations).toEqual([]);
  });
});
