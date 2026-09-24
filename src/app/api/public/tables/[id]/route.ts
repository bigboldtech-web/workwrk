// GET /api/public/tables/[id]?cursor=&limit=   read-only public table snapshot (no auth)
//
// Answers only while ALL of these hold, and otherwise 404 with no detail (the
// embed shows the neutral "This link is invalid or has been turned off."):
//   - the table's public link is on (DataTable.isPublic);
//   - the org has not set toggle 10 (settings.access.publicLinks) to "off";
//   - the spreadsheets module is on for the org (a module the org switched
//     off does not keep serving its data through an embed).
//
// What it returns changed three ways (spec-tables-forms /embed/tables/[id]):
//   1. COMPUTED display values: every row is evaluated by the same engine the
//      grid runs, on the server, so a formula cell reads its number and never
//      "[object Object]". Formatting follows the column (currency, percent,
//      date), exactly as in the product.
//   2. Column NAMES, falling back to the letter, plus an alignment, so the
//      header row of a sheet-born table is A, B, C and not a row of blanks.
//   3. Paging: ?cursor= and ?limit= (default 200, max 1000) over the
//      evaluated rows, instead of a silent 5,000-row cap with no paging.
//
// The whole table is evaluated before the page is cut, because a formula on
// page one may read any row. The evaluated snapshot is memoised per process
// (lib/sheet-embed-cache), keyed by the table's data signature, so paging and
// repeat views cost one cheap aggregate query and no engine run; any edit is a
// miss. A per-IP limit backs that up for the no-auth door. The response is
// also cacheable for 60 seconds, and carries updatedAt so the embed says how
// fresh it is. Never the settings blob, the creator, the Space or the org.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isModuleActive } from "@/lib/entitlements";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { buildEmbedSnapshot, pageEmbedRows, type EmbedSnapshot, type EmbedSourceColumn } from "@/lib/sheet-embed";
import { EmbedSnapshotCache } from "@/lib/sheet-embed-cache";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

// A ceiling on what one public request evaluates. Far above any table the
// product creates (1,000 seeded rows, a 5,000-row CSV import); a table past it
// shows its first rows only, and says so through `truncated`.
const MAX_EVALUATED_ROWS = 50_000;

// Generous for a person paging an embed or many viewers behind one office
// NAT; only a script hammering the door trips it.
const PER_IP = { max: 300, windowMs: 60_000 };

interface Evaluated {
  snapshot: EmbedSnapshot;
  truncated: boolean;
  updatedAt: Date;
}

const snapshots = new EmbedSnapshotCache<Evaluated>({ maxEntries: 8, ttlMs: 60_000 });

const NOT_FOUND = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const limited = rateLimit(`public-table:${ipFromRequest(req)}`, PER_IP);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } });
  }

  const table = await prisma.dataTable.findFirst({
    where: { id, isPublic: true },
    // `settings` is selected but NEVER returned whole. It is the table's
    // private blob (saved views, freeze positions, conditional formats and
    // whatever a later release puts there), and this route answers with no
    // authentication at all. Only `namedRanges` is read out of it, because a
    // formula written as SUM(Revenue) resolves to #NAME? without the name.
    select: {
      id: true, name: true, description: true, columns: true, settings: true, updatedAt: true,
      organizationId: true, organization: { select: { settings: true } },
    },
  });
  if (!table) return NOT_FOUND();
  if (!orgPublicLinksAllowed(table.organization?.settings)) return NOT_FOUND();
  if (!(await isModuleActive(table.organizationId, "workwrk-tables"))) return NOT_FOUND();

  // The data signature: any cell edit, insert, delete, column change or
  // settings change moves one of these, so the memo can never serve an old
  // evaluation of new data.
  const agg = await prisma.dataTableRow.aggregate({
    where: { tableId: id, deletedAt: null },
    _max: { updatedAt: true },
    _count: { _all: true },
  });
  const sig = `${table.updatedAt.getTime()}:${agg._max.updatedAt?.getTime() ?? 0}:${agg._count._all}`;

  const { snapshot, truncated, updatedAt } = await snapshots.get(id, sig, () => evaluate(table));
  const { page, nextCursor, start } = pageEmbedRows(snapshot.rows, sp.get("cursor"), sp.get("limit"));

  return NextResponse.json(
    {
      id: table.id,
      name: table.name,
      description: table.description,
      updatedAt,
      columns: snapshot.columns,
      rows: page,
      start,
      total: snapshot.rows.length,
      nextCursor,
      truncated,
    },
    // no-store, like the 404: turning the public link off, the org's
    // public-links toggle off or the module off must take effect at once
    // (access-model-spec section 12), so no browser or shared cache may keep
    // serving the last snapshot. The server-side snapshot cache above is
    // checked only after the isPublic, toggle and module gates.
    { headers: { "Cache-Control": "no-store" } },
  );
}

type PublicTable = {
  id: string;
  columns: unknown;
  settings: unknown;
  updatedAt: Date;
  organizationId: string;
};

/** Load every live row and run the engine over them: the expensive part. */
async function evaluate(table: PublicTable): Promise<Evaluated> {
  const id = table.id;
  const settings = table.settings as { namedRanges?: unknown } | null;
  const namedRanges = Array.isArray(settings?.namedRanges)
    ? settings.namedRanges.filter(
        (r): r is { name: string; ref: string } =>
          !!r && typeof r === "object" &&
          typeof (r as { name?: unknown }).name === "string" &&
          typeof (r as { ref?: unknown }).ref === "string",
      )
    : [];

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id, deletedAt: null },
    // The app grid's keyset order, so formulas anchor to the same rows.
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: MAX_EVALUATED_ROWS + 1,
    select: { id: true, values: true, updatedAt: true },
  });
  const truncated = rows.length > MAX_EVALUATED_ROWS;
  const evaluated = truncated ? rows.slice(0, MAX_EVALUATED_ROWS) : rows;

  const rawColumns: unknown[] = Array.isArray(table.columns) ? (table.columns as unknown[]) : [];
  const columns: EmbedSourceColumn[] = rawColumns
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c))
    .map((c) => ({
      id: String(c.id ?? ""),
      type: typeof c.type === "string" ? c.type : "short_text",
      label: typeof c.label === "string" ? c.label : "",
      formula: typeof c.formula === "string" ? c.formula : undefined,
      format: c.format && typeof c.format === "object" ? (c.format as EmbedSourceColumn["format"]) : undefined,
    }))
    .filter((c) => c.id !== "");

  // People cells show names, as they do in the product. Only names, only for
  // ids this table actually stores, and only inside the table's own org.
  const personCols = columns.filter((c) => c.type === "person").map((c) => c.id);
  let people: Map<string, string> | undefined;
  if (personCols.length > 0) {
    const ids = new Set<string>();
    for (const r of evaluated) {
      const v = r.values as Record<string, unknown> | null;
      for (const cid of personCols) {
        const arr = v?.[cid];
        if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") ids.add(x);
      }
    }
    if (ids.size > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: [...ids] }, organizationId: table.organizationId },
        select: { id: true, firstName: true, lastName: true },
      });
      people = new Map(users.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()]));
    }
  }

  const snapshot = buildEmbedSnapshot({
    columns,
    rows: evaluated.map((r) => ({ id: r.id, values: (r.values as Record<string, unknown> | null) ?? {} })),
    namedRanges,
    people,
  });
  // "Updated 3 minutes ago" means the data, so it is the latest of the table
  // row itself and any of its rows (a cell edit touches only the row).
  let updatedAt = table.updatedAt;
  for (const r of evaluated) if (r.updatedAt > updatedAt) updatedAt = r.updatedAt;

  return { snapshot, truncated, updatedAt };
}
