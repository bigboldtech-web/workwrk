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
vi.mock("@/lib/connectors/google/config", () => ({ googleConfig: () => CFG, googleRedirectUri: () => "https://app.test/cb" }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: vi.fn(async () => st.viewer) }));
vi.mock("@/lib/app-gate", () => ({
  requireApp: vi.fn(async () => st.gate),
  isOwnerOrAdmin: (v: { orgRole: string }) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: vi.fn(async () => st.acting) }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));

import { requireApp } from "@/lib/app-gate";
import { resolveActingPerson } from "@/lib/agents/acting";
import { teammateFieldPrints } from "@/lib/agents/teammate-print";
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

function put(slug: string, body: unknown) {
  return PUT(new Request(`https://app.test/api/teammate-connections/teammates/${slug}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
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

  it("refuses a teammate with no tool of the product, a product off, and no connection, each by its reason", async () => {
    seedAgent({ slug: "ops", toolNames: ["search_tasks", "list_events"] });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", products: ["gmail"] });
    let res = await put("ops", { gmail: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_tool" });
    // Calendar tools, but the connection holds Gmail only.
    res = await put("ops", { calendar: true });
    expect(await res.json()).toMatchObject({ code: "not_connected" });
    cdb.policy.set("org1", ["gmail"]);
    res = await put("ops", { calendar: true });
    expect(await res.json()).toMatchObject({ code: "product_off" });
    expect(cdb.settings).toEqual([]);
  });

  it("refuses turning on for someone a teammate cannot act for (a Guest, AI off)", async () => {
    seedAgent({ slug: "ops" });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max" });
    st.acting = { ok: false, reason: "ai_off" };
    const res = await put("ops", { gmail: true });
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
    const res = await put("ops", { gmail: true });
    expect(res.status).toBe(200);
    const printsThen = teammateFieldPrints(agent as never);
    expect(cdb.settings[0]).toMatchObject({ agentId: "a-ops", userId: "u-max", connectorProducts: ["gmail"], connectorPrints: { gmail: printsThen } });
    expect((await res.json()).teammate).toMatchObject({ allowed: { gmail: true, calendar: false }, changed: {} });

    // Someone changes its instructions, then the person allows Calendar: Gmail keeps the print it was allowed with.
    agent.systemPrompt = "Read everything.";
    const res2 = await put("ops", { calendar: true });
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
});
