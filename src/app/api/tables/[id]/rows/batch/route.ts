// POST /api/tables/[id]/rows/batch — one round-trip for many row ops.
// Tables Phase 1 (docs/plans/tables.md): the sheet kernel's clears,
// bulk deletes, pastes and fills all land here instead of a request
// per cell. Body:
//   { updates?: [{ id, values, expect?, position? }],  // shallow-merge per row
//     inserts?: [{ values? }],              // appended in order after max position
//     deletes?: [id, ...] }
//
// An update entry's optional `position` renumbers the row in the same
// transaction (the sheet's drag-to-move-row renumbers a whole span at
// once). Position writes are UNCONDITIONAL — expect guards values only —
// and a position-only entry ({ values: {} }) writes position and nothing
// else. Uniqueness across the payload is the client's job: positions are
// not unique-constrained in the schema, and the move gesture assigns a
// permutation of positions the rows already held.
// Caps keep a runaway client from hurting the server. All-or-nothing
// transaction so a partial paste can't half-apply.
//
// Phase 5c cross-client guard: an update entry may carry `expect`
// ({ colId: previousStoredValue }). Entries whose expect no longer matches
// the STORED row are SKIPPED (never merged, never written) and reported in
// the response as conflicts: [{ id, current, conflictCols }]; every clean
// entry still applies, in the same transaction as before. Update ids that
// match no row (deleted by another client between read and write) used to
// be dropped silently; the response now names them in missingIds: [ids] so
// the client can evict those rows instead of believing the write landed.
//
// Paste / fill / clear / undo NEVER send expect, ON PURPOSE: overwriting a
// range is those gestures' explicit intent. A per-cell 409 mid-paste would
// shred the range into a patchwork of applied and refused cells — worse
// than either full outcome — so bulk gestures stay last-write-wins and only
// the single-cell commit paths (which know the exact pre-edit value they
// are replacing) opt in.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DataTableRow, Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";
import { expectConflicts } from "@/lib/sheet-conflict";

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
  const updates: { id: string; values: Record<string, unknown>; expect?: Record<string, unknown>; position?: number }[] =
    Array.isArray(body?.updates)
      ? (body.updates as unknown[])
          .filter((u): u is { id: string; values: Record<string, unknown> } => {
            const x = u as { id?: unknown; values?: unknown };
            return typeof x?.id === "string" && typeof x?.values === "object" && x.values !== null;
          })
          .map((u) => {
            // Malformed expect (array, primitive) is dropped rather than
            // 400'd: the entry then applies unconditionally, exactly as
            // every entry did before the guard existed — matching the
            // single-row PATCH's treatment of its expect field.
            const rawExpect = (u as { expect?: unknown }).expect;
            // Optional explicit position: the sheet's row-move renumbers a
            // span of rows in the same transaction as its value writes.
            // Integer-gated because DataTableRow.position is an Int — a
            // float would throw inside the transaction, after other rows
            // already took writes. Malformed position drops like malformed
            // expect does: the entry still applies its values.
            const rawPosition = (u as { position?: unknown }).position;
            return {
              id: u.id,
              values: u.values,
              ...(typeof rawExpect === "object" && rawExpect !== null && !Array.isArray(rawExpect)
                ? { expect: rawExpect as Record<string, unknown> }
                : {}),
              ...(typeof rawPosition === "number" && Number.isInteger(rawPosition)
                ? { position: rawPosition }
                : {}),
            };
          })
      : [];
  const inserts: { values: Record<string, unknown>; position?: number }[] = Array.isArray(body?.inserts)
    ? body.inserts.map((i: unknown) => {
        const x = i as { values?: unknown; position?: unknown };
        return {
          values: (typeof x?.values === "object" && x.values !== null ? x.values : {}) as Record<string, unknown>,
          // Optional explicit position: undo restores deleted rows WHERE THEY
          // WERE instead of appending at the end. Absent = allocate after max.
          ...(typeof x?.position === "number" && Number.isFinite(x.position) ? { position: x.position } : {}),
        };
      })
    : [];
  // Duplicate explicit positions in one payload would make the response's
  // id-to-values mapping ambiguous (rows are matched back by position).
  {
    const explicit = inserts.map((i) => i.position).filter((p): p is number => p !== undefined);
    if (new Set(explicit).size !== explicit.length) {
      return jsonError("Duplicate insert positions", 400);
    }
  }
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
    // Rows that absorbed at least one entry. Only these are written: a row
    // whose every entry conflicted must see NO write at all (its merged
    // value would be a byte-identical echo, and writing it would still
    // bump updatedAt and take a pointless row lock).
    const applied = new Set<string>();
    // Explicit position per row (row-move renumbering). Kept apart from
    // `applied` so a position-only entry never writes `values` back: the
    // merged map holds a snapshot read at transaction start, and echoing
    // it would clobber any write that landed between our SELECT and this
    // UPDATE on a row whose values this payload never touched.
    const positionByRow = new Map<string, number>();
    const conflictsByRow = new Map<string, Set<string>>();
    let missingIds: string[] = [];
    if (updates.length > 0) {
      const existing = await tx.dataTableRow.findMany({
        where: { tableId: id, id: { in: [...new Set(updates.map((u) => u.id))] } },
        select: { id: true, values: true },
      });
      // Immutable DB snapshot, separate from `merged`: every expect must be
      // judged against what is STORED, never against earlier entries of
      // this same payload already folded in memory — the client formed its
      // expect from the store, not from ops it doesn't know about.
      const dbValues = new Map<string, Record<string, unknown>>();
      for (const row of existing) {
        // ?? {}: Json null on a legacy row degrades to empty, never a throw.
        dbValues.set(row.id, (row.values ?? {}) as Record<string, unknown>);
        merged.set(row.id, { ...((row.values ?? {}) as Record<string, unknown>) });
      }
      // Update ids the findMany did not return: deleted by another client
      // since this client's read. (Ids belonging to a DIFFERENT table were
      // already hard-rejected before the transaction, so absence here can
      // only mean deletion.) Named in the response instead of dropped.
      missingIds = [...new Set(updates.map((u) => u.id))].filter((uid) => !dbValues.has(uid));
      // Fold in payload order: a paste can touch the same row twice and
      // the later entry must win only on the keys it actually sets, so
      // each merge has to compose onto the previous one rather than onto
      // the untouched DB value.
      for (const u of updates) {
        const base = merged.get(u.id);
        if (!base) continue; // concurrently deleted — reported via missingIds
        // Position rides OUTSIDE the expect gate, on purpose: a row move
        // renumbers rows the user never edited, and a stale cell guard on
        // one of them must not leave the table half-reordered. Later
        // entries for the same row win, like value keys do.
        if (u.position !== undefined) positionByRow.set(u.id, u.position);
        if (u.expect) {
          const cols = expectConflicts(dbValues.get(u.id)!, u.expect);
          if (cols.length > 0) {
            // Skip THIS entry only; other entries for the same row (and
            // every other row) still judge on their own expects.
            const set = conflictsByRow.get(u.id) ?? new Set<string>();
            for (const c of cols) set.add(c);
            conflictsByRow.set(u.id, set);
            continue;
          }
        }
        merged.set(u.id, { ...base, ...u.values });
        // A keyless entry (position-only move payload) marks nothing
        // applied: writing its merged value would be the snapshot echo the
        // positionByRow comment above exists to prevent.
        if (Object.keys(u.values).length > 0) applied.add(u.id);
      }
      // Issue in id order so concurrent batches take row locks in the
      // same sequence and can't deadlock each other. Rows that carry only
      // a position write (values: {}) still take exactly one UPDATE; a
      // values write and a position write to the same row share one.
      for (const rowId of [...new Set([...applied, ...positionByRow.keys()])].sort()) {
        await tx.dataTableRow.update({
          where: { id: rowId },
          data: {
            ...(applied.has(rowId) ? { values: merged.get(rowId) as Prisma.InputJsonValue } : {}),
            ...(positionByRow.has(rowId) ? { position: positionByRow.get(rowId)! } : {}),
          },
        });
      }
    }
    // Materialised AFTER folding: `current` is the row's end-of-batch state
    // (DB snapshot plus any clean entries that did apply), which is what
    // the losing client needs to absorb.
    const conflicts = [...conflictsByRow.entries()].map(([rowId, cols]) => ({
      id: rowId,
      current: merged.get(rowId)!,
      conflictCols: [...cols],
    }));

    let deleted = 0;
    if (deletes.length > 0) {
      const res = await tx.dataTableRow.deleteMany({ where: { tableId: id, id: { in: deletes } } });
      deleted = res.count;
    }

    let inserted: DataTableRow[] = [];
    if (inserts.length > 0) {
      const max = await tx.dataTableRow.aggregate({ where: { tableId: id }, _max: { position: true } });
      let pos = (max._max.position ?? 0) + 1;
      const positionFor = (ins: { position?: number }) => ins.position !== undefined ? ins.position : pos++;
      // createManyAndReturn is a single INSERT … RETURNING instead of a
      // create() round trip per row. createdById matches every sibling
      // insert path (rows, import, tables) — the column is nullable, so
      // omitting it loses the author silently and unrecoverably.
      inserted = await tx.dataTableRow.createManyAndReturn({
        data: inserts.map((ins) => ({
          tableId: id,
          organizationId: orgId,
          values: ins.values as Prisma.InputJsonValue,
          position: positionFor(ins),
          createdById: userId,
        })),
      });
      // RETURNING order isn't contractual; positions are. Auto-allocated
      // positions follow payload order; explicit ones are whatever the
      // client sent (unique, enforced above) — so a client pairing rows
      // back to its payload must send ascending positions or match by
      // position, which the in-repo callers do.
      inserted.sort((a, b) => a.position - b.position);
    }

    // updated counts rows that took a write, so a fully-conflicted row is
    // not in it. Without expects, applied === every existing target row,
    // which is exactly the old merged.size — no change for legacy callers.
    return { updated: applied.size, deleted, inserted, conflicts, missingIds };
  }, { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS });

  // updated/deleted are what actually landed, not what was asked for:
  // stale ids are now tolerated rather than rejected, so the client needs
  // the real counts to notice its view has drifted. conflicts/missingIds
  // are always present (empty when clean) so the client never has to
  // undefined-guard the drift channel.
  return jsonSuccess({
    ok: true,
    updated: result.updated,
    deleted: result.deleted,
    inserted: result.inserted,
    conflicts: result.conflicts,
    missingIds: result.missingIds,
  });
}
