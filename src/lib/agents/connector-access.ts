// Whether a teammate's Google connector call may use the person's own Google
// now, and through which connection (docs/plans/ai-teammates-phase3.md step 3).
//
// READ AT EVERY CALL, NEVER TRUSTED FROM EARLIER IN THE TURN. The teammate
// (who may change it, and its part prints) and the person's connection are
// read for each call: in its preparation, and again in its handler, which is
// also what an approval runs. So a workspace teammate an Admin rewrote
// mid-answer, a connection ended or made again as another Google account, a
// product an Owner turned off, or a teammate paused, stops the very next call
// (Decisions 6 and 21). The connection is the acting person's alone
// (connections.ts connectorAccess reads it by their own organizationId and
// userId), never the teammate's owner's, creator's or manager's.
//
// A turn reads the same answer once, before the model is offered anything
// (connectorTurnAccess), only to decide what it offers and what block 2 says:
// it makes no Google call, and nothing later relies on it.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { connectorAccess, type ConnectorAgent, type ConnectorRefusal, type LiveConnection } from "@/lib/connectors/connections";
import { googleConfig, type GoogleConfig } from "@/lib/connectors/google/config";
import type { ConnectorProduct } from "@/lib/connectors/products";
import type { ActingPerson } from "./acting";
import { connectorRefusalSentence } from "./connector-rules";
import { CONNECTOR_COPY } from "./teammate-copy";
import type { PrintField } from "./teammate-print";

/** The Agent columns a connector decision reads: who may change it, and every part its prints cover. */
export const CONNECTOR_AGENT_SELECT = {
  id: true,
  name: true,
  status: true,
  visibility: true,
  ownerId: true,
  description: true,
  systemPrompt: true,
  toolNames: true,
  approvalRules: true,
  modelOverride: true,
  productSlug: true,
} as const;

/** A teammate row as a connector decision reads it (CONNECTOR_AGENT_SELECT, or a superset such as an approval's). */
export interface ConnectorAgentRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
  description: string | null;
  systemPrompt: string | null;
  toolNames: unknown;
  approvalRules: unknown;
  modelOverride: string | null;
  productSlug: string | null;
}

export function connectorAgentFrom(row: ConnectorAgentRow): ConnectorAgent {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ownerId: row.ownerId,
    print: {
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      toolNames: row.toolNames,
      approvalRules: row.approvalRules,
      modelOverride: row.modelOverride,
      productSlug: row.productSlug,
    },
  };
}

/** The teammate as it is now, in this workspace, while it is on; null when it is paused, removed or gone. */
export async function connectorAgentById(organizationId: string, agentId: string): Promise<ConnectorAgent | null> {
  if (!agentId) return null;
  const row = await prisma.agent.findFirst({ where: { id: agentId, organizationId }, select: CONNECTOR_AGENT_SELECT });
  if (!row || row.status !== "ENABLED") return null;
  return connectorAgentFrom(row);
}

export type OpenConnector = { ok: true; agent: ConnectorAgent; connection: LiveConnection; cfg: GoogleConfig } | { ok: false; error: string };

/**
 * One call's way to the person's Google: the teammate read now, then
 * connectorAccess (Decision 21: the workspace switch, the connection and the
 * person's allow read fresh), or the one sentence that says why not. At an
 * approval the teammate's print is not compared: the person approves the
 * card itself, which says exactly what runs.
 */
export async function openConnector(a: { person: ActingPerson; agentId: string; product: ConnectorProduct; forApproval: boolean }): Promise<OpenConnector> {
  // A deployment that offers no Google reads nothing to say so.
  if (!googleConfig()) return { ok: false, error: CONNECTOR_COPY.notConfigured };
  const agent = await connectorAgentById(a.person.organizationId, a.agentId);
  if (!agent) return { ok: false, error: CONNECTOR_COPY.teammateOff };
  const access = await connectorAccess({ person: a.person, agent, product: a.product, forApproval: a.forApproval });
  if (!access.ok) return { ok: false, error: connectorRefusalSentence(access, agent.name, a.product) };
  return { ok: true, agent, connection: access.connection, cfg: access.cfg };
}

/** Per product a turn's teammate holds tools for: whether it may use it this turn, and if not why. */
export type TurnConnectorAccess = Partial<Record<ConnectorProduct, { ok: true } | { ok: false; reason: ConnectorRefusal; changed?: PrintField[] }>>;

/**
 * What a turn is offered of these products (engine.ts prepareTurn), with the
 * person's AgentPersonSetting the turn already read. No Google call. A
 * deployment that offers no Google answers not_configured without reading
 * anything; a teammate that is gone answers nothing, so nothing is offered.
 */
export async function connectorTurnAccess(a: {
  person: ActingPerson;
  agentId: string;
  products: readonly ConnectorProduct[];
  setting: { connectorProducts: string[]; connectorPrints: unknown } | null;
}): Promise<TurnConnectorAccess> {
  const out: TurnConnectorAccess = {};
  if (a.products.length === 0) return out;
  if (!googleConfig()) {
    for (const p of a.products) out[p] = { ok: false, reason: "not_configured" };
    return out;
  }
  const agent = await connectorAgentById(a.person.organizationId, a.agentId);
  if (!agent) return out;
  for (const p of a.products) {
    const access = await connectorAccess({ person: a.person, agent, product: p, setting: a.setting ?? null });
    out[p] = access.ok ? { ok: true } : { ok: false, reason: access.reason, ...(access.changed ? { changed: access.changed } : {}) };
  }
  return out;
}
