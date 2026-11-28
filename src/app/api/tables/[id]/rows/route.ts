// GET    /api/tables/[id]/rows         list rows (keyset chunks; ?cursor=)
// POST   /api/tables/[id]/rows         create a row { values?: Record<string, unknown> }
// PATCH  /api/tables/[id]/rows         patch row { id, values, expect? }, shallow-merge;
//                                      expect makes the merge conditional (409 on drift)
// DELETE /api/tables/[id]/rows         delete by id

import { BAD_JSON, badJson } from "@/lib/http/json-body";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { TABLE_EDIT_REFUSAL, tableRoleFor } from "@/lib/table-gate";
import { roleAtLeast } from "@/lib/access/node-rules";
import { decodeRowCursor, encodeRowCursor, type RowCursor } from "@/lib/table-row-cursor";
import { expectConflicts } from "@/lib/sheet-conflict";

// Phase 32b, gate by parent Space visibility. Returns null when the
// table doesn't exist OR is scoped to a Space the viewer can't read.
async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, organizationId: true, spaceId: true, createdById: true },
  });
  if (!table) return null;
  // The one resolver's table rule (R7): a Space member edits, a Space Full
  // holder manages, an unscoped table is org-wide for Members and a Guest's
  // own only, and a table grant opens it on its own. A Can view role reads
  // only (R7b): every write below asks canEdit.
  const role = await tableRoleFor(table.id, orgId, userId, accessLevel);
  if (!role) return null;
  return { ...table, canEdit: roleAtLeast(role, "EDIT") };
}

// Phase 5a: keyset pagination as STREAMING TRANSPORT only. The client keeps
// fetching chunks until nextCursor is null, so the FULL table is always
// resident before formulas evaluate; the engine is client-side and an
// aggregate over a partial row set would be silently wrong, which is the one
// forbidden failure mode. Server sort is deliberately NOT built.
const ROW_CHUNK_SIZE = 5000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  // Cursor is parsed only after the org/Space gate above, so cursor probing
  // can never learn about tables the viewer cannot already read, and a valid
  // cursor only ever narrows this table's WHERE.
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  let cursor: RowCursor | null = null;
  if (rawCursor !== null) {
    const decoded = decodeRowCursor(rawCursor);
    // The decoder is float-capable by contract, but the live position column
    // is Int: a fractional position cannot have been minted by this server,
    // and letting it reach Prisma's Int filter would throw a 500 instead of
    // this 400.
    // Int bounds too: 2^31 passes isInteger but blows Prisma's Int filter
    // at runtime, the exact 500 this guard exists to prevent.
    if (!decoded || !Number.isInteger(decoded.position) || Math.abs(decoded.position) > 2147483647) {
      return jsonError("invalid cursor", 400);
    }
    cursor = decoded;
  }

  // Keyset WHERE resumes strictly after (position, id) in the same composite
  // order the query sorts by, so chunks never skip or repeat rows.
  // deletedAt: null EVERYWHERE a row is read, a trashed row is invisible to
  // the grid until it is restored.
  const where: Prisma.DataTableRowWhereInput = cursor
    ? {
        tableId: id,
        deletedAt: null,
        OR: [
          { position: { gt: cursor.position } },
          { position: cursor.position, id: { gt: cursor.id } },
        ],
      }
    : { tableId: id, deletedAt: null };

  const [rows, total] = await Promise.all([
    prisma.dataTableRow.findMany({
      where,
      // Tiebreak is id, not createdAt as before: the cursor must encode a
      // column the WHERE can compare without a second fetch, and id is
      // unique where createdAt is not. Positions CAN duplicate across
      // separate inserts (only the batch route rejects intra-request dupes),
      // so the tiebreak is load-bearing; display order changes only for rows
      // that share a position.
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: ROW_CHUNK_SIZE,
    }),
    // total is COUNTed once, on the cursor-less request only, to drive the
    // client's loading progress. It may lag concurrent writes, which is
    // fine: completion is signalled by nextCursor null, never by the count.
    cursor ? Promise.resolve(null) : prisma.dataTableRow.count({ where: { tableId: id, deletedAt: null } }),
  ]);

  // A full chunk MIGHT have more behind it: emit a cursor and let the next
  // round-trip find out. A final chunk that is exactly full costs one extra
  // empty response, which is simpler than take: N+1 lookahead.
  const last = rows.length === ROW_CHUNK_SIZE ? rows[rows.length - 1] : null;
  const nextCursor = last ? encodeRowCursor({ position: last.position, id: last.id }) : null;

  // Contract: total appears ONLY on the cursor-less response; cursored
  // responses are { data, nextCursor }. Existing callers read .data and
  // ignore the rest.
  return jsonSuccess(cursor ? { data: rows, nextCursor } : { data: rows, nextCursor, total });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);
  if (!table.canEdit) return jsonError(TABLE_EDIT_REFUSAL, 403);

  const body = await req.json().catch(() => BAD_JSON);

  if (body === BAD_JSON) return badJson();
  const values = typeof body.values === "object" && body.values !== null ? body.values : {};

  const max = await prisma.dataTableRow.findFirst({
    where: { tableId: id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const row = await prisma.dataTableRow.create({
    data: {
      organizationId: orgId,
      tableId: id,
      values: values as Prisma.InputJsonValue,
      position: (max?.position ?? 0) + 1,
      createdById: userId,
    },
  });
  return jsonSuccess(row, 201);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);
  if (!table.canEdit) return jsonError(TABLE_EDIT_REFUSAL, 403);

  const body = await req.json().catch(() => BAD_JSON);

  if (body === BAD_JSON) return badJson();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const expected =
    typeof body.expect === "object" && body.expect !== null && !Array.isArray(body.expect)
      ? (body.expect as Record<string, unknown>)
      : null;
  const incoming = typeof body.values === "object" && body.values !== null ? body.values : null;

  // The read, the check and the merge run on the LOCKED row (pen test
  // 2026-11-28, V-35): two people editing different cells of one row each
  // merged into the row as they had read it, and the later write put the
  // other's cell back, while both got 200. Now the second waits for the
  // first and merges onto its write.
  // The wait for the lock is bounded like the batch's own transaction (a long
  // paste holds its rows up to 30s), and a write that still cannot get the
  // row answers a retryable 503, never a raw 500 (the step 5 review).
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataTableRow" WHERE id = ${rowId} AND "tableId" = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
      if (locked.length === 0) return { kind: "missing" as const };
      const existing = await tx.dataTableRow.findUnique({ where: { id: rowId }, select: { id: true, values: true } });
      if (!existing) return { kind: "missing" as const };

      // Phase 5c cross-client guard. An optional `expect` map ({ colId:
      // previousStoredValue }) makes this PATCH conditional: it is compared
      // against the row read above, the SAME read the merge below uses. On any
      // mismatch NOTHING is written (not even body.position) and the 409 hands
      // back the row's live values so the losing client absorbs them instead of
      // silently overwriting the other author's cell. No expect = an
      // unconditional merge, which paste/fill/undo rely on: overwriting a range
      // is intentional there. The row lock closes the window between the
      // check and the write.
      if (expected) {
        // ?? {}: this codebase always writes an object, but a legacy/hand-edited
        // row with Json null must degrade to "every cell absent", not a 500.
        const conflictCols = expectConflicts((existing.values ?? {}) as Record<string, unknown>, expected);
        // `existing` was read scoped to THIS table (and the table to this org)
        // above, so `current` can never leak another table's row.
        if (conflictCols.length > 0) return { kind: "conflict" as const, current: existing.values, conflictCols };
      }

      const data: Record<string, unknown> = {};
      if (incoming) {
        const merged = { ...((existing.values ?? {}) as Record<string, unknown>), ...incoming };
        data.values = merged as Prisma.InputJsonValue;
      }
      if (typeof body.position === "number") data.position = body.position;
      return { kind: "updated" as const, row: await tx.dataTableRow.update({ where: { id: rowId }, data }) };
    }, { timeout: 40_000, maxWait: 10_000 });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2028") {
      return NextResponse.json({ error: "row_busy", code: "row_busy", message: "Someone else is saving this row. Try again in a moment." }, { status: 503, headers: { "Retry-After": "2" } });
    }
    throw err;
  }
  if (outcome.kind === "missing") return jsonError("row not found", 404);
  if (outcome.kind === "conflict") return jsonSuccess({ conflict: true, current: outcome.current, conflictCols: outcome.conflictCols }, 409);
  return jsonSuccess(outcome.row);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);
  if (!table.canEdit) return jsonError(TABLE_EDIT_REFUSAL, 403);

  const body = await req.json().catch(() => BAD_JSON);

  if (body === BAD_JSON) return badJson();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const existing = await prisma.dataTableRow.findFirst({ where: { id: rowId, tableId: id, deletedAt: null } });
  if (!existing) return jsonError("row not found", 404);

  // Soft-delete: recoverable from Trash for 60 days (see the trash route).
  await prisma.dataTableRow.update({ where: { id: rowId }, data: { deletedAt: new Date() } });
  return jsonSuccess({ deleted: true });
}
