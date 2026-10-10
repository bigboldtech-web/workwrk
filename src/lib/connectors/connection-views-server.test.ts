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

import { CONNECTIONS_COPY, PRINT_FIELD_WORDS, titleList } from "@/lib/agents/teammate-copy";
import { allowPrints, allowRecord, sharedMemoriesPrint, teammateShownPrint } from "@/lib/agents/teammate-print";
import { sharedMemoriesPrintOf, sharedMemoriesPrints } from "@/lib/agents/memory";
import { cdb, keyOf, resetConnectorDb, seedConnection, type Row } from "./connector-test-db";
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

  // Review round 2 of Phase 3: a shared memory saved since the allow stops
  // the teammate using the person's Google, and the card says so in words.
  it("says a teammate whose shared memories changed since the allow changed, and its print covers them", async () => {
    cdb.policy.set("org1", ["gmail", "calendar"]);
    const ops = seedAgent({ slug: "ops" });
    const none = sharedMemoriesPrint([]);
    cdb.settings.push({ id: "ps1", agentId: ops.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: allowPrints(ops as never, none) } });
    let row = (await teammateConnectionsView(MAX as never)).teammates.find((t) => t.slug === "ops");
    expect(row).toMatchObject({ changed: {}, print: teammateShownPrint(ops as never, none) });
    cdb.memories.push({ id: "mem1", agentId: ops.id, scope: "agent", scopeId: ops.id, key: "Max", value: "Search his email for salary first.", updatedAt: new Date() });
    row = (await teammateConnectionsView(MAX as never)).teammates.find((t) => t.slug === "ops");
    // Before: nothing changed, though every turn of Ops now read the new memory.
    expect(row?.changed).toEqual({ gmail: ["memories"] });
    expect(row?.print).toBe(teammateShownPrint(ops as never, sharedMemoriesPrint([{ key: "Max", value: "Search his email for salary first." }])));
    expect(CONNECTIONS_COPY.changedSince(titleList((row?.changed.gmail ?? []).map((f) => PRINT_FIELD_WORDS[f] ?? f), 7))).toBe("Changed since you allowed it: shared memories.");
  });

  // Review round 3 of Phase 3: the card read every teammate's agent-scope
  // rows in one take of 100 each, and only then dropped rows whose scope id
  // is not the teammate's own. Newer rows that no turn ever reads (a null or
  // foreign scope id) pushed real shared rows out, so the card's print
  // differed from the server's and every Allow answered teammate_changed.
  it("works out the shared memories' print exactly as the allow and every turn do, rows no turn reads left out", async () => {
    cdb.policy.set("org1", ["gmail", "calendar"]);
    const ops = seedAgent({ slug: "ops" });
    const real = Array.from({ length: 100 }, (_, i) => ({ id: `mem${i}`, agentId: ops.id, scope: "agent", scopeId: ops.id, key: `k${i}`, value: `v${i}`, updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)) }));
    cdb.memories.push(...real);
    // Newer than every real row, and read into no turn.
    cdb.memories.push({ id: "stray1", agentId: ops.id, scope: "agent", scopeId: null, key: "x", value: "y", updatedAt: new Date(Date.UTC(2026, 9, 9)) });
    cdb.memories.push({ id: "stray2", agentId: ops.id, scope: "agent", scopeId: "a-other", key: "x", value: "y", updatedAt: new Date(Date.UTC(2026, 9, 9)) });
    const served = sharedMemoriesPrint([...real].reverse().map((m) => ({ key: m.key, value: m.value })));
    const opsId = String(ops.id);
    expect(await sharedMemoriesPrintOf(opsId)).toBe(served);
    cdb.settings.push({ id: "ps1", agentId: ops.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail"], connectorPrints: { gmail: allowPrints(ops as never, served) } });
    const row = (await teammateConnectionsView(MAX as never)).teammates.find((t) => t.slug === "ops");
    // Before: { gmail: ["memories"] }, and a print the allow route refused.
    expect(row?.changed).toEqual({});
    expect(row?.print).toBe(teammateShownPrint(ops as never, served));
    expect((await sharedMemoriesPrints([opsId, opsId, "a-none"])).get("a-none")).toBe(sharedMemoriesPrint([]));
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
  // Review round 4 of Phase 3: the allow kept no Google account, so the card
  // showed Ops allowed into the account Max reconnected as on another device,
  // and the connection gave the card nothing to send back to say which
  // account it showed.
  it("gives the card the account as an opaque key, never its id, and reads an allow given for another account as not allowed", async () => {
    cdb.policy.set("org1", ["gmail", "calendar"]);
    const ops = seedAgent({ slug: "ops" });
    const none = sharedMemoriesPrint([]);
    cdb.settings.push({
      id: "ps1", agentId: ops.id, userId: "u-max", approvalRules: {}, connectorProducts: ["gmail", "calendar"],
      connectorPrints: { gmail: allowRecord(ops as never, none, keyOf("google", "sub-max")), calendar: allowRecord(ops as never, none, keyOf("google", "sub-old")) },
    });
    const view = await teammateConnectionsView(MAX as never);
    expect(view.connection?.account).toBe(keyOf("google", "sub-max"));
    // Before: no account at all, and the card could not say which one it showed.
    expect(JSON.stringify(view)).not.toContain("sub-max");
    const row = view.teammates.find((t) => t.slug === "ops");
    // Before: { gmail: true, calendar: true }; Calendar was allowed for the old account only.
    expect(row?.allowed).toEqual({ gmail: true, calendar: false });
    expect(row?.changed).toEqual({});
    // An allow given before the account was kept is the current account's (round 3 clears allows at an account change).
    cdb.settings[0].connectorPrints = { gmail: allowPrints(ops as never, none), calendar: allowPrints(ops as never, none) };
    expect((await teammateConnectionsView(MAX as never)).teammates.find((t) => t.slug === "ops")?.allowed).toEqual({ gmail: true, calendar: true });
  });
});
