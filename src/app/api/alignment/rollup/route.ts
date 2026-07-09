// GET /api/alignment/rollup
//
// Real-work rollup for the alignment system. Board Items are tagged with
// `metadata.kraId` / `metadata.kpiId` (see create-task-modal + the detail
// drawer's Alignment row). This aggregates those tagged tasks per KRA and
// per KPI into { total, done } counts so the KRA/KPI library can show how
// much real work backs each metric — a KPI with 0 linked tasks reads as
// unsupported, one at 8/10 done reads as actively delivered.
//
// Completion is group-driven (isDoneStatus): DONE/CLOSED count as done,
// ACTIVE counts as open. Statuses resolve from the item's Board.statuses,
// falling back to its Space's workflow palette, then the canonical trio.
// Link-only philosophy — this counts work, it does NOT auto-compute the
// metric's numeric value (that still comes from manual KPI check-ins).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import {
  parseBoardStatuses,
  isDoneStatus,
  DEFAULT_STATUS_OPTIONS,
  type StatusOption,
} from "@/lib/board-items-shared";

type Bucket = { total: number; done: number };

function resolveStatuses(board: {
  statuses?: unknown;
  space?: { settings?: unknown } | null;
} | null): StatusOption[] {
  const fromBoard = parseBoardStatuses(board?.statuses);
  if (fromBoard) return fromBoard;
  const wf = (board?.space?.settings as { workflow?: { statuses?: unknown } } | null)?.workflow?.statuses;
  const fromSpace = parseBoardStatuses(wf);
  if (fromSpace) return fromSpace;
  return [...DEFAULT_STATUS_OPTIONS];
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const organizationId = getOrgId(session);

  const items = await prisma.item.findMany({
    where: {
      organizationId,
      archivedAt: null,
      OR: [
        { metadata: { path: ["kraId"], not: Prisma.DbNull } },
        { metadata: { path: ["kpiId"], not: Prisma.DbNull } },
      ],
    },
    select: {
      status: true,
      metadata: true,
      board: { select: { statuses: true, space: { select: { settings: true } } } },
    },
  });

  const kra: Record<string, Bucket> = {};
  const kpi: Record<string, Bucket> = {};

  const bump = (map: Record<string, Bucket>, id: unknown, done: boolean) => {
    if (typeof id !== "string" || !id) return;
    const e = (map[id] ??= { total: 0, done: 0 });
    e.total += 1;
    if (done) e.done += 1;
  };

  for (const it of items) {
    const md = (it.metadata ?? {}) as Record<string, unknown>;
    const kraId = md.kraId;
    const kpiId = md.kpiId;
    if (typeof kraId !== "string" && typeof kpiId !== "string") continue;
    const done = isDoneStatus(resolveStatuses(it.board), it.status);
    bump(kra, kraId, done);
    bump(kpi, kpiId, done);
  }

  return jsonSuccess({ kra, kpi });
}
