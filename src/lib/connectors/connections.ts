// A person's own Google connection for their AI teammates
// (docs/plans/ai-teammates-phase3.md step 2): the workspace switch, who may
// use a connection and why not, saving one at connect, marking one broken,
// ending them (a disconnect, a leaver, a deactivation, a workspace deleted)
// and telling Google, and the cron sweep that catches whatever was missed.
//
// ONE PERSON, ONE WORKSPACE (Decision 5). A connection is read only by the
// acting person's own (organizationId, userId), never by a teammate's owner,
// creator or manager, so nobody's Google ever serves anyone else's turn.
//
// EVERY STATE CHANGE IS ONE STATEMENT OR ONE TRANSACTION THAT CANNOT BE HALF
// DONE. A refresh writes only while the row still has the tokenVersion it
// read, and marking a row broken is the same compare-and-swap, so a slow
// refresh from before a reconnect never breaks the fresh connection, and of
// two ticks that both saw invalid_grant one writes the Inbox row and the
// audit line. A connect locks the person's row (FOR UPDATE) and retries once
// on a unique violation, so two tabs connecting at once leave one row. Ending
// a connection deletes it and queues its revoke in one transaction (Decision
// 19): a crash between the two can never leave WorkwrK listed in someone's
// Google account with no row left to say so.
//
// ONE GOOGLE ACCOUNT, ONE DECISION AT A TIME (review of step 2). Whether an
// account is still held by another live connection, and so whether its grant
// is revoked, is decided under a per-account lock (lockAccounts), taken by
// every path that decides it: a removal after its delete, a connect for the
// new account and the one it replaces, the hard delete, and the queue while
// it tells Google (held until Google answered, since review round 2 of Phase
// 3); since review round 1 of Phase 3 also a connect's grant nothing kept
// (discardConnectGrant), and a connect deletes the revokes queued for its
// account under it. Without it two removals of one account at the same
// moment each saw the other's row and neither queued a revoke, and a revoke
// queued a minute before a reconnect of the same account ended the new grant
// too. A queue row keeps its account only as accountKey (sha256 of provider
// and sub), which names no person.
//
// NOTHING ABOUT THE ACCOUNT IN LOGS OR AUDIT ROWS (Decision 16): audit
// metadata holds ids, products and counts; the address is shown only to the
// person, on their own card.
//
// Server-only: imports prisma.

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { accessV2Tables } from "@/lib/access/flags";
import { logActivity } from "@/lib/activity";
import { CONNECTIONS_COPY } from "@/lib/agents/teammate-copy";
import { sharedMemoriesPrintOf } from "@/lib/agents/memory";
import { ALLOW_PARTS, changedSinceAllowed, othersMayChange, type AllowPart, type PrintedTeammate } from "@/lib/agents/teammate-print";
import type { ActingPerson } from "@/lib/agents/acting";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { googleConfig, googleRevokeConfig, type GoogleConfig, type GoogleRevokeConfig } from "./google/config";
import { revokeToken, type GoogleTokens } from "./google/oauth";
import { CONNECTOR_PRODUCTS, NO_PRODUCTS, parseProducts, productSet, type ConnectorProduct, type ProductSet } from "./products";
import { openToken, sealToken } from "./seal";

/** Where every connection notice and reconnect link goes: the person's own card. */
export const CONNECTIONS_HREF = "/account/connections#ai-google";

/**
 * An Inbox row's link for one workspace's connection (review of step 2). The
 * workspace rides in ?ws=, which the Connections page ignores, so a reconnect
 * marks read that workspace's rows by their link, never by their message: a
 * workspace renamed since, or two workspaces with one name, read the wrong
 * rows.
 */
export function connectionsHref(organizationId: string): string {
  return `/account/connections?ws=${encodeURIComponent(organizationId)}#ai-google`;
}

/**
 * The name a revoke queue row and the per-account lock know a Google account
 * by (review of step 2): sha256 hex of the provider and the account's sub. It
 * names no person. The SQL that writes one (queueWorkspaceRevocations, and
 * the backfill in prisma/sql/2026-10-08-ai-teammates-phase3-revoke-key.sql)
 * works it out the same way: encode(sha256(convert_to(provider || ':' || sub,
 * 'UTF8')), 'hex').
 */
export function accountKey(provider: string, sub: string): string {
  return createHash("sha256").update(`${provider}:${sub}`, "utf8").digest("hex");
}

/**
 * Hold the per-account lock of these accounts until the transaction ends
 * (see ONE GOOGLE ACCOUNT above). In one order everywhere, so two
 * transactions never wait on each other: the order of the lock ids
 * themselves (ORDER BY the hashed id, in the statement, so the database
 * sorts and its volatile lock calls run in that order). Review round 1 of
 * Phase 3: sorting by the account key while locking its 32 bit hash let two
 * keys that share a hash be taken in opposite orders by two transactions,
 * a deadlock in a large deployment. DISTINCT on the id, so two keys that
 * share one are locked once. $executeRaw, never $queryRaw:
 * pg_advisory_xact_lock answers void, which a query cannot read back.
 */
async function lockAccounts(tx: Prisma.TransactionClient, keys: readonly string[]): Promise<void> {
  const wanted = [...new Set(keys)];
  if (wanted.length === 0) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(s.h) FROM (SELECT DISTINCT hashtext('tc-sub:' || k) AS h FROM unnest(${wanted}::text[]) AS k) s ORDER BY s.h`;
}

/**
 * The workspaces whose people a teammate may act for: ACTIVE, and TRIAL
 * (every new self-serve workspace starts there; the rest of the product
 * reads the two as live, reminders.ts LIVE_STATUS). SUSPENDED and CANCELLED
 * are closed: nobody can sign in to them (review round 1 of Phase 3).
 */
const LIVE_WORKSPACE = new Set(["ACTIVE", "TRIAL"]);

/** Whether this workspace is one a teammate may use anyone's Google in now. */
async function workspaceLive(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  return Boolean(org && LIVE_WORKSPACE.has(String(org.status)));
}

/** Who ended a connection, as its audit row names them: a person (the admin who acted), or the system. */
export type RemoveActor = { id: string | null; type: "person" | "system" };

/** The system ending a connection: the sweep, a hook with no person to name. */
export const SYSTEM_ACTOR: RemoveActor = { id: null, type: "system" };

/** The person who acted, or the system when there is none. */
export function actorOf(actorId: string | null): RemoveActor {
  return actorId ? { id: actorId, type: "person" } : SYSTEM_ACTOR;
}

/** A connection as the tools and the refresh read it. */
export interface LiveConnection {
  id: string;
  organizationId: string;
  userId: string;
  provider: "google";
  status: "active" | "needs_reconnect";
  products: ConnectorProduct[];
  accountSub: string;
  accountEmail: string;
  tokenVersion: number;
  accessTokenSealed: unknown;
  accessTokenExpiresAt: Date | null;
  refreshTokenSealed: unknown;
  lastUsedAt: Date | null;
}

/**
 * Why a teammate may not use a product of the person's Google now, each its
 * own reason. workspace_closed: the workspace is suspended or closed (review
 * round 1 of Phase 3).
 */
export type ConnectorRefusal =
  | "not_configured"
  | "workspace_closed"
  | "workspace_off"
  | "not_connected"
  | "needs_reconnect"
  | "not_granted"
  | "not_allowed"
  | "teammate_changed";

/** The teammate a connector call is for: who may change it, and what it is now (its part prints). */
export interface ConnectorAgent {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
  print: PrintedTeammate;
}

export type ConnectorAccess =
  | { ok: true; connection: LiveConnection; cfg: GoogleConfig }
  | { ok: false; reason: ConnectorRefusal; changed?: AllowPart[] };

const LIVE_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  provider: true,
  status: true,
  products: true,
  accountSub: true,
  accountEmail: true,
  tokenVersion: true,
  accessTokenSealed: true,
  accessTokenExpiresAt: true,
  refreshTokenSealed: true,
  lastUsedAt: true,
} as const;

type LiveRow = Prisma.TeammateConnectionGetPayload<{ select: typeof LIVE_SELECT }>;

function liveFrom(row: LiveRow): LiveConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    provider: "google",
    status: row.status === "active" ? "active" : "needs_reconnect",
    products: parseProducts(row.products),
    accountSub: row.accountSub,
    accountEmail: row.accountEmail,
    tokenVersion: row.tokenVersion,
    accessTokenSealed: row.accessTokenSealed,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenSealed: row.refreshTokenSealed,
    lastUsedAt: row.lastUsedAt,
  };
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/** A revocation queue row's id: the same "rv_" the hard delete's SQL writes. */
function revocationId(): string {
  return `rv_${randomBytes(16).toString("hex")}`;
}

// ── The workspace switch ────────────────────────────────────────────

/** What the policy row turned on, within what this deployment offers. */
async function policyProducts(organizationId: string, cfg: GoogleConfig | null): Promise<ProductSet> {
  if (!cfg) return NO_PRODUCTS;
  const row = await prisma.teammateConnectorPolicy.findUnique({
    where: { organizationId_provider: { organizationId, provider: "google" } },
    select: { products: true },
  });
  const on = productSet(row?.products);
  return { gmail: on.gmail && cfg.products.includes("gmail"), calendar: on.calendar && cfg.products.includes("calendar") };
}

/**
 * The products a workspace's teammates may use: what its Owners and Admins
 * turned on (no row: none, Decision 1) and this deployment offers
 * (GOOGLE_AGENT_PRODUCTS, Decision 2). Read fresh on every call (Decision
 * 21): turning a product off stops the next call, not the next turn.
 */
export async function workspaceConnectorProducts(organizationId: string): Promise<ProductSet> {
  return policyProducts(organizationId, googleConfig());
}

/** The person's own connection in this workspace, or null. */
export async function connectionFor(person: Pick<ActingPerson, "organizationId" | "userId">): Promise<LiveConnection | null> {
  const row = await prisma.teammateConnection.findUnique({
    where: { organizationId_userId_provider: { organizationId: person.organizationId, userId: person.userId, provider: "google" } },
    select: LIVE_SELECT,
  });
  return row ? liveFrom(row) : null;
}

function printsOf(raw: unknown, product: ConnectorProduct): unknown {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[product] : undefined;
}

/**
 * Whether this teammate may use this product of the person's Google now, and
 * if not, the one reason why, checked in this order:
 *   1. this deployment offers no Google            not_configured
 *   2. the workspace is suspended or closed        workspace_closed
 *   3. the workspace has the product off           workspace_off
 *   4. the person has no connection here           not_connected
 *   5. it stopped working                          needs_reconnect
 *   6. Google did not grant the product            not_granted
 *   7. a teammate someone else may change (teammate-print.ts othersMayChange)
 *      that the person did not allow              not_allowed
 *      or that changed since they allowed it      teammate_changed
 *      (its part prints or, since review round 2 of Phase 3, its shared
 *      memories; not at an approval: the person approves the card itself)
 * The connection is read by the acting person alone (Decision 5).
 * `setting` when the caller already read the person's AgentPersonSetting.
 * Only the person's workspace and id are read, so the picker's rows ask the
 * very same question for the signed-in person (teammate-server.ts
 * connectorRowStates, step 5).
 *
 * A SUSPENDED WORKSPACE USES NOBODY'S GOOGLE (review round 1 of Phase 3).
 * Its people are signed out and cannot get back in to disconnect, but its
 * routines kept running on their mail. Every call, preparation, approval and
 * turn asks here, so none of them reads or sends anything there; the sweep
 * ends such connections (sweepConnections).
 */
export async function connectorAccess(a: {
  person: Pick<ActingPerson, "organizationId" | "userId">;
  agent: ConnectorAgent;
  product: ConnectorProduct;
  setting?: { connectorProducts: string[]; connectorPrints: unknown } | null;
  forApproval?: boolean;
}): Promise<ConnectorAccess> {
  const cfg = googleConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };
  const [live, on] = await Promise.all([workspaceLive(a.person.organizationId), policyProducts(a.person.organizationId, cfg)]);
  if (!live) return { ok: false, reason: "workspace_closed" };
  if (!on[a.product]) return { ok: false, reason: "workspace_off" };
  const connection = await connectionFor({ organizationId: a.person.organizationId, userId: a.person.userId });
  if (!connection) return { ok: false, reason: "not_connected" };
  if (connection.status !== "active") return { ok: false, reason: "needs_reconnect" };
  if (!connection.products.includes(a.product)) return { ok: false, reason: "not_granted" };
  if (othersMayChange(a.agent, a.person.userId)) {
    const setting =
      a.setting !== undefined
        ? a.setting
        : await prisma.agentPersonSetting.findUnique({
            where: { agentId_userId: { agentId: a.agent.id, userId: a.person.userId } },
            select: { connectorProducts: true, connectorPrints: true },
          });
    if (!setting || !(setting.connectorProducts ?? []).includes(a.product)) return { ok: false, reason: "not_allowed" };
    if (!a.forApproval) {
      const kept = printsOf(setting.connectorPrints, a.product);
      // An allow with no print kept cannot say the teammate is unchanged.
      if (!kept || typeof kept !== "object") return { ok: false, reason: "teammate_changed", changed: [...ALLOW_PARTS] };
      // Its shared memories, read now: every turn of it reads them (memory.ts).
      const changed = changedSinceAllowed(kept, a.agent.print, await sharedMemoriesPrintOf(a.agent.id));
      if (changed.length > 0) return { ok: false, reason: "teammate_changed", changed };
    }
  }
  return { ok: true, connection, cfg };
}

// ── A connection that stopped working ───────────────────────────────

async function workspaceName(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null);
  return org?.name?.trim() || "your workspace";
}

/**
 * Mark the connection broken (Decision 18): one compare-and-swap on the
 * tokenVersion and status it was read with, the access token cleared. Only
 * the swap's winner tells the person (one Inbox row) and writes the audit
 * line, so two refreshes failing at once, or a second chat message, add
 * none, and a reconnect made meanwhile (a newer tokenVersion) is never
 * marked. True when this call made the change.
 */
export async function markNeedsReconnect(conn: Pick<LiveConnection, "id" | "organizationId" | "userId" | "tokenVersion">, reason: "revoked" | "scopes_missing"): Promise<boolean> {
  const changed = await prisma.teammateConnection.updateMany({
    where: { id: conn.id, tokenVersion: conn.tokenVersion, status: "active" },
    data: { status: "needs_reconnect", statusReason: reason, needsReconnectAt: new Date(), accessTokenSealed: Prisma.DbNull },
  });
  if (changed.count !== 1) return false;
  const ws = await workspaceName(conn.organizationId);
  try {
    await prisma.notification.create({
      data: {
        userId: conn.userId,
        type: "agent_connection",
        title: CONNECTIONS_COPY.brokenNoticeTitle,
        message: CONNECTIONS_COPY.brokenNoticeMessage(ws),
        link: connectionsHref(conn.organizationId),
      },
    });
    publishToUser(conn.userId, { type: "notification" });
  } catch (err) {
    console.error(`[connectors] needs_reconnect notice not written: ${errorLine(err)}`);
  }
  await logActivity({
    type: "teammate_connection.needs_reconnect",
    actorId: null,
    actorType: "system",
    actorLabel: "WorkwrK",
    actingForId: conn.userId,
    organizationId: conn.organizationId,
    description: CONNECTIONS_COPY.auditBroken,
    targetId: conn.userId,
    targetType: "user",
    metadata: { provider: "google", connectionId: conn.id, reason },
  });
  return true;
}

/** When the connection was last used, and by which teammate: one write a minute at most. */
export async function touchUsed(connectionId: string, agentId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "TeammateConnection"
       SET "lastUsedAt" = (now() AT TIME ZONE 'UTC'), "lastUsedAgentId" = ${agentId}
     WHERE "id" = ${connectionId}
       AND ("lastUsedAt" IS NULL OR "lastUsedAt" < (now() AT TIME ZONE 'UTC') - interval '1 minute')`;
}

// ── Connecting ──────────────────────────────────────────────────────

export type SaveConnectionResult =
  | { ok: true; id: string; replaced: boolean; reconnect: boolean; queued: string[]; allowsCleared: number }
  | { ok: false; code: "exchange_failed" | "workspace_closed" | "workspace_off" };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * The transactions that take an account's lock and may wait on a revoke
 * holding it (revokeBatch, up to REVOKE_UNDER_LOCK_MS) before they go on
 * (review round 2 of Phase 3): Prisma's default of five seconds would end a
 * connect that waited, and the callback would then let its new grant go.
 * Review round 3 of Phase 3: so do those that may wait behind one of them,
 * the allow route's read of the person's connection FOR SHARE (behind
 * saveOnce's FOR UPDATE, or a removal's delete) and setPolicyProduct's
 * FOR UPDATE of the switch (behind saveOnce's FOR SHARE): a wait of a few
 * seconds failed the click with a transaction-expired 500.
 */
export const LOCK_WAIT_TX_TIMEOUT_MS = 20_000;

async function saveOnce(a: {
  organizationId: string;
  userId: string;
  tokens: GoogleTokens;
  claims: { sub: string; email: string };
  products: ConnectorProduct[];
  scopes: string[];
}): Promise<SaveConnectionResult> {
  return prisma.$transaction(async (tx): Promise<SaveConnectionResult> => {
    // A workspace its Owner deleted, or staff closed, takes no new connection
    // (review of step 2): its connections ended when it was closed, and one
    // made now would hold the person's tokens until the hard delete, 30 days
    // on. Nor does one staff suspended (review round 1 of Phase 3): nobody
    // there can use it or get in to end it. A close that commits after this
    // read is caught by the cron sweep.
    const org = await tx.organization.findUnique({ where: { id: a.organizationId }, select: { status: true } });
    if (!org || !LIVE_WORKSPACE.has(String(org.status))) return { ok: false, code: "workspace_closed" };
    // Every product this connect stores must still be on here (review round 1
    // of Phase 3). The callback read the switch before the code exchange, so
    // an Admin's "Turn off and disconnect everyone" landing in between let
    // the connect store a connection after everyone's had ended. The row is
    // read FOR SHARE: a change of the switch waits for this to commit (and
    // Disconnect everyone, after it, then ends this one too), or this reads
    // the change and stores nothing.
    const policy = await tx.$queryRaw<Array<{ products: string[] }>>`
      SELECT "products" FROM "TeammateConnectorPolicy"
       WHERE "organizationId" = ${a.organizationId} AND "provider" = 'google'
       FOR SHARE`;
    const switched = productSet(policy[0]?.products);
    const offered = googleConfig()?.products ?? [];
    if (a.products.length === 0 || !a.products.every((p) => switched[p] && offered.includes(p))) return { ok: false, code: "workspace_off" };
    // The person's row, locked: a second callback at the same moment waits
    // here, then reads what this one wrote.
    const rows = await tx.$queryRaw<Array<{ id: string; accountSub: string; refreshTokenSealed: unknown }>>`
      SELECT "id", "accountSub", "refreshTokenSealed" FROM "TeammateConnection"
       WHERE "organizationId" = ${a.organizationId} AND "userId" = ${a.userId} AND "provider" = 'google'
       FOR UPDATE`;
    const existing = rows[0] ?? null;
    // The new account and the one it replaces, locked before anything about
    // them is decided: a removal of either account elsewhere waits for this
    // to commit and then sees it, and the queue never revokes the new grant
    // while this connect is still committing.
    const newKey = accountKey("google", a.claims.sub);
    const oldKey = existing ? accountKey("google", existing.accountSub) : null;
    await lockAccounts(tx, oldKey ? [newKey, oldKey] : [newKey]);
    // A revoke queued for this account before now is superseded (review
    // round 1 of Phase 3): it names this grant, and Google revokes a grant
    // per client and account, so sent after this commit it would end the
    // connection this saves. Deleted under the account's lock. The queue
    // sends a keyed revoke only while it holds the same lock, after reading
    // that no live connection holds the account (revokeBatch, review round 2
    // of Phase 3; it used to let the lock go first). So a revoke the queue
    // had begun for this account has had Google's answer, or run out its
    // five seconds, before this goes on; one not begun is deleted here, and
    // the queue then finds the account held and never sends it.
    //
    // WHAT THE LOCK CANNOT HOLD: Google ends the whole grant, tokens issued
    // before the revoke included. A revoke Google carries out after this
    // connect's code exchange (one sent while the person was on Google's
    // consent page, or one that ran out its five seconds here and reached
    // Google anyway) can still end the token saved here; the connection then
    // asks to be reconnected at its next refresh (needs_reconnect).
    await tx.teammateTokenRevocation.deleteMany({ where: { accountKey: newKey } });
    const now = new Date();
    const access = {
      accessTokenSealed: json(sealToken(a.tokens.accessToken)),
      accessTokenExpiresAt: new Date(now.getTime() + a.tokens.expiresIn * 1000),
    };
    const products = CONNECTOR_PRODUCTS.filter((p) => a.products.includes(p));
    if (!existing) {
      // A first connect with no refresh token could never work past the hour.
      if (!a.tokens.refreshToken) return { ok: false, code: "exchange_failed" };
      const row = await tx.teammateConnection.create({
        data: {
          organizationId: a.organizationId,
          userId: a.userId,
          provider: "google",
          status: "active",
          products,
          scopes: a.scopes,
          accountSub: a.claims.sub,
          accountKey: newKey,
          accountEmail: a.claims.email,
          refreshTokenSealed: json(sealToken(a.tokens.refreshToken)),
          ...access,
          tokenVersion: 1,
          connectedAt: now,
        },
        select: { id: true },
      });
      return { ok: true, id: row.id, replaced: false, reconnect: false, queued: [], allowsCleared: 0 };
    }
    const sameAccount = existing.accountSub === a.claims.sub;
    // No refresh token on a re-consent: the stored one is the same grant's,
    // so it is kept; another account's could never be.
    const refreshTokenSealed = a.tokens.refreshToken ? json(sealToken(a.tokens.refreshToken)) : sameAccount ? json(existing.refreshTokenSealed) : null;
    if (!refreshTokenSealed) return { ok: false, code: "exchange_failed" };
    await tx.teammateConnection.update({
      where: { id: existing.id },
      data: {
        products,
        scopes: a.scopes,
        accountSub: a.claims.sub,
        accountKey: newKey,
        accountEmail: a.claims.email,
        refreshTokenSealed,
        ...access,
        status: "active",
        statusReason: null,
        needsReconnectAt: null,
        // Every refresh still running with the old version writes nothing.
        tokenVersion: { increment: 1 },
        connectedAt: now,
      },
    });
    const queued: string[] = [];
    // ANOTHER ACCOUNT ENDS EVERY ALLOW (review round 3 of Phase 3). An allow
    // stores products and prints with no account attached, so an allow Max
    // gave a workspace teammate while connected as max@company.com let it
    // read max@gmail.com once he reconnected as that, on a choice he never
    // made for it. His allows for this workspace's teammates are cleared in
    // this transaction, as a removal clears them (clearAllows), and the card
    // asks for each allow again. The same account keeps them.
    const allowsCleared = sameAccount ? 0 : await clearAllows(tx, [{ organizationId: a.organizationId, userId: a.userId }]);
    // The same account: the same grant, so its old refresh token is never
    // revoked (that would revoke the new one too). Another account: the old
    // one's grant is revoked, unless another live connection (any person,
    // any workspace) still holds that account (Decision 19).
    if (!sameAccount) {
      const shared = await tx.teammateConnection.count({ where: { provider: "google", accountSub: existing.accountSub } });
      if (shared === 0) {
        const id = revocationId();
        await tx.teammateTokenRevocation.create({
          data: { id, provider: "google", tokenSealed: json(existing.refreshTokenSealed), reason: "replaced", accountKey: oldKey },
        });
        queued.push(id);
      }
    }
    return { ok: true, id: existing.id, replaced: !sameAccount, reconnect: sameAccount, queued, allowsCleared };
  }, { timeout: LOCK_WAIT_TX_TIMEOUT_MS });
}

/**
 * Store what Google granted at a connect (the callback route). One
 * transaction, tried twice on a unique violation (two callbacks at once).
 * The same account keeps its row with tokenVersion + 1; another account
 * takes over the row and queues the old account's revoke (`queued`, tried at
 * once by the caller and drained by the cron). After the commit: the
 * person's notices about this connection are read, and the audit line names
 * products and ids only. It throws only when nothing was stored: what runs
 * after the commit is logged, never thrown, so a caller that discards the new
 * grant on a throw never revokes one a stored connection now uses (review of
 * step 2).
 */
export async function saveConnection(a: {
  organizationId: string;
  userId: string;
  tokens: GoogleTokens;
  claims: { sub: string; email: string };
  products: ConnectorProduct[];
  scopes: string[];
}): Promise<SaveConnectionResult> {
  let result: SaveConnectionResult;
  try {
    result = await saveOnce(a);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    result = await saveOnce(a);
  }
  if (!result.ok) return result;

  // The "stopped working" and "disconnected by an Admin" rows for this
  // workspace have nothing left to act on. Matched by the link that names
  // this workspace (connectionsHref), never by the message text.
  const read = await prisma.notification
    .updateMany({
      where: { userId: a.userId, type: "agent_connection", read: false, link: connectionsHref(a.organizationId) },
      data: { read: true },
    })
    .catch(() => null);
  if (read && read.count > 0) publishToUser(a.userId, { type: "notification" });

  try {
    await logActivity({
      type: "teammate_connection.connected",
      actorId: a.userId,
      organizationId: a.organizationId,
      description: CONNECTIONS_COPY.auditConnected,
      targetId: a.userId,
      targetType: "user",
      metadata: { provider: "google", products: a.products, connectionId: result.id, replaced: result.replaced, reconnect: result.reconnect, allowsCleared: result.allowsCleared },
    });
  } catch (err) {
    console.error(`[connectors] connect audit row not written: ${errorLine(err)}`);
  }
  return result;
}

/**
 * A grant a connect made and keeps nothing of (the callback's ways out once
 * Google issued it: no product granted, a save refused, a throw), let go of
 * as every other revoke is (review round 1 of Phase 3). Whether another live
 * connection holds the same Google account is decided under the account's
 * lock (lockAccounts), so a connect of it saving elsewhere at that moment is
 * waited for and seen, never revoked; and the revoke is queued in that
 * transaction, with its accountKey, before it is tried at once, so one Google
 * does not confirm is drained by the cron instead of leaving WorkwrK listed
 * in the person's Google account for good. The token was only ever in
 * memory, so without the queue nothing could try it again. `token`: the
 * refresh token, else the access token (either revokes the grant).
 */
export async function discardConnectGrant(token: string, sub: string): Promise<void> {
  if (!googleRevokeConfig() || !token) return;
  const key = accountKey("google", sub);
  const id = await prisma.$transaction(async (tx) => {
    await lockAccounts(tx, [key]);
    const held = await tx.teammateConnection.count({ where: { provider: "google", accountSub: sub } });
    if (held > 0) return null;
    const queuedId = revocationId();
    // "disconnected": the connect is undone, as a disconnect would undo it
    // (the queue's CHECK names no reason of its own for it, and is not widened).
    await tx.teammateTokenRevocation.create({
      data: { id: queuedId, provider: "google", tokenSealed: json(sealToken(token)), reason: "disconnected", accountKey: key },
    });
    return queuedId;
  }, { timeout: LOCK_WAIT_TX_TIMEOUT_MS });
  if (id) await revokeNow([id]);
}

// ── Ending connections ──────────────────────────────────────────────

/** no_access: the person now holds Guest, or is an agent account, in that workspace (review of step 2). */
export type RemoveReason = "disconnected" | "left" | "deactivated" | "admin_all" | "workspace_deleted" | "no_access" | "sweep";

/** Rows deleted (and their revokes queued) per transaction: a 10,000 person disconnect is twenty short ones. */
const REMOVE_CHUNK = 500;
/** Audit rows and Inbox rows written per statement after the commit. */
const AFTER_BATCH = 500;
/** The most rows one call ends, so no call runs forever (a million connections). */
const REMOVE_MAX = 1_000_000;

type Removed = { id: string; organizationId: string; userId: string };

/** Which Inbox row a removal with `notify` writes: an Owner or Admin ended it, or the workspace was suspended. */
export type RemoveNotice = "admin" | "suspended";

/**
 * End every connection `where` matches. Each chunk is one transaction: the
 * rows deleted (RETURNING their sealed refresh tokens), their people's allows
 * for the workspace's teammates cleared, their accounts locked
 * (lockAccounts), and a revoke queued for every Google account no live row
 * still holds (the transaction sees its own deletes, so only rows that stay
 * are read; and the check runs after the lock, so a removal of the same
 * account committing meanwhile is seen, never both of them deciding the other
 * still holds it). After each commit, the audit
 * rows (one per connection, ids and the reason only) and, with `notify`, one
 * Inbox row per person (`notice` says which), both in batches of 500.
 * `limit` caps how many end (the sweep's per-tick share). `onChunk` hears
 * each chunk's count as it commits, so a caller can record what ended even
 * when a later chunk throws.
 *
 * IT STOPS ONLY WHEN A CHUNK ENDS NOTHING (review round 1 of Phase 3). A
 * chunk's subquery reads its 500 ids once; a row another removal deletes
 * before this one locks it is skipped, so a short chunk does not mean none
 * are left. Stopping at a short chunk ended Disconnect everyone after the
 * first chunk a person's own disconnect touched, with thousands still live.
 *
 * ALLOWS END WITH THE CONNECTION (review round 1 of Phase 3). A person's
 * allows for a workspace teammate (AgentPersonSetting.connectorProducts and
 * connectorPrints) are cleared in the chunk that ends their connection: a
 * reconnect months later, for one private teammate say, must never let a
 * workspace teammate back into their mail on a choice made before.
 */
export async function removeConnections(a: {
  where: Prisma.Sql;
  reason: RemoveReason;
  actor: RemoveActor;
  notify?: boolean;
  notice?: RemoveNotice;
  limit?: number;
  onChunk?: (ended: number) => void;
}): Promise<{ removed: Removed[]; queued: string[] }> {
  const removed: Removed[] = [];
  const queued: string[] = [];
  const max = Math.max(0, Math.min(a.limit ?? REMOVE_MAX, REMOVE_MAX));
  while (removed.length < max) {
    const take = Math.min(REMOVE_CHUNK, max - removed.length);
    const chunk = await prisma.$transaction(
      async (tx) => {
        const gone = await tx.$queryRaw<Array<Removed & { provider: string; accountSub: string; refreshTokenSealed: unknown }>>`
          DELETE FROM "TeammateConnection"
           WHERE "id" IN (SELECT "id" FROM "TeammateConnection" WHERE ${a.where} LIMIT ${take})
          RETURNING "id", "organizationId", "userId", "provider", "accountSub", "refreshTokenSealed"`;
        if (gone.length === 0) return { gone: [] as Removed[], queued: [] as string[], revoking: [] as string[] };
        await clearAllows(tx, gone);
        // After the delete, before the held check (review of step 2).
        await lockAccounts(tx, gone.map((g) => accountKey(g.provider, g.accountSub)));
        const subs = [...new Set(gone.map((g) => g.accountSub))];
        const live = await tx.$queryRaw<Array<{ accountSub: string }>>`
          SELECT DISTINCT "accountSub" FROM "TeammateConnection"
           WHERE "provider" = 'google' AND "accountSub" = ANY(${subs}::text[])`;
        const held = new Set(live.map((l) => l.accountSub));
        // A SUSPENSION'S NOTICE COUNTS ONLY WHAT OUTLIVES IT (review round 3
        // of Phase 3). Two people of one workspace who connected the same
        // Google account (a shared mailbox) can fall in different chunks, or
        // different sweep ticks: the first was told Google still lists
        // WorkwrK, then the second's chunk found nothing live and revoked the
        // grant. A connection this removal will also end (it matches `where`)
        // does not keep the account, so the notice says "being removed" unless
        // a connection outside it holds the account. The revoke itself is still
        // decided by `held`, as above.
        const keeps =
          a.notice === "suspended"
            ? new Set(
                (
                  await tx.$queryRaw<Array<{ accountSub: string }>>`
                    SELECT DISTINCT "accountSub" FROM "TeammateConnection"
                     WHERE "provider" = 'google' AND "accountSub" = ANY(${subs}::text[]) AND NOT (${a.where})`
                ).map((l) => l.accountSub),
              )
            : held;
        const rows = gone
          .filter((g) => !held.has(g.accountSub))
          .map((g) => ({
            id: revocationId(),
            provider: "google",
            tokenSealed: json(g.refreshTokenSealed),
            reason: a.reason,
            accountKey: accountKey(g.provider, g.accountSub),
          }));
        if (rows.length > 0) await tx.teammateTokenRevocation.createMany({ data: rows });
        return {
          gone: gone.map((g) => ({ id: g.id, organizationId: g.organizationId, userId: g.userId })),
          queued: rows.map((r) => r.id),
          // The connections whose Google access is being removed: the rest keep
          // a grant another live connection holds (review round 2 of Phase 3),
          // for a suspension one outside it (see above).
          revoking: gone.filter((g) => !keeps.has(g.accountSub)).map((g) => g.id),
        };
      },
      { timeout: 60_000 },
    );
    // Nothing ended: nothing matches now (see above).
    if (chunk.gone.length === 0) break;
    removed.push(...chunk.gone);
    queued.push(...chunk.queued);
    a.onChunk?.(chunk.gone.length);
    await afterRemoved(chunk.gone, a, new Set(chunk.revoking));
  }
  return { removed, queued };
}

/**
 * The allows of the people whose connections these were, for the teammates
 * of that workspace, cleared (see ALLOWS END WITH THE CONNECTION above), or
 * of a person who reconnected as another Google account (saveOnce). Inside
 * the caller's transaction. Only rows that hold an allow are written; the
 * answer is how many.
 */
async function clearAllows(tx: Prisma.TransactionClient, gone: ReadonlyArray<Pick<Removed, "organizationId" | "userId">>): Promise<number> {
  const pairs = [...new Map(gone.map((g) => [`${g.organizationId}\u0000${g.userId}`, g])).values()];
  if (pairs.length === 0) return 0;
  return tx.$executeRaw`
    UPDATE "AgentPersonSetting" s
       SET "connectorProducts" = ARRAY[]::text[], "connectorPrints" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM "Agent" a, unnest(${pairs.map((p) => p.organizationId)}::text[], ${pairs.map((p) => p.userId)}::text[]) AS g("organizationId", "userId")
     WHERE s."userId" = g."userId" AND a."id" = s."agentId" AND a."organizationId" = g."organizationId"
       AND (cardinality(s."connectorProducts") > 0 OR s."connectorPrints" IS NOT NULL)`;
}

/**
 * The audit rows, and the Inbox rows with `notify`, for connections just
 * ended. `revoking`: the ids whose Google access is being removed (a revoke
 * was queued for their account, or for a suspension will be once it ends the
 * rest of the workspace's, review round 3 of Phase 3); a suspension's notice
 * says so only for those (review round 2 of Phase 3: it said every person's
 * access was removed, also where the account is connected elsewhere in
 * WorkwrK and nothing is revoked).
 */
async function afterRemoved(
  gone: readonly Removed[],
  a: { reason: RemoveReason; actor: RemoveActor; notify?: boolean; notice?: RemoveNotice },
  revoking: ReadonlySet<string>,
): Promise<void> {
  if (gone.length === 0) return;
  const system = a.actor === SYSTEM_ACTOR || !a.actor.id;
  for (let i = 0; i < gone.length; i += AFTER_BATCH) {
    const batch = gone.slice(i, i + AFTER_BATCH);
    try {
      await prisma.activityLog.createMany({
        data: batch.map((r) => ({
          type: "teammate_connection.disconnected",
          actorId: system ? null : a.actor.id,
          organizationId: r.organizationId,
          description: CONNECTIONS_COPY.auditDisconnected,
          targetId: r.userId,
          targetType: "user",
          severity: "info",
          metadata: json({ provider: "google", reason: a.reason, connectionId: r.id }),
          ...(system ? { actorType: "system", actorLabel: "WorkwrK", actingForId: r.userId } : {}),
        })),
      });
    } catch (err) {
      console.error(`[connectors] disconnect audit rows not written (${batch.length}): ${errorLine(err)}`);
    }
  }
  if (!a.notify) return;
  const orgIds = [...new Set(gone.map((r) => r.organizationId))];
  const names = new Map(
    (await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => [])).map((o) => [o.id, o.name]),
  );
  // The same title either way: what ended is the person's connection; the message says why.
  const message = (r: Removed, ws: string): string =>
    a.notice !== "suspended"
      ? CONNECTIONS_COPY.disconnectedByAdminMessage(ws)
      : revoking.has(r.id)
        ? CONNECTIONS_COPY.workspaceSuspendedMessage(ws)
        : CONNECTIONS_COPY.workspaceSuspendedSharedMessage(ws);
  for (let i = 0; i < gone.length; i += AFTER_BATCH) {
    const batch = gone.slice(i, i + AFTER_BATCH);
    try {
      await prisma.notification.createMany({
        data: batch.map((r) => ({
          userId: r.userId,
          type: "agent_connection",
          title: CONNECTIONS_COPY.disconnectedByAdminTitle,
          message: message(r, names.get(r.organizationId)?.trim() || "your workspace"),
          link: connectionsHref(r.organizationId),
        })),
      });
      for (const r of batch) publishToUser(r.userId, { type: "notification" });
    } catch (err) {
      console.error(`[connectors] disconnect notices not written (${batch.length}): ${errorLine(err)}`);
    }
  }
}

/** How long one revoke is given when it is tried at once, inside a person's request. */
const REVOKE_NOW_TIMEOUT_MS = 5_000;
/** How long trying revokes at once may hold a request in all; the rest wait for the cron. */
const REVOKE_NOW_BUDGET_MS = 8_000;

/**
 * Revokes queued a moment ago, tried at once, best effort: what is not
 * revoked waits for the cron. Through the revoke settings alone
 * (googleRevokeConfig), so a deployment that stopped offering Google still
 * tells Google (review of step 2).
 */
async function revokeNow(ids: readonly string[]): Promise<void> {
  const cfg = googleRevokeConfig();
  if (!cfg || ids.length === 0) return;
  await revokeQueued(ids, cfg, { timeoutMs: REVOKE_NOW_TIMEOUT_MS, budgetMs: REVOKE_NOW_BUDGET_MS }).catch((err) => {
    console.error(`[connectors] revoke at once failed: ${errorLine(err)}`);
  });
}

/**
 * The hooks for people leaving or deactivated here (the users route, SCIM
 * deprovisioning, deleting one's own account), or made a Guest or an agent
 * account here (no_access, review of step 2): their connections in this
 * workspace end, as the admin who acted or the system, and Google is told at
 * once where it can be. Returns how many ended.
 */
export async function endConnectionsFor(
  organizationId: string,
  userIds: readonly string[],
  reason: "left" | "deactivated" | "no_access",
  actorId: string | null,
): Promise<number> {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return 0;
  const { removed, queued } = await removeConnections({
    where: Prisma.sql`"organizationId" = ${organizationId} AND "userId" IN (${Prisma.join(ids)})`,
    reason,
    actor: actorOf(actorId),
  });
  await revokeNow(queued);
  return removed.length;
}

/**
 * A person's own account deleted (POST /api/me/delete): their connections in
 * every workspace end, since the account is gone from all of them.
 */
export async function endAllConnectionsOf(userId: string, reason: "left", actorId: string | null): Promise<number> {
  const { removed, queued } = await removeConnections({ where: Prisma.sql`"userId" = ${userId}`, reason, actor: actorOf(actorId) });
  await revokeNow(queued);
  return removed.length;
}

/** The workspace's Owner deleting it, or staff closing it: every connection in it ends. */
export async function endWorkspaceConnections(organizationId: string, reason: "workspace_deleted", actorId: string | null): Promise<number> {
  const { removed, queued } = await removeConnections({
    where: Prisma.sql`"organizationId" = ${organizationId}`,
    reason,
    actor: actorOf(actorId),
  });
  await revokeNow(queued);
  return removed.length;
}

/**
 * Staff suspending a workspace (src/lib/admin/company-patch.ts; review round
 * 1 of Phase 3): nobody can sign in to it, so nobody there could use their
 * connection or disconnect it, and its routines kept reading their mail.
 * Every connection in it ends now, as the system, and Google is told; each
 * person gets the Inbox row that says it ended and why, which they read in
 * any other workspace they belong to. Reason no_access: nobody has access
 * there now (the queue's CHECK names no reason of its own for it, and is not
 * widened). The sweep ends any this misses.
 */
export async function endSuspendedWorkspaceConnections(organizationId: string): Promise<number> {
  const { removed, queued } = await removeConnections({
    where: Prisma.sql`"organizationId" = ${organizationId}`,
    reason: "no_access",
    actor: SYSTEM_ACTOR,
    notify: true,
    notice: "suspended",
  });
  await revokeNow(queued);
  return removed.length;
}

/**
 * The hard delete's own step (org-hard-delete, inside its transaction, before
 * the Organization row goes): a revoke queued for every connection of the
 * workspace whose Google account no other workspace's connection holds. The
 * foreign keys then cascade the connections away; the queue has none, so it
 * outlives them until Google is told.
 *
 * THE ACCOUNTS SHARED WITH ANOTHER WORKSPACE ARE LOCKED FIRST (review of
 * step 2): those are the ones the NOT EXISTS decides, and a removal of the
 * other workspace's row at the same moment would otherwise see this one's,
 * as this one sees that, and neither would queue a revoke. An account no
 * other workspace holds is queued whatever runs meanwhile (a connect of it
 * committing elsewhere is caught when the queue tells Google), so it needs
 * no lock; locking every account of a large workspace would fill the lock
 * table inside the hard delete's one transaction. Taken in the order of the
 * lock ids, as lockAccounts takes them (review round 1 of Phase 3).
 */
export async function queueWorkspaceRevocations(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(s.h)
      FROM (SELECT DISTINCT hashtext('tc-sub:' || encode(sha256(convert_to(c."provider" || ':' || c."accountSub", 'UTF8')), 'hex')) AS h
              FROM "TeammateConnection" c
             WHERE c."organizationId" = ${organizationId}
               AND EXISTS (SELECT 1 FROM "TeammateConnection" o
                            WHERE o."provider" = c."provider" AND o."accountSub" = c."accountSub" AND o."organizationId" <> ${organizationId})) s
     ORDER BY s.h`;
  return tx.$executeRaw`
    INSERT INTO "TeammateTokenRevocation" ("id", "provider", "tokenSealed", "reason", "attempts", "nextAttemptAt", "createdAt", "accountKey")
    SELECT 'rv_' || md5(c."id" || clock_timestamp()::text || random()::text), c."provider", c."refreshTokenSealed", 'workspace_deleted', 0,
           (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'),
           encode(sha256(convert_to(c."provider" || ':' || c."accountSub", 'UTF8')), 'hex')
      FROM "TeammateConnection" c
     WHERE c."organizationId" = ${organizationId}
       AND NOT EXISTS (SELECT 1 FROM "TeammateConnection" o
                        WHERE o."provider" = c."provider" AND o."accountSub" = c."accountSub" AND o."organizationId" <> ${organizationId})`;
}

// ── Telling Google ──────────────────────────────────────────────────

/** Revokes tried at once, side by side, inside a person's request. */
const REVOKE_AT_ONCE = 5;
/**
 * The cron's: each claim takes this many and tries them side by side
 * (review round 1 of Phase 3). Ten at a time keeps Google's load bounded,
 * and one claim's worst case is one revoke's timeout, so the tick's budget
 * still holds; five at a time with 50 a tick took hours to tell Google
 * about a large workspace's Disconnect everyone.
 */
const SWEEP_REVOKE_AT_ONCE = 10;
/** A queued revoke is given up after this many tries, or this long. */
const REVOKE_MAX_ATTEMPTS = 6;
const REVOKE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type QueueRow = { id: string; tokenSealed: unknown; attempts: number; createdAt: Date; accountKey: string | null };

/** What telling Google about some queue rows came to. stillHeld: deleted unsent, a live connection holds the account again. */
export type RevokeCounts = { revoked: number; kept: number; dropped: number; stillHeld: number };

/**
 * How long one revoke may hold its account's lock (review round 2 of Phase
 * 3): the short timeout a revoke tried inside a person's request has, even
 * for the cron's tries, so a reconnect of the account waits a few seconds at
 * most.
 */
const REVOKE_UNDER_LOCK_MS = 5_000;
/**
 * The transaction that holds the lock while Google is told: the revokes run
 * side by side, so one batch holds it about one revoke's timeout, and this
 * leaves room for the lock wait and the deletes around it.
 */
const REVOKE_TX_TIMEOUT_MS = 20_000;

/**
 * One queue row, told to Google with `db` (the locking transaction for a
 * keyed row, else the client): revoked, or already unknown to Google, the row
 * goes; failed, it stays for the next try, unless it was tried
 * REVOKE_MAX_ATTEMPTS times or is older than seven days, when it is dropped
 * and counted. A token no key opens can never be sent, so it is dropped.
 */
async function tellGoogle(
  db: Prisma.TransactionClient,
  row: QueueRow,
  cfg: GoogleRevokeConfig,
  o: { timeoutMs?: number; now: Date },
): Promise<"revoked" | "kept" | "dropped"> {
  let token: string;
  try {
    token = openToken(row.tokenSealed);
  } catch {
    await db.teammateTokenRevocation.deleteMany({ where: { id: row.id } });
    return "dropped";
  }
  const r = await revokeToken(cfg, token, o.timeoutMs);
  if (r === "revoked" || r === "already") {
    await db.teammateTokenRevocation.deleteMany({ where: { id: row.id } });
    return "revoked";
  }
  const tooOld = o.now.getTime() - new Date(row.createdAt).getTime() > REVOKE_MAX_AGE_MS;
  if (row.attempts >= REVOKE_MAX_ATTEMPTS || tooOld) {
    await db.teammateTokenRevocation.deleteMany({ where: { id: row.id } });
    return "dropped";
  }
  return "kept";
}

/**
 * One batch of queue rows, told to Google under their accounts' locks.
 *
 * A ROW WHOSE ACCOUNT A LIVE CONNECTION HOLDS AGAIN (a reconnect made since
 * it was queued) is deleted without telling Google: Google revokes per
 * client and account, so revoking the old token would end the new connection
 * too (review of step 2). Read under the per-account lock, so a connect still
 * committing is waited for and seen.
 *
 * THE REST ARE SENT WHILE THAT LOCK IS STILL HELD (review round 2 of Phase
 * 3), with REVOKE_UNDER_LOCK_MS each, in the same transaction. The check
 * used to commit, letting the lock go, before the revoke was sent: a
 * reconnect of the same account committing in that gap deleted a row already
 * on its way to Google, and Google then ended the new grant. Now a reconnect
 * (saveOnce takes the same lock) waits until Google answered or the time ran
 * out, or runs first and the account reads as held here.
 *
 * A row queued before accounts were kept (accountKey null) has no lock to
 * take and is revoked as before.
 */
async function revokeBatch(
  rows: readonly QueueRow[],
  cfg: GoogleRevokeConfig,
  o: { timeoutMs?: number; now: Date },
): Promise<{ outcomes: Array<"revoked" | "kept" | "dropped">; stillHeld: number }> {
  const hasKey = (r: QueueRow) => typeof r.accountKey === "string" && r.accountKey.length > 0;
  const keyed = rows.filter(hasKey);
  // Rows from before keys first, on their own: few, and soon past their week.
  const loose = await Promise.all(rows.filter((r) => !hasKey(r)).map((row) => tellGoogle(prisma, row, cfg, o)));
  if (keyed.length === 0) return { outcomes: loose, stillHeld: 0 };
  const locked = await prisma.$transaction(
    async (tx) => {
      const keys = [...new Set(keyed.map((r) => r.accountKey as string))];
      await lockAccounts(tx, keys);
      const live = await tx.$queryRaw<Array<{ accountKey: string }>>`
        SELECT DISTINCT "accountKey" FROM "TeammateConnection" WHERE "accountKey" = ANY(${keys}::text[])`;
      const held = new Set(live.map((l) => l.accountKey));
      const drop = keyed.filter((r) => held.has(r.accountKey as string)).map((r) => r.id);
      if (drop.length > 0) await tx.teammateTokenRevocation.deleteMany({ where: { id: { in: drop } } });
      const timeoutMs = Math.min(o.timeoutMs ?? REVOKE_UNDER_LOCK_MS, REVOKE_UNDER_LOCK_MS);
      const sent = await Promise.all(keyed.filter((r) => !held.has(r.accountKey as string)).map((row) => tellGoogle(tx, row, cfg, { timeoutMs, now: o.now })));
      return { outcomes: sent, stillHeld: drop.length };
    },
    { timeout: REVOKE_TX_TIMEOUT_MS },
  );
  return { outcomes: [...loose, ...locked.outcomes], stillHeld: locked.stillHeld };
}

/**
 * Try these queue rows, five at a time, until the deadline, each batch told
 * to Google under its accounts' locks (revokeBatch): a row whose account a
 * live connection holds again goes unsent; revoked, or already unknown to
 * Google, the row goes; failed, it stays for the next try, unless it was
 * tried REVOKE_MAX_ATTEMPTS times or is older than seven days, when it is
 * dropped and counted. A token no key opens can never be sent, so it is
 * dropped and counted.
 */
async function revokeRows(
  rows: readonly QueueRow[],
  cfg: GoogleRevokeConfig,
  o: { deadline: number; timeoutMs?: number; now?: Date; atOnce?: number },
): Promise<RevokeCounts & { tried: number }> {
  let revoked = 0;
  let kept = 0;
  let dropped = 0;
  let stillHeld = 0;
  let tried = 0;
  const now = o.now ?? new Date();
  const atOnce = Math.max(1, o.atOnce ?? REVOKE_AT_ONCE);
  for (let i = 0; i < rows.length; i += atOnce) {
    if (Date.now() >= o.deadline) break;
    const batch = rows.slice(i, i + atOnce);
    tried += batch.length;
    const r = await revokeBatch(batch, cfg, { timeoutMs: o.timeoutMs, now });
    stillHeld += r.stillHeld;
    for (const x of r.outcomes) {
      if (x === "revoked") revoked += 1;
      else if (x === "dropped") dropped += 1;
      else kept += 1;
    }
  }
  return { revoked, kept, dropped, stillHeld, tried };
}

/**
 * Try these queued revokes now (a disconnect, a hook, a connect that replaced
 * an account): what fails stays queued for the cron. `cfg` is the revoke
 * settings (googleRevokeConfig); a full GoogleConfig carries them too.
 */
export async function revokeQueued(ids: readonly string[], cfg: GoogleRevokeConfig, o: { timeoutMs?: number; budgetMs?: number } = {}): Promise<RevokeCounts> {
  const wanted = [...new Set(ids)].slice(0, 1000);
  if (wanted.length === 0) return { revoked: 0, kept: 0, dropped: 0, stillHeld: 0 };
  const rows = await prisma.teammateTokenRevocation.findMany({
    where: { id: { in: wanted } },
    select: { id: true, tokenSealed: true, attempts: true, createdAt: true, accountKey: true },
  });
  const r = await revokeRows(rows, cfg, { deadline: Date.now() + (o.budgetMs ?? 30_000), timeoutMs: o.timeoutMs });
  return { revoked: r.revoked, kept: r.kept + (rows.length - r.tried), dropped: r.dropped, stillHeld: r.stillHeld };
}

/** People deleted, INACTIVE, or no longer in the workspace (anchored elsewhere with no membership here). */
const LEAVERS_WHERE = Prisma.sql`"id" IN (
      SELECT c."id" FROM "TeammateConnection" c JOIN "User" u ON u."id" = c."userId"
       WHERE u."deletedAt" IS NOT NULL OR u."status" = 'INACTIVE'
          OR (u."organizationId" <> c."organizationId"
              AND NOT EXISTS (SELECT 1 FROM "OrganizationMembership" m
                               WHERE m."userId" = c."userId" AND m."organizationId" = c."organizationId")))`;

/**
 * People still here who can no longer connect (Decision 27; review of step
 * 2): an agent account, or a Guest. The level is the one held in that
 * workspace, read as src/lib/access reads it (acting-workspace.ts
 * levelHeldIn): the person's own row where they are anchored, their
 * membership's role elsewhere. A Guest is a Member-level person whose stored
 * User.orgRole says GUEST where they are anchored, read only while
 * ACCESS_V2_TABLES is on, as org-role.ts effectiveOrgRole reads it, so the
 * sweep never ends a connection the rest of the product still lets them make.
 */
function noAccessWhere(guestColumnRead: boolean): Prisma.Sql {
  return Prisma.sql`"id" IN (
      SELECT c."id" FROM "TeammateConnection" c JOIN "User" u ON u."id" = c."userId"
       WHERE u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'
         AND ((u."organizationId" = c."organizationId"
               AND (u."accessLevel" = 'AGENT'
                    OR (${guestColumnRead}::boolean AND u."orgRole" = 'GUEST' AND u."accessLevel" NOT IN ('SUPER_ADMIN', 'COMPANY_ADMIN'))))
           OR (u."organizationId" <> c."organizationId"
               AND EXISTS (SELECT 1 FROM "OrganizationMembership" m
                            WHERE m."userId" = c."userId" AND m."organizationId" = c."organizationId" AND m."role" = 'AGENT'))))`;
}

/**
 * Workspaces their Owner deleted, or staff closed (review of step 2): the
 * close's own hook ends their connections at once, and this ends any it
 * missed (a failed hook, a connect finishing meanwhile) now rather than at
 * the hard delete, 30 days on.
 */
const CLOSED_WHERE = Prisma.sql`"id" IN (
      SELECT c."id" FROM "TeammateConnection" c JOIN "Organization" o ON o."id" = c."organizationId"
       WHERE o."status" = 'CANCELLED')`;

/**
 * Workspaces neither live nor closed: SUSPENDED, and any status added later
 * (review round 1 of Phase 3). Nobody can sign in there, to use a connection
 * or to end it, so it ends, as the suspension's own hook ends them, and each
 * person is told why (endSuspendedWorkspaceConnections).
 */
const SUSPENDED_WHERE = Prisma.sql`"id" IN (
      SELECT c."id" FROM "TeammateConnection" c JOIN "Organization" o ON o."id" = c."organizationId"
       WHERE o."status" NOT IN ('ACTIVE', 'TRIAL', 'CANCELLED'))`;

export type ConnectorSweepCounts = {
  statesExpired: number;
  /** Connections ended because their person left (reason sweep). */
  leavers: number;
  /** Because their person is now a Guest or an agent account there. */
  noAccess: number;
  /** Because their workspace was deleted or closed. */
  closed: number;
  /** Because their workspace was suspended (reason no_access, the person told). */
  suspended: number;
} & RevokeCounts;

/**
 * The cron's step (run-due-agents step 4), each part on its own:
 *   1. connects nobody finished are deleted;
 *   2. connections end, as the system, the hooks may have missed a path
 *      (Decision 20), within one share of `leaversLimit`: a person deleted,
 *      INACTIVE, or no longer in the workspace (reason sweep); a person who
 *      is now a Guest or an agent account there (no_access); a workspace
 *      deleted or closed (workspace_deleted); none of them with a notice; and
 *      a workspace suspended (no_access, each person told why, review round 1
 *      of Phase 3);
 *   3. queued revokes are claimed ten at a time (FOR UPDATE SKIP LOCKED, so
 *      two ticks never take one row twice), each claim counting a try and
 *      moving the next one further out, tried side by side, and claimed again
 *      until `revokeLimit` or the budget runs out.
 * The answer is counts only.
 */
export async function sweepConnections(now: Date, o: { leaversLimit: number; revokeLimit: number; budgetMs: number }): Promise<ConnectorSweepCounts> {
  const deadline = Date.now() + o.budgetMs;
  const statesExpired = await prisma.$executeRaw`DELETE FROM "TeammateOAuthState" WHERE "expiresAt" < (now() AT TIME ZONE 'UTC')`;

  let room = Math.max(0, o.leaversLimit);
  const end = async (where: Prisma.Sql, reason: RemoveReason, notice?: RemoveNotice): Promise<number> => {
    if (room <= 0) return 0;
    const { removed } = await removeConnections({ where, reason, actor: SYSTEM_ACTOR, limit: room, ...(notice ? { notify: true, notice } : {}) });
    room -= removed.length;
    return removed.length;
  };
  const leavers = await end(LEAVERS_WHERE, "sweep");
  const noAccess = await end(noAccessWhere(accessV2Tables()), "no_access");
  const closed = await end(CLOSED_WHERE, "workspace_deleted");
  const suspended = await end(SUSPENDED_WHERE, "no_access", "suspended");

  let revoked = 0;
  let kept = 0;
  let dropped = 0;
  let stillHeld = 0;
  // Through the revoke settings alone (review of step 2): emptying
  // GOOGLE_AGENT_PRODUCTS, or removing the client, still lets the queue drain.
  // Without the sealing key no token can be opened, so the queue waits for
  // it rather than dropping every row as unreadable.
  const cfg = googleRevokeConfig();
  if (cfg) {
    let claimed = 0;
    while (claimed < o.revokeLimit && Date.now() < deadline) {
      const take = Math.min(SWEEP_REVOKE_AT_ONCE, o.revokeLimit - claimed);
      // Each try waits longer for the next: 15 minutes, then 30, an hour, two,
      // four, so six tries cover a Google outage of most of a working day
      // rather than an hour and a quarter.
      const rows = await prisma.$queryRaw<QueueRow[]>`
        UPDATE "TeammateTokenRevocation"
           SET "attempts" = "attempts" + 1,
               "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + LEAST(interval '15 minutes' * power(2, LEAST("attempts", 6)), interval '24 hours')
         WHERE "id" IN (SELECT "id" FROM "TeammateTokenRevocation"
                         WHERE "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
                         ORDER BY "nextAttemptAt"
                         LIMIT ${take}
                         FOR UPDATE SKIP LOCKED)
        RETURNING "id", "tokenSealed", "attempts", "createdAt", "accountKey"`;
      if (rows.length === 0) break;
      claimed += rows.length;
      // Every claimed row is tried (it already counted a try), all at once.
      const r = await revokeRows(rows, cfg, { deadline: Number.POSITIVE_INFINITY, now, atOnce: SWEEP_REVOKE_AT_ONCE });
      revoked += r.revoked;
      kept += r.kept;
      dropped += r.dropped;
      stillHeld += r.stillHeld;
      if (rows.length < take) break;
    }
  }
  return { statesExpired, leavers, noAccess, closed, suspended, revoked, kept, dropped, stillHeld };
}

// ── What Owners and Admins see and set ──────────────────────────────

/** The workspace's connections, as numbers only (Decision 5). */
export async function connectorCounts(organizationId: string): Promise<{ connected: number; gmail: number; calendar: number; needsReconnect: number }> {
  const rows = await prisma.$queryRaw<Array<{ connected: number; gmail: number; calendar: number; needsReconnect: number }>>`
    SELECT count(*)::int AS "connected",
           count(*) FILTER (WHERE 'gmail' = ANY("products"))::int AS "gmail",
           count(*) FILTER (WHERE 'calendar' = ANY("products"))::int AS "calendar",
           count(*) FILTER (WHERE "status" = 'needs_reconnect')::int AS "needsReconnect"
      FROM "TeammateConnection"
     WHERE "organizationId" = ${organizationId} AND "provider" = 'google'`;
  const r = rows[0];
  return { connected: Number(r?.connected ?? 0), gmail: Number(r?.gmail ?? 0), calendar: Number(r?.calendar ?? 0), needsReconnect: Number(r?.needsReconnect ?? 0) };
}

/**
 * The class of the workspace switch's advisory lock: its own key space (the
 * two int form), apart from the per-account locks' (lockAccounts, the one
 * key form), so a hash shared by a workspace and an account can never make
 * the two wait on each other.
 */
const POLICY_LOCK_CLASS = 73_020;

/**
 * Turn one product on or off for the workspace, answering the products as
 * they were just before this write and as it left them. The write is one
 * statement that changes the array where it is (array_append or
 * array_remove), never an array worked out here, so two Admins switching
 * two products at once never lose each other's change.
 *
 * WHAT IT WAS IS READ IN THE SAME TRANSACTION, UNDER A LOCK (review round 1
 * of Phase 3). The route read it once before the write, so another Admin's
 * change landing in between went unaudited: on, B turns it off, A turns it
 * on, and A's request saw on before and on after, so Gmail ended on with
 * the last audit row saying it was turned off. Here a per-workspace lock
 * (taken whether or not the row exists yet) and the row's own FOR UPDATE make
 * every change wait for the one before it, so before and after are exactly
 * this write's.
 */
export async function setPolicyProduct(
  organizationId: string,
  product: ConnectorProduct,
  on: boolean,
  actorId: string,
): Promise<{ before: ConnectorProduct[]; after: ConnectorProduct[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const was = await tx.$queryRaw<Array<{ products: string[] }>>`
      SELECT "products" FROM "TeammateConnectorPolicy"
       WHERE "organizationId" = ${organizationId} AND "provider" = 'google'
       FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ products: string[] }>>`
      INSERT INTO "TeammateConnectorPolicy" ("organizationId", "provider", "products", "updatedById", "createdAt", "updatedAt")
      VALUES (${organizationId}, 'google', CASE WHEN ${on}::boolean THEN ARRAY[${product}::text] ELSE ARRAY[]::text[] END, ${actorId},
              (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("organizationId", "provider") DO UPDATE SET
        "products" = CASE WHEN ${on}::boolean
          THEN (CASE WHEN ${product}::text = ANY("TeammateConnectorPolicy"."products") THEN "TeammateConnectorPolicy"."products"
                     ELSE array_append("TeammateConnectorPolicy"."products", ${product}::text) END)
          ELSE array_remove("TeammateConnectorPolicy"."products", ${product}::text) END,
        "updatedById" = ${actorId},
        "updatedAt" = (now() AT TIME ZONE 'UTC')
      RETURNING "products"`;
    return { before: parseProducts(was[0]?.products ?? []), after: parseProducts(rows[0]?.products ?? []) };
  }, { timeout: LOCK_WAIT_TX_TIMEOUT_MS });
}
