// The raw stores behind node-access: AccessGrant rows (tables, canvases,
// forms), the per-doc sharing entries in Organization.settings.docSharing, and
// the workspace's Private rule in Organization.settings.accessModel.
//
// ACCESSGRANT IS READ WITHOUT THE GENERATED CLIENT. The table ships as
// prisma/sql/2026-09-24-access-grants.sql, and between the code landing and
// that file running (or between `prisma generate` and a server restart) a
// `prisma.accessGrant` call would throw. So every read is raw SQL behind a
// to_regclass guard, cached for five minutes while the table is absent
// (the list-links-server.ts precedent), and a 42P01 "relation does not
// exist" on any statement reads as "nobody holds a grant". Writes answer
// grants_unavailable instead of throwing.
//
// DOC SHARING IS READ ONE ENTRY AT A TIME, never the whole map: jsonb_each
// filtered to the doc ids a request needs, so an organization with ten
// thousand shared docs costs a request the entries it asked for. Writes lock
// the Organization row and jsonb_set exactly one entry, so two writers never
// overwrite each other's docs or any other settings key.
//
// Server-only: prisma.

import { randomUUID } from "crypto";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { readPrivateRule, sanitizeDocSharingEntry, type DocSharingFact, type MemberRole, type PrivateRule } from "./node-rules";

type Db = typeof prisma | Prisma.TransactionClient;

export type GrantObjectType = "TABLE" | "WHITEBOARD" | "FORM";

export const OBJECT_TYPE_BY_KIND = { table: "TABLE", canvas: "WHITEBOARD", form: "FORM" } as const satisfies Record<string, GrantObjectType>;
export const KIND_BY_OBJECT_TYPE: Readonly<Record<GrantObjectType, "table" | "canvas" | "form">> = { TABLE: "table", WHITEBOARD: "canvas", FORM: "form" };

export const ACCESS_GRANTS_SQL_FILE = "prisma/sql/2026-09-24-access-grants.sql";

// ── is the table there? ──────────────────────────────────────────────

const RECHECK_MS = 5 * 60 * 1000;
let availability: { value: boolean; at: number } | null = null;

/**
 * True once "AccessGrant" exists; a table that appeared is never re-checked.
 * NEVER call this inside a transaction: while the table is absent it queries
 * the global pool, and a transaction holding its own connection would wait on
 * a second one (list-links-server.ts has the whole story). Ask first, pass
 * the answer in.
 */
export async function accessGrantTableReady(): Promise<boolean> {
  if (availability?.value) return true;
  if (availability && Date.now() - availability.at < RECHECK_MS) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"AccessGrant"')::text AS t`;
    availability = { value: !!rows[0]?.t, at: Date.now() };
  } catch {
    availability = { value: false, at: Date.now() };
  }
  return availability.value;
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  const code = e?.code ?? e?.meta?.code;
  if (code === "42P01") return true;
  return /relation "?AccessGrant"? does not exist|42P01/i.test(e?.message ?? "");
}

async function guarded<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!(await accessGrantTableReady())) return fallback;
  try {
    return await fn();
  } catch (err) {
    if (isMissingTable(err)) {
      availability = { value: false, at: Date.now() };
      return fallback;
    }
    throw err;
  }
}

// ── AccessGrant reads ────────────────────────────────────────────────

export interface ObjectGrantRow {
  objectType: GrantObjectType;
  objectId: string;
  subjectId: string;
  role: MemberRole;
  grantedById: string | null;
  createdAt: Date;
}

/**
 * Every object grant one person holds in an org (path discovery and the
 * favourites), for the three kinds this store answers. Phase 8 stage E widened
 * the table to hold container copies (SPACE, FOLDER, LIST, GOAL, ... written
 * by scripts/access-migrate-container-rows.ts); those are read only through
 * the engine's loader behind ACCESS_V2_TABLES, never here, so the filter keeps
 * every caller of this function seeing exactly the rows it saw before.
 * expiresAt is NOT filtered here: nothing writes it in this release (the
 * Guest expiry switch sits behind Show upcoming features). The first writer
 * of expiresAt must add the "expiresAt IS NULL OR expiresAt > now" predicate
 * to this read and to objectGrants below in the same change (rule 20; only
 * the engine's resolve.ts honours it today).
 */
export async function viewerObjectGrants(organizationId: string, userId: string): Promise<ObjectGrantRow[]> {
  return guarded(
    () => prisma.$queryRaw<ObjectGrantRow[]>`
      SELECT "objectType", "objectId", "subjectId", "role"::text AS "role", "grantedById", "createdAt"
      FROM "AccessGrant"
      WHERE "organizationId" = ${organizationId} AND "subjectType" = 'USER' AND "subjectId" = ${userId}
        AND "objectType" IN ('TABLE', 'WHITEBOARD', 'FORM')`,
    [],
  );
}

/** Grants on these objects, for one person or for everyone. */
export async function objectGrants(
  kind: "table" | "canvas" | "form",
  ids: string[],
  opts: { userId?: string; db?: Db } = {},
): Promise<ObjectGrantRow[]> {
  if (ids.length === 0) return [];
  const type = OBJECT_TYPE_BY_KIND[kind];
  const db = opts.db ?? prisma;
  return guarded(
    () =>
      opts.userId
        ? db.$queryRaw<ObjectGrantRow[]>`
            SELECT "objectType", "objectId", "subjectId", "role"::text AS "role", "grantedById", "createdAt"
            FROM "AccessGrant"
            WHERE "objectType" = ${type} AND "objectId" = ANY(${ids}::text[]) AND "subjectType" = 'USER' AND "subjectId" = ${opts.userId}`
        : db.$queryRaw<ObjectGrantRow[]>`
            SELECT "objectType", "objectId", "subjectId", "role"::text AS "role", "grantedById", "createdAt"
            FROM "AccessGrant"
            WHERE "objectType" = ${type} AND "objectId" = ANY(${ids}::text[]) AND "subjectType" = 'USER'`,
    [],
  );
}

// ── AccessGrant writes (grants.ts only, inside its transaction) ─────

/**
 * Create or change one person's grant. INSERT ... ON CONFLICT on the unique
 * key, so a retried request or a second tab can never make a second row.
 */
export async function upsertObjectGrant(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; kind: "table" | "canvas" | "form"; objectId: string; userId: string; role: MemberRole; grantedById: string },
): Promise<void> {
  const type = OBJECT_TYPE_BY_KIND[args.kind];
  // The instant is a bound Date, never NOW(): the columns are TIMESTAMP(3)
  // without a zone, and NOW() would be stored as the session's wall clock
  // (the doc-lock.ts note).
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "AccessGrant" ("id", "organizationId", "objectType", "objectId", "subjectType", "subjectId", "role", "grantedById", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${args.organizationId}, ${type}, ${args.objectId}, 'USER', ${args.userId}, ${args.role}::"SpaceRole", ${args.grantedById}, ${now}, ${now})
    ON CONFLICT ("objectType", "objectId", "subjectType", "subjectId")
    DO UPDATE SET "role" = EXCLUDED."role", "updatedAt" = EXCLUDED."updatedAt"`;
}

/** Remove one person's grant; the role it held, or "none" when there was no row. */
export async function deleteObjectGrant(
  tx: Prisma.TransactionClient,
  args: { kind: "table" | "canvas" | "form"; objectId: string; userId: string },
): Promise<MemberRole | "none"> {
  const type = OBJECT_TYPE_BY_KIND[args.kind];
  const rows = await tx.$queryRaw<Array<{ role: MemberRole }>>`
    DELETE FROM "AccessGrant"
    WHERE "objectType" = ${type} AND "objectId" = ${args.objectId} AND "subjectType" = 'USER' AND "subjectId" = ${args.userId}
    RETURNING "role"::text AS "role"`;
  return rows[0]?.role ?? "none";
}

/** Delete every grant on objects that are being removed for good (Trash purge). */
export async function deleteGrantsForObjects(tx: Prisma.TransactionClient, kind: "table" | "canvas" | "form", ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const type = OBJECT_TYPE_BY_KIND[kind];
  try {
    await tx.$executeRaw`DELETE FROM "AccessGrant" WHERE "objectType" = ${type} AND "objectId" = ANY(${ids}::text[])`;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

// ── doc sharing (Organization.settings.docSharing) ───────────────────

/** The sharing entries of these docs only, through jsonb_each: never the whole map. */
export async function docSharingEntries(organizationId: string, docIds: string[], db: Db = prisma): Promise<Map<string, DocSharingFact>> {
  const out = new Map<string, DocSharingFact>();
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ key: string; value: unknown }>>`
    SELECT e.key, e.value
    FROM "Organization" o,
      jsonb_each(CASE WHEN jsonb_typeof(o."settings"->'docSharing') = 'object' THEN o."settings"->'docSharing' ELSE '{}'::jsonb END) e
    WHERE o."id" = ${organizationId} AND e.key = ANY(${ids}::text[])`;
  for (const r of rows) {
    const entry = sanitizeDocSharingEntry(r.value);
    if (entry) out.set(r.key, entry);
  }
  return out;
}

/** Every doc id whose sharing entry lists this person (members or roles). */
export async function listedDocIds(organizationId: string, userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    SELECT e.key
    FROM "Organization" o,
      jsonb_each(CASE WHEN jsonb_typeof(o."settings"->'docSharing') = 'object' THEN o."settings"->'docSharing' ELSE '{}'::jsonb END) e
    WHERE o."id" = ${organizationId}
      AND (
        (jsonb_typeof(e.value->'members') = 'object' AND (e.value->'members'->>${userId}) IS NOT NULL)
        OR (jsonb_typeof(e.value->'roles') = 'object' AND (e.value->'roles'->>${userId}) IS NOT NULL)
      )`;
  return rows.map((r) => r.key);
}

/** SELECT ... FOR UPDATE on the Organization row: serialises every docSharing writer. */
export async function lockOrgSettings(tx: Prisma.TransactionClient, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Write ONE doc's sharing entry, or remove it (entry null), in ONE UPDATE that
 * touches settings.docSharing.<docId> and nothing else: no other doc, no
 * other settings key. settings.docSharing is created when absent.
 */
export async function writeDocSharingEntry(
  tx: Prisma.TransactionClient,
  organizationId: string,
  docId: string,
  entry: DocSharingFact | null,
): Promise<void> {
  if (entry) {
    const json = JSON.stringify(entry);
    await tx.$executeRaw`
      UPDATE "Organization"
      SET "settings" = jsonb_set(
        CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
        '{docSharing}',
        (CASE WHEN jsonb_typeof("settings"->'docSharing') = 'object' THEN "settings"->'docSharing' ELSE '{}'::jsonb END)
          || jsonb_build_object(${docId}::text, ${json}::jsonb),
        true
      )
      WHERE "id" = ${organizationId}`;
  } else {
    await tx.$executeRaw`
      UPDATE "Organization"
      SET "settings" = jsonb_set("settings", '{docSharing}', ("settings"->'docSharing') - ${docId}::text, true)
      WHERE "id" = ${organizationId} AND jsonb_typeof("settings"->'docSharing') = 'object'`;
  }
}

// ── the Private rule ─────────────────────────────────────────────────

export interface AccessModelSetting {
  privateRule: PrivateRule;
  changedAt: string | null;
  changedById: string | null;
}

/** Organization.settings.accessModel; absent means the legacy rule. */
export async function readAccessModel(organizationId: string, db: Db = prisma): Promise<AccessModelSetting> {
  const rows = await db.$queryRaw<Array<{ model: unknown }>>`
    SELECT "settings"->'accessModel' AS model FROM "Organization" WHERE "id" = ${organizationId}`;
  const model = rows[0]?.model;
  const obj = model && typeof model === "object" && !Array.isArray(model) ? (model as Record<string, unknown>) : null;
  return {
    privateRule: readPrivateRule({ accessModel: obj }),
    changedAt: typeof obj?.changedAt === "string" ? obj.changedAt : null,
    changedById: typeof obj?.changedById === "string" ? obj.changedById : null,
  };
}

// ── the legacy cutoff ────────────────────────────────────────────────

const cutoffMemo = new Map<string, number>();

/**
 * Organization.settings.accessLegacyCutoff as epoch ms: the instant this
 * release first decided access in the workspace. Rows written before it keep
 * today's reach under the legacy rule (A8); rows written after it are this
 * release's grants and follow the new rules (A2). It lives in its own key, not
 * in accessModel, because changing the Private rule rewrites accessModel
 * whole and must never move the cutoff.
 *
 * The first read stamps it (one guarded UPDATE that only writes when the key
 * is absent, so two first requests agree on one instant); after that it is
 * read and memoised. Null when it cannot be read or written, which reads
 * every row as existing: today's answer, never a loss.
 */
export async function legacyCutoffOf(organizationId: string): Promise<number | null> {
  const memo = cutoffMemo.get(organizationId);
  if (memo !== undefined) return memo;
  try {
    const read = async () => {
      const rows = await prisma.$queryRaw<Array<{ at: string | null }>>`
        SELECT "settings"->>'accessLegacyCutoff' AS at FROM "Organization" WHERE "id" = ${organizationId}`;
      return rows.length ? rows[0].at : undefined;
    };
    let at = await read();
    if (at === undefined) return null; // no such organization
    if (!at) {
      const stamp = new Date().toISOString();
      await prisma.$executeRaw`
        UPDATE "Organization"
        SET "settings" = jsonb_set(
          CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
          '{accessLegacyCutoff}',
          to_jsonb(${stamp}::text),
          true
        )
        WHERE "id" = ${organizationId}
          AND (jsonb_typeof("settings") IS DISTINCT FROM 'object' OR ("settings"->>'accessLegacyCutoff') IS NULL)`;
      at = await read();
    }
    const ms = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(ms)) return null;
    cutoffMemo.set(organizationId, ms);
    return ms;
  } catch {
    return null;
  }
}
