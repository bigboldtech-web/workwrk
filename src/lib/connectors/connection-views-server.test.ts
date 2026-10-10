// The Connections card's teammates (connection-views-server.ts
// teammateConnectionsView) and what a teammate's row shows per product
// (connection-views.ts teammateProductRows). Review of step 5: a teammate
// was listed only for the products on now, so one holding only Gmail tools
// while Gmail was off was left out, and the card told the person none of
// their teammates had Google tools beside one that did.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: vi.fn(async () => null) }));
vi.mock("@/lib/app-gate", () => ({
  requireApp: vi.fn(async () => null),
  isOwnerOrAdmin: (v: { orgRole: string }) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: vi.fn(async () => null) }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));

import { cdb, resetConnectorDb, seedConnection, type Row } from "./connector-test-db";
import { teammateProductRows } from "./connection-views";
import { teammateConnectionsView } from "./connection-views-server";

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

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "f".repeat(64);
  resetConnectorDb();
  seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", products: ["gmail", "calendar"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Connections card's teammates (review of step 5)", () => {
  it("lists a teammate by the Google tools it holds, a product the workspace turned off included, and says it is off", async () => {
    cdb.policy.set("org1", ["calendar"]);
    seedAgent({ slug: "inbox", name: "Inbox helper", visibility: "PRIVATE", ownerId: "u-max", toolNames: ["search_email", "read_email"] });
    seedAgent({ slug: "notes", name: "Notes", visibility: "PRIVATE", ownerId: "u-max", toolNames: ["search_tasks"] });
    const view = await teammateConnectionsView(MAX as never);
    expect(view.products).toEqual({ gmail: "off", calendar: "on" });
    // Before: no teammate, and the card said "None of your teammates has Google tools yet."
    expect(view.teammates.map((t) => t.slug)).toEqual(["inbox"]);
    expect(view.teammates[0]).toMatchObject({ own: true, tools: { gmail: true, calendar: false } });
    // Its row says Gmail is off, with nothing to switch.
    expect(teammateProductRows(view.teammates[0], ["calendar"], ["gmail", "calendar"])).toEqual([{ product: "gmail", off: true, showSwitch: false, needsAdd: false }]);
  });

  it("keeps an allow of a product turned off switchable, so the person can always turn it off (Decision 27)", async () => {
    cdb.policy.set("org1", ["calendar"]);
    const ops = seedAgent({ slug: "ops" });
    cdb.settings.push({ id: "ps1", agentId: ops.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: { name: "x" } } });
    const view = await teammateConnectionsView(MAX as never);
    const row = view.teammates.find((t) => t.slug === "ops");
    expect(row).toMatchObject({ own: false, tools: { gmail: true, calendar: true }, allowed: { gmail: true, calendar: false } });
    expect(row ? teammateProductRows(row, ["calendar"], ["gmail", "calendar"]) : null).toEqual([
      { product: "gmail", off: true, showSwitch: true, needsAdd: false },
      { product: "calendar", off: false, showSwitch: true, needsAdd: false },
    ]);
  });

  it("still lists nobody when no teammate holds a Google tool, and reads no teammate with every product off", async () => {
    cdb.policy.set("org1", ["gmail", "calendar"]);
    seedAgent({ slug: "notes", name: "Notes", visibility: "PRIVATE", ownerId: "u-max", toolNames: ["search_tasks"] });
    expect((await teammateConnectionsView(MAX as never)).teammates).toEqual([]);
    // Every product off: the card shows the workspace's own line in their place.
    cdb.policy.set("org1", []);
    seedAgent({ slug: "inbox", name: "Inbox helper", visibility: "PRIVATE", ownerId: "u-max", toolNames: ["search_email"] });
    expect((await teammateConnectionsView(MAX as never)).teammates).toEqual([]);
  });

  it("asks for Add first only for a product on here that the connection lacks and nothing allows", () => {
    const t = { tools: { gmail: true, calendar: true }, allowed: { gmail: false, calendar: false } };
    expect(teammateProductRows(t, ["gmail", "calendar"], ["calendar"])).toEqual([
      { product: "gmail", off: false, showSwitch: true, needsAdd: true },
      { product: "calendar", off: false, showSwitch: true, needsAdd: false },
    ]);
    // Off is said as off, never as a connection to add.
    expect(teammateProductRows(t, ["calendar"], ["calendar"])[0]).toEqual({ product: "gmail", off: true, showSwitch: false, needsAdd: false });
  });
});
