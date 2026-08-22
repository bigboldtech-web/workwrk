// POST /api/tables/[id]/rows/batch — one round-trip for many row ops.
// Tables Phase 1 (docs/plans/tables.md): the sheet kernel's clears,
// bulk deletes, pastes and fills all land here instead of a request
// per cell. Body:
//   { updates?: [{ id, values }],   // shallow-merge per row
//     inserts?: [{ values? }],      // appended in order after max position
//     deletes?: [id, ...] }
// Caps keep a runaway client from hurting the server. All-or-nothing
// transaction so a partial paste can't half-apply.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DataTableRow, Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";

const MAX_OPS = 500;

// Prisma's interactive-transaction defaults (maxWait 2s / timeout 5s) are
// sized for a handful of statements. This body still needs one statement
// per distinct updated row — up to MAX_OPS of them — plus four constant
// queries. Budgeting ~50ms per statement at the cap gives ~25s, so 30s
// leaves headroom: a worst-case paste must commit rather than die with
// P2028 after having already burned the user's typing.
const TX_TIMEOUT_MS = 30_000;
// Wait for a free pool connection before the transaction starts. Long
// enough that a burst of pastes queues instead of failing, short enough
// that a genuinely exhausted pool still surfaces as an error.
const TX_MAX_WAIT_MS = 10_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, spaceId: true },
  });
  if (!table) return jsonError("not found", 404);
  // Gate: reader access, matching every sibling table route (rows POST/
  // PATCH/DELETE, import, tables/[id]). That is deliberately NOT a tight
  // gate — getSpaceForReader returns every ORG-visibility Space to every
  // org member, so any employee who can see a table can also write to it.
  //
  // KNOWN EXPOSURE, TRACKED DECISION: this route can clear or delete up to
  // MAX_OPS rows in one call, so it widens the blast radius of that gap.
  // The tempting fix (canEditSpace: org admin, or SpaceMember OWNER/ADMIN)
  // was tried and reverted, because an ordinary member of an ORG-visibility
  // Space has no SpaceMember row at all: it would 403 the people who can
  // already edit the same cells one at a time through /rows, while leaving
  // the four sibling routes wide open. Tightening is a product decision
  // about who may edit table data, and it has to land on every table write
  // route at once or not at all.
  //
  // spaceId === null means the table hangs off no Space, so there is no
  // Space ACL to consult: org scoping above is the whole gate.
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return jsonError("not found", 404);
  }

  const body = await req.json().catch(() => null);
  const updates: { id: string; values: Record<string, unknown> }[] = Array.isArray(body?.updates)
    ? body.updates.filter((u: unknown): u is { id: string; values: Record<string, unknown> } => {
        const x = u as { id?: unknown; values?: unknown };
        return typeof x?.id === "string" && typeof x?.values === "object" && x.values !== null;
      })
    : [];
  const inserts: { values: Record<string, unknown> }[] = Array.isArray(body?.inserts)
    ? body.inserts.map((i: unknown) => {
        const x = i as { values?: unknown };
        return { values: (typeof x?.values === "object" && x.values !== null ? x.values : {}) as Record<string, unknown> };
      })
    : [];
  const deletes: string[] = Array.isArray(body?.deletes)
    ? [...new Set<string>((body.deletes as unknown[]).filter((d): d is string => typeof d === "string"))]
    : [];

  if (updates.length === 0 && inserts.length === 0 && deletes.length === 0) {
    return jsonError("Nothing to do", 400);
  }
  if (updates.length > MAX_OPS || inserts.length > MAX_OPS || deletes.length > MAX_OPS) {
    return jsonError(`Too many operations (max ${MAX_OPS} per kind)`, 400);
  }

  // Touched rows must belong to THIS table. Look the ids up globally
  // rather than scoped to the table so the check can tell the two
  // shortfall causes apart: an id that resolves to a DIFFERENT table is a
  // genuine cross-table (or cross-org) reference and stays a hard reject,
  // while an id that resolves nowhere is merely stale — someone deleted
  // that row between the client's read and this write. The transaction
  // body already tolerates stale ids (the merge skips them, deleteMany is
  // table-scoped and idempotent), and rejecting the whole request over
  // one would throw away everything else the user just typed.
  const touchedIds = [...new Set([...updates.map((u) => u.id), ...deletes])];
  if (touchedIds.length > 0) {
    const found = await prisma.dataTableRow.findMany({
      where: { id: { in: touchedIds } },
      select: { id: true, tableId: true },
    });
    if (found.some((r) => r.tableId !== id)) {
      return jsonError("Some rows don't belong to this table", 400);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // max(position)+1 is a read-modify-write, so two concurrent batches
    // otherwise hand out the same positions (Read Committed, and the
    // schema only has a non-unique @@index([tableId, position])).
    // Serialise allocation on a transaction-scoped advisory lock keyed on
    // the table id — writers to other tables never queue behind this one,
    // and Postgres drops the lock at COMMIT/ROLLBACK so there is no
    // unlock path to miss. Taken up front, before any row locks, so the
    // lock order is the same for every batch and two of them can't
    // deadlock by grabbing rows and the allocator in opposite orders.
    if (inserts.length > 0) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    }

    // One findMany for every row being updated, then merge in memory:
    // the old findFirst+update pair per row made 2N round trips and blew
    // the transaction timeout well before the MAX_OPS cap.
    const merged = new Map<string, Record<string, unknown>>();
    if (updates.length > 0) {
      const existing = await tx.dataTableRow.findMany({
        where: { tableId: id, id: { in: [...new Set(updates.map((u) => u.id))] } },
        select: { id: true, values: true },
      });
      for (const row of existing) merged.set(row.id, { ...(row.values as Record<string, unknown>) });
      // Fold in payload order: a paste can touch the same row twice and
      // the later entry must win only on the keys it actually sets, so
      // each merge has to compose onto the previous one rather than onto
      // the untouched DB value.
      for (const u of updates) {
        const base = merged.get(u.id);
        if (!base) continue; // concurrently deleted — nothing to merge into
        merged.set(u.id, { ...base, ...u.values });
      }
      // Issue in id order so concurrent batches take row locks in the
      // same sequence and can't deadlock each other.
      for (const rowId of [...merged.keys()].sort()) {
        await tx.dataTableRow.update({
          where: { id: rowId },
          data: { values: merged.get(rowId) as Prisma.InputJsonValue },
        });
      }
    }

    let deleted = 0;
    if (deletes.length > 0) {
      const res = await tx.dataTableRow.deleteMany({ where: { tableId: id, id: { in: deletes } } });
      deleted = res.count;
    }

    let inserted: DataTableRow[] = [];
    if (inserts.length > 0) {
      const max = await tx.dataTableRow.aggregate({ where: { tableId: id }, _max: { position: true } });
      let pos = (max._max.position ?? 0) + 1;
      // createManyAndReturn is a single INSERT … RETURNING instead of a
      // create() round trip per row. createdById matches every sibling
      // insert path (rows, import, tables) — the column is nullable, so
      // omitting it loses the author silently and unrecoverably.
      inserted = await tx.dataTableRow.createManyAndReturn({
        data: inserts.map((ins) => ({
          tableId: id,
          organizationId: orgId,
          values: ins.values as Prisma.InputJsonValue,
          position: pos++,
          createdById: userId,
        })),
      });
      // RETURNING order isn't contractual; the positions we just handed
      // out are, and they follow payload order — sort by them so the
      // client can pair each returned row back to what it sent.
      inserted.sort((a, b) => a.position - b.position);
    }

    return { updated: merged.size, deleted, inserted };
  }, { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS });

  // updated/deleted are what actually landed, not what was asked for:
  // stale ids are now tolerated rather than rejected, so the client needs
  // the real counts to notice its view has drifted.
  return jsonSuccess({
    ok: true,
    updated: result.updated,
    deleted: result.deleted,
    inserted: result.inserted,
  });
}
