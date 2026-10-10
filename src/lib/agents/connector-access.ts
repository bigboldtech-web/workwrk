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
// Two facts the calls share live here too (review of step 4): who of some
// addresses are members of this workspace (workspaceMembersAmong), and the
// zone a calendar call reads and writes days and times in (calendarZoneFor).
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { accessV2Tables } from "@/lib/access/flags";
import { isZone } from "@/lib/connectors/free-time";
import { connectorAccess, type ConnectorAgent, type ConnectorRefusal, type LiveConnection } from "@/lib/connectors/connections";
import { PRIMARY_EVENTS, ZONE_READ_PARAMS, calendarUrl, calendarZoneOf } from "@/lib/connectors/google/calendar";
import { googleConfig, type GoogleConfig } from "@/lib/connectors/google/config";
import { googleCall, type GoogleFailure } from "@/lib/connectors/google/http";
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

/** `reason` says which refusal it was, so an approval can tell a connection to mend (the card waits) from one that ends it (review of step 3). */
export type OpenConnector =
  | { ok: true; agent: ConnectorAgent; connection: LiveConnection; cfg: GoogleConfig }
  | { ok: false; error: string; reason: ConnectorRefusal | "teammate_off" };

/**
 * One call's way to the person's Google: the teammate read now, then
 * connectorAccess (Decision 21: the workspace switch, the connection and the
 * person's allow read fresh), or the one sentence that says why not. At an
 * approval the teammate's print is not compared: the person approves the
 * card itself, which says exactly what runs.
 */
export async function openConnector(a: { person: ActingPerson; agentId: string; product: ConnectorProduct; forApproval: boolean }): Promise<OpenConnector> {
  // A deployment that offers no Google reads nothing to say so.
  if (!googleConfig()) return { ok: false, error: CONNECTOR_COPY.notConfigured, reason: "not_configured" };
  const agent = await connectorAgentById(a.person.organizationId, a.agentId);
  if (!agent) return { ok: false, error: CONNECTOR_COPY.teammateOff, reason: "teammate_off" };
  const access = await connectorAccess({ person: a.person, agent, product: a.product, forApproval: a.forApproval });
  if (!access.ok) return { ok: false, error: connectorRefusalSentence(access, agent.name, a.product), reason: access.reason };
  return { ok: true, agent, connection: access.connection, cfg: access.cfg };
}

/**
 * Which of these addresses, lower case, are live members of this workspace:
 * one query. A card counts who is outside the workspace by it
 * (connector-previews.ts outsideCount), and find_free_time reads the
 * free/busy of no one else (Decision 11: members only, never outsiders).
 *
 * A MEMBER, NOT ANY ROW HERE (review of step 4). Not deleted, not INACTIVE,
 * and neither a Guest nor an agent account, at the level held in this
 * workspace, read as the step 2 sweep reads it (connections.ts noAccessWhere,
 * the other half of the same rule): where the person is anchored, their own
 * level, with the stored User.orgRole narrowing a Member to a Guest only
 * while ACCESS_V2_TABLES is on (org-role.ts effectiveOrgRole); through a
 * second membership, that membership's role. Before, a client added as a
 * Guest passed find_free_time's check, and a card that invited one said
 * "Everyone on it is in this workspace."
 *
 * BOUNDED BY THIS WORKSPACE (review round 1 of Phase 3). Two branches, each
 * driven by its own organizationId index, then the lowered addresses: the
 * people anchored here (User by organizationId), and those here through a
 * second membership (OrganizationMembership by organizationId, then their
 * User by id). One WHERE with lower(email) first and an OR between the two
 * could use no index, and scanned every User of the platform for each card.
 */
export async function workspaceMembersAmong(organizationId: string, emails: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return new Set();
  const guestColumnRead = accessV2Tables();
  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT lower(u."email") AS "email" FROM "User" u
     WHERE u."organizationId" = ${organizationId}
       AND lower(u."email") = ANY(${wanted}::text[]) AND u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'
       AND u."accessLevel" <> 'AGENT'
       AND NOT (${guestColumnRead}::boolean AND u."orgRole" IS NOT DISTINCT FROM 'GUEST' AND u."accessLevel" NOT IN ('SUPER_ADMIN', 'COMPANY_ADMIN'))
    UNION
    SELECT lower(u."email") AS "email" FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId"
     WHERE m."organizationId" = ${organizationId} AND m."role" <> 'AGENT'
       AND u."organizationId" <> ${organizationId}
       AND lower(u."email") = ANY(${wanted}::text[]) AND u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'`;
  return new Set(rows.map((r) => String(r.email).toLowerCase()));
}

/** Where the calendar tools read days and times, or why not: Google's own failure, or no zone known at all. */
export type CalendarZone = { ok: true; zone: string } | { ok: false; failure: GoogleFailure; retryAfter?: number } | { ok: false; unknown: true };

/**
 * The zone a calendar tool call reads and writes days and times in (review
 * of step 4): the zone the person chose; else the zone of their own Google
 * Calendar, from one read of its events (asking only for the zone), made
 * once for the call and kept nowhere after it; else none, and the tool asks
 * the person to set one. Never the workspace's zone or UTC on their behalf:
 * the app shows someone who never picked a zone their device's, so "15:00"
 * read in another zone made an event at the wrong hour with no card.
 */
export async function calendarZoneFor(person: Pick<ActingPerson, "timezone" | "savedTimezone">, connection: LiveConnection, cfg: GoogleConfig): Promise<CalendarZone> {
  const saved = person.savedTimezone === undefined ? person.timezone : person.savedTimezone;
  if (saved && isZone(saved)) return { ok: true, zone: saved };
  const r = await googleCall<unknown>(connection, cfg, { method: "GET", url: calendarUrl(cfg.calendarBase, PRIMARY_EVENTS, ZONE_READ_PARAMS), write: false });
  if (!r.ok) return { ok: false, failure: r.failure, ...(r.retryAfter !== undefined ? { retryAfter: r.retryAfter } : {}) };
  const zone = calendarZoneOf(r.data);
  return zone ? { ok: true, zone } : { ok: false, unknown: true };
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
