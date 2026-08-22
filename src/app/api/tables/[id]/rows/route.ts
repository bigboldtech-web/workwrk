// GET    /api/tables/[id]/rows         list rows (keyset chunks; ?cursor=)
// POST   /api/tables/[id]/rows         create a row { values?: Record<string, unknown> }
// PATCH  /api/tables/[id]/rows         patch row { id, values } — shallow-merge
// DELETE /api/tables/[id]/rows         delete by id

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";
import { decodeRowCursor, encodeRowCursor, type RowCursor } from "@/lib/table-row-cursor";

// Phase 32b — gate by parent Space visibility. Returns null when the
// table doesn't exist OR is scoped to a Space the viewer can't read.
async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, organizationId: true, spaceId: true },
  });
  if (!table) return null;
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return null;
  }
  return table;
}

// Phase 5a: keyset pagination as STREAMING TRANSPORT only. The client keeps
// fetching chunks until nextCursor is null, so the FULL table is always
// resident before formulas evaluate; the engine is client-side and an
// aggregate over a partial row set would be silently wrong, which is the one
// forbidden failure mode. Server sort is deliberately NOT built.
const ROW_CHUNK_SIZE = 5000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
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
    // at runtime — the exact 500 this guard exists to prevent.
    if (!decoded || !Number.isInteger(decoded.position) || Math.abs(decoded.position) > 2147483647) {
      return jsonError("invalid cursor", 400);
    }
    cursor = decoded;
  }

  // Keyset WHERE resumes strictly after (position, id) in the same composite
  // order the query sorts by, so chunks never skip or repeat rows.
  const where: Prisma.DataTableRowWhereInput = cursor
    ? {
        tableId: id,
        OR: [
          { position: { gt: cursor.position } },
          { position: cursor.position, id: { gt: cursor.id } },
        ],
      }
    : { tableId: id };

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
    cursor ? Promise.resolve(null) : prisma.dataTableRow.count({ where: { tableId: id } }),
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
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
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
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const existing = await prisma.dataTableRow.findFirst({
    where: { id: rowId, tableId: id },
    select: { id: true, values: true },
  });
  if (!existing) return jsonError("row not found", 404);

  const incoming = typeof body.values === "object" && body.values !== null ? body.values : null;
  const data: Record<string, unknown> = {};
  if (incoming) {
    const merged = { ...(existing.values as Record<string, unknown>), ...incoming };
    data.values = merged as Prisma.InputJsonValue;
  }
  if (typeof body.position === "number") data.position = body.position;

  const updated = await prisma.dataTableRow.update({ where: { id: rowId }, data });
  return jsonSuccess(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const existing = await prisma.dataTableRow.findFirst({ where: { id: rowId, tableId: id } });
  if (!existing) return jsonError("row not found", 404);

  await prisma.dataTableRow.delete({ where: { id: rowId } });
  return jsonSuccess({ deleted: true });
}
