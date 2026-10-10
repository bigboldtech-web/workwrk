// The server half of the Connections card and the Apps & modules section
// (docs/plans/ai-teammates-phase3.md step 2): reads the person's own
// connection, the teammates whose tools reach Google and what the person
// allowed each, and the workspace's numbers, into the shapes of
// connection-views.ts.
//
// NO AI GATE (Decision 27). A person with AI off, or whose AI teammates may
// not act for them now, still sees their connection and can disconnect it;
// only connecting, and allowing a teammate, need them to be someone a
// teammate can act for.
//
// Server-only: imports prisma.

import type { Viewer } from "@/lib/access/types";
import { isOwnerOrAdmin } from "@/lib/app-gate";
import { hueForAgent } from "@/lib/agents/hues";
import { agentUsableWhere, canUseAgent } from "@/lib/agents/teammate-access";
import { changedFields, othersMayChange, PRINT_FIELDS, teammateShownPrint, type PrintField } from "@/lib/agents/teammate-print";
import { TEAMMATE_SELECT, workspaceModules, type TeammateRecord } from "@/lib/agents/teammate-server";
import { teammateToolNames } from "@/lib/agents/teammate-tools";
import { prisma } from "@/lib/prisma";
import { connectorCounts, workspaceConnectorProducts } from "./connections";
import type { ConnectionView, ConnectorPolicyView, TeammateConnectionsView, TeammateGoogleUse } from "./connection-views";
import { productsOfTools } from "./connection-views";
import { googleConfig } from "./google/config";
import { CONNECTOR_PRODUCTS, parseProducts, productSet, type ConnectorProduct, type ProductSet } from "./products";

/** The teammates read for the card: more than anyone has. */
const TEAMMATES_READ = 500;

const OFF: Record<ConnectorProduct, "on" | "off"> = { gmail: "off", calendar: "off" };

function stateOf(set: ProductSet): Record<ConnectorProduct, "on" | "off"> {
  return { gmail: set.gmail ? "on" : "off", calendar: set.calendar ? "on" : "off" };
}

/** Per allowed product, what changed since the person allowed it (every part when no print was kept). */
function changedSinceAllowed(agent: TeammateRecord, allowed: ProductSet, prints: unknown): Partial<Record<ConnectorProduct, PrintField[]>> {
  const out: Partial<Record<ConnectorProduct, PrintField[]>> = {};
  const kept = prints && typeof prints === "object" && !Array.isArray(prints) ? (prints as Record<string, unknown>) : {};
  for (const p of CONNECTOR_PRODUCTS) {
    if (!allowed[p]) continue;
    const print = kept[p];
    const changed = print && typeof print === "object" ? changedFields(print, agent) : [...PRINT_FIELDS];
    if (changed.length > 0) out[p] = changed;
  }
  return out;
}

/** One teammate's row on the card, for this person. */
export function teammateGoogleUse(
  agent: TeammateRecord,
  viewerId: string,
  tools: readonly string[],
  setting: { connectorProducts: string[]; connectorPrints: unknown } | null,
): TeammateGoogleUse {
  const own = !othersMayChange(agent, viewerId);
  const allowed = own ? productSet([]) : productSet(setting?.connectorProducts);
  return {
    slug: agent.slug,
    name: agent.name,
    hue: hueForAgent({ hue: agent.hue, slug: agent.slug }),
    avatar: agent.avatar,
    own,
    tools: productsOfTools(tools),
    allowed,
    changed: own ? {} : changedSinceAllowed(agent, allowed, setting?.connectorPrints ?? null),
    print: teammateShownPrint(agent),
  };
}

/** The person's own connection, as the card shows it. */
async function connectionView(viewer: Viewer): Promise<ConnectionView | null> {
  const row = await prisma.teammateConnection.findUnique({
    where: { organizationId_userId_provider: { organizationId: viewer.organizationId, userId: viewer.userId, provider: "google" } },
    select: { accountEmail: true, products: true, status: true, connectedAt: true, lastUsedAt: true, lastUsedAgentId: true, needsReconnectAt: true },
  });
  if (!row) return null;
  // The teammate that used it last, named only while the person may still use it.
  let lastUsedBy: string | null = null;
  if (row.lastUsedAgentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: row.lastUsedAgentId, organizationId: viewer.organizationId },
      select: { name: true, organizationId: true, visibility: true, ownerId: true },
    });
    if (agent && canUseAgent(agent, viewer)) lastUsedBy = agent.name;
  }
  return {
    accountEmail: row.accountEmail,
    products: parseProducts(row.products),
    status: row.status === "active" ? "active" : "needs_reconnect",
    connectedAt: row.connectedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    lastUsedBy,
    needsReconnectAt: row.needsReconnectAt ? row.needsReconnectAt.toISOString() : null,
  };
}

/** Every product: a teammate's stored Google tools, whatever the workspace has on now. */
const EVERY_PRODUCT: ProductSet = { gmail: true, calendar: true };

/**
 * The teammates this person may use whose tools reach a Google product, by
 * what each holds, whether or not the product is on now (review of step 5).
 * Counted by "on now", a teammate holding only Gmail tools while Gmail was
 * off read as none, and the card said nobody has Google tools beside a
 * teammate that does; its row says the product is off instead
 * (connection-views.ts teammateProductRows). With every product off the
 * card shows the workspace's own line in their place, so nothing is read.
 */
async function teammatesWithGoogle(viewer: Viewer, connectors: ProductSet): Promise<TeammateGoogleUse[]> {
  if (!connectors.gmail && !connectors.calendar) return [];
  if (viewer.orgRole === "GUEST" || viewer.isAgent) return [];
  const [modules, agents] = await Promise.all([
    workspaceModules(viewer.organizationId),
    prisma.agent.findMany({
      where: { organizationId: viewer.organizationId, status: { not: "ARCHIVED" }, ...agentUsableWhere(viewer.userId) },
      select: TEAMMATE_SELECT,
      orderBy: { name: "asc" },
      take: TEAMMATES_READ,
    }),
  ]);
  const withTools = agents
    .filter((a) => canUseAgent(a, viewer))
    .map((a) => ({ agent: a, tools: teammateToolNames(a, { ...modules, connectors: EVERY_PRODUCT }) }))
    .filter(({ tools }) => {
      const reach = productsOfTools(tools);
      return reach.gmail || reach.calendar;
    });
  if (withTools.length === 0) return [];
  const settings = await prisma.agentPersonSetting.findMany({
    where: { userId: viewer.userId, agentId: { in: withTools.map((w) => w.agent.id) } },
    select: { agentId: true, connectorProducts: true, connectorPrints: true },
  });
  const settingOf = new Map(settings.map((s) => [s.agentId, s]));
  return withTools.map(({ agent, tools }) => teammateGoogleUse(agent, viewer.userId, tools, settingOf.get(agent.id) ?? null));
}

/** GET /api/teammate-connections, for the signed-in person. */
export async function teammateConnectionsView(viewer: Viewer): Promise<TeammateConnectionsView> {
  const cfg = googleConfig();
  const [org, connection, connectors] = await Promise.all([
    prisma.organization.findUnique({ where: { id: viewer.organizationId }, select: { name: true } }),
    connectionView(viewer),
    workspaceConnectorProducts(viewer.organizationId),
  ]);
  const guest = viewer.orgRole === "GUEST" || viewer.isAgent;
  return {
    // A connection is always shown, so it can be removed, even once this
    // WorkwrK stopped offering Google (Decision 27).
    available: cfg !== null || connection !== null,
    workspaceName: org?.name ?? "",
    products: cfg ? stateOf(connectors) : OFF,
    connection,
    teammates: connection && !guest ? await teammatesWithGoogle(viewer, connectors) : [],
    canManagePolicy: isOwnerOrAdmin(viewer),
    guest,
  };
}

/** GET /api/teammate-connections/policy, for Owners and Admins: the switch and the numbers. */
export async function connectorPolicyView(organizationId: string): Promise<ConnectorPolicyView> {
  const cfg = googleConfig();
  const [row, counts] = await Promise.all([
    prisma.teammateConnectorPolicy.findUnique({
      where: { organizationId_provider: { organizationId, provider: "google" } },
      select: { products: true, updatedAt: true },
    }),
    connectorCounts(organizationId),
  ]);
  const offered = productSet(cfg?.products ?? []);
  const stored = productSet(row?.products);
  return {
    // Shown while anyone is connected, so they can be disconnected, even once
    // this WorkwrK stopped offering Google.
    available: cfg !== null || counts.connected > 0,
    offered,
    on: { gmail: stored.gmail && offered.gmail, calendar: stored.calendar && offered.calendar },
    counts,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}
