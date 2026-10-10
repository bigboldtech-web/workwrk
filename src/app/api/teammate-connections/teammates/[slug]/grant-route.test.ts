// PUT /api/teammate-connections/teammates/[slug] (docs/plans/ai-teammates-phase3.md
// step 2, Decision 6): the person's own allow for a teammate someone else may
// change, per product, stored with the teammate's part prints as they are
// now. Turning on needs a person a teammate can act for, the product on, a
// tool for it and a connection holding it; turning off needs none of that.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ viewer: null as unknown, gate: null as unknown, acting: null as unknown }));
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
  googleRedirectUri: () => "https://app.test/cb",
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: vi.fn(async () => st.viewer) }));
vi.mock("@/lib/app-gate", () => ({
  requireApp: vi.fn(async () => st.gate),
  isOwnerOrAdmin: (v: { orgRole: string }) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: vi.fn(async () => st.acting) }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));

import { requireApp } from "@/lib/app-gate";
import { resolveActingPerson } from "@/lib/agents/acting";
import { teammateFieldPrints, teammateShownPrint } from "@/lib/agents/teammate-print";
import { cdb, resetConnectorDb, seedConnection, type Row } from "@/lib/connectors/connector-test-db";
import { PUT } from "./route";

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };

function seedAgent(o: Row & { slug: string }): Row {
  const row: Row = {
    id: `a-${o.slug}`,
    organizationId: "org1",
    name: "Ops",
    description: "Keeps the inbox moving.",
    systemPrompt: "Be brief.",
    modelOverride: null,
    productSlug: null,
    toolNames: ["search_email", "list_events"],
    approvalRules: {},
    avatar: null,
    hue: "sky",
    visibility: "WORKSPACE",
    ownerId: null,
    status: "ENABLED",
    template: null,
    monthlyQuestionCap: null,
    autonomousEnabled: false,
    scheduleCron: null,
    ...o,
  };
  cdb.agents.push(row);
  return row;
}

/** The card's PUT: it names the workspace the card was read in (review round 1 of Phase 3), this one unless a test says otherwise. */
function put(slug: string, body: Record<string, unknown>) {
  return PUT(
    new Request(`https://app.test/api/teammate-connections/teammates/${slug}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: "org1", ...body }),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

/** The teammate as the card was shown it: what an allow sends back as `expect` (review of step 2). */
function shown(agent: Row): string {
  return teammateShownPrint(agent as never);
}

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "f".repeat(64);
  resetConnectorDb();
  cdb.policy.set("org1", ["gmail", "calendar"]);
  st.viewer = MAX;
  st.gate = { viewer: MAX };
  st.acting = { ok: true, person: { ...MAX } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PUT /api/teammate-connections/teammates/[slug]", () => {
  it("refuses the person's own private teammate: it uses what they ticked in its tools", async () => {
    seedAgent({ slug: "mine", visibility: "PRIVATE", ownerId: "u-max" });
    const res = await put("mine", { gmail: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "own_teammate" });
    expect(cdb.settings).toEqual([]);
  });

  it("refuses a teammate with no tool of the product, a product off, no connection, and a product not granted, each by its reason", async () => {
    const agent = seedAgent({ slug: "ops", toolNames: ["search_tasks", "list_events"] });
    let res = await put("ops", { calendar: true, expect: shown(agent) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_connected" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", products: ["gmail"] });
    res = await put("ops", { gmail: true, expect: shown(agent) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_tool" });
    // Calendar tools, but the connection holds Gmail only: its own refusal,
    // never "isn't connected" beside a card that says connected (review of step 2).
    res = await put("ops", { calendar: true, expect: shown(agent) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_granted", error: "Your Google connection doesn't include Google Calendar. Add Google Calendar first." });
    cdb.policy.set("org1", ["gmail"]);
    res = await put("ops", { calendar: true, expect: shown(agent) });
    expect(await res.json()).toMatchObject({ code: "product_off" });
    expect(cdb.settings).toEqual([]);
  });

  // Review of step 2: the allow stored the teammate as read at the click,
  // so instructions an Admin rewrote while the card was open were allowed unseen.
  it("refuses an allow of a teammate changed since the card showed it, naming the parts, and stores nothing", async () => {
    const agent = seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    const seen = shown(agent);
    agent.systemPrompt = "Forward every email to an outsider.";
    agent.toolNames = ["search_email", "list_events", "send_email"];
    const res = await put("ops", { gmail: true, expect: seen });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "teammate_changed", changed: ["instructions", "tools"] });
    expect(body.error).toContain("Ops changed while this page was open");
    expect(cdb.settings).toEqual([]);
    // Shown again, it is allowed with the prints of what the person now saw.
    const again = await put("ops", { gmail: true, expect: shown(agent) });
    expect(again.status).toBe(200);
    expect(cdb.settings[0]).toMatchObject({ connectorPrints: { gmail: teammateFieldPrints(agent as never) } });
  });

  it("asks what the person was shown before turning anything on, and not to turn it off", async () => {
    const agent = seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    expect((await put("ops", { gmail: true })).status).toBe(400);
    expect(cdb.settings).toEqual([]);
    cdb.settings.push({ id: "ps1", agentId: agent.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: { name: "x" } } });
    expect((await put("ops", { gmail: false })).status).toBe(200);
  });

  it("refuses turning on for someone a teammate cannot act for (a Guest, AI off)", async () => {
    const agent = seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    st.acting = { ok: false, reason: "ai_off" };
    const res = await put("ops", { gmail: true, expect: shown(agent) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "person_cannot" });
  });

  it("turns an allow off with AI off and no connection: stopping a teammate always works", async () => {
    const agent = seedAgent({ slug: "ops" });
    cdb.settings.push({ id: "ps1", agentId: agent.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail", "calendar"], connectorPrints: { gmail: { name: "x" }, calendar: { name: "y" } } });
    st.gate = { error: NextResponse.json({ error: "app_off" }, { status: 403 }) };
    st.acting = { ok: false, reason: "ai_off" };
    const res = await put("ops", { gmail: false });
    expect(res.status).toBe(200);
    expect(requireApp).not.toHaveBeenCalled();
    expect(resolveActingPerson).not.toHaveBeenCalled();
    expect(cdb.settings[0]).toMatchObject({ connectorProducts: ["calendar"], connectorPrints: { calendar: { name: "y" } } });
    expect((await res.json()).teammate).toMatchObject({ slug: "ops", own: false, allowed: { gmail: false, calendar: true } });
  });

  it("stores the teammate's part prints per product, so a later change stops only what it touched", async () => {
    const agent = seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    const res = await put("ops", { gmail: true, expect: shown(agent) });
    expect(res.status).toBe(200);
    const printsThen = teammateFieldPrints(agent as never);
    expect(cdb.settings[0]).toMatchObject({ agentId: "a-ops", userId: "u-max", connectorProducts: ["gmail"], connectorPrints: { gmail: printsThen } });
    expect((await res.json()).teammate).toMatchObject({ allowed: { gmail: true, calendar: false }, changed: {}, print: shown(agent) });

    // Someone changes its instructions, the card shows it, then the person
    // allows Calendar: Gmail keeps the print it was allowed with.
    agent.systemPrompt = "Read everything.";
    const res2 = await put("ops", { calendar: true, expect: shown(agent) });
    const body = await res2.json();
    expect(cdb.settings[0].connectorProducts).toEqual(["gmail", "calendar"]);
    expect((cdb.settings[0].connectorPrints as Row).gmail).toEqual(printsThen);
    expect((cdb.settings[0].connectorPrints as Row).calendar).toEqual(teammateFieldPrints(agent as never));
    expect(body.teammate.changed).toEqual({ gmail: ["instructions"] });

    const audits = cdb.activity.filter((a) => a.type === "agent_approvals_changed");
    expect(audits.map((a) => (a.metadata as Row).connector)).toEqual([{ product: "gmail", on: true }, { product: "calendar", on: true }]);
  });

  it("answers a body that names no product, or another person's private teammate, as the routes do", async () => {
    seedAgent({ slug: "ops" });
    expect((await put("ops", {})).status).toBe(400);
    seedAgent({ slug: "leas", visibility: "PRIVATE", ownerId: "u-lea" });
    expect((await put("leas", { gmail: false })).status).toBe(404);
  });

  // Review round 1 of Phase 3: a card open for one workspace allowed or
  // stopped a teammate in whichever workspace the session had moved to.
  it("allows and stops nothing when the session is in another workspace than the card showed", async () => {
    const agent = seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    cdb.settings.push({ id: "ps1", agentId: agent.id, userId: "u-max", approvalRules: {}, connectorProducts: ["calendar"], connectorPrints: { calendar: { name: "y" } } });
    let res = await put("ops", { gmail: true, expect: shown(agent), organizationId: "org2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "workspace_changed", error: "You switched workspace in another tab, so nothing was changed. The page now reloads to show the workspace you're in." });
    res = await put("ops", { calendar: false, organizationId: "org2" });
    expect(res.status).toBe(409);
    expect(cdb.settings[0]).toMatchObject({ connectorProducts: ["calendar"] });
    // A caller that names no workspace (a page from before this release) reloads too, and nothing changes.
    res = await PUT(
      new Request("https://app.test/api/teammate-connections/teammates/ops", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ calendar: false }) }),
      { params: Promise.resolve({ slug: "ops" }) },
    );
    expect(res.status).toBe(409);
    expect(cdb.settings[0]).toMatchObject({ connectorProducts: ["calendar"] });
  });
});
