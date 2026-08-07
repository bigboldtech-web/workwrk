// Sprints — migration-free (ClickUp parity, Lego path). A Sprint is an
// ordinary Board (List) whose EXISTING Board.settings Json column carries
//   settings.sprint = { isSprint: true, sprintNumber, startDate, endDate }
// (dates ISO "YYYY-MM-DD"). The Sprint Points field is an ordinary NUMBER
// FieldDef in Board.schema.fields keyed "sprint_points", so the FieldShelf,
// table column and drawer all pick it up through code that already ships,
// and per-task values persist in Item.metadata via the proven custom-field
// save path. Rollback = ignore settings.sprint; parseSprintMeta returns
// null for {} so old boards are unaffected.
//
// Client-safe: no Prisma / server imports — shared by server (board.ts)
// and client (sidebar tree, sprint header strip, create modal).

import { format, parseISO } from "date-fns";
import { isDoneStatus, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";

export const SPRINT_POINTS_FIELD_KEY = "sprint_points";
export const SPRINT_POINTS_LABEL = "Sprint Points";

export interface SprintMeta {
  isSprint: true;
  sprintNumber: number;
  /** ISO "YYYY-MM-DD" (local dates — a sprint spans calendar days). */
  startDate: string;
  endDate: string;
}

/** Validate a raw Board.settings blob into SprintMeta, or null when the
 *  board isn't a sprint (absent/malformed `.sprint`). */
export function parseSprintMeta(settings: unknown): SprintMeta | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const sprint = (settings as { sprint?: unknown }).sprint;
  if (!sprint || typeof sprint !== "object" || Array.isArray(sprint)) return null;
  const s = sprint as Record<string, unknown>;
  if (s.isSprint !== true) return null;
  if (typeof s.startDate !== "string" || !s.startDate) return null;
  if (typeof s.endDate !== "string" || !s.endDate) return null;
  const n = Number(s.sprintNumber);
  return {
    isSprint: true,
    sprintNumber: Number.isFinite(n) && n > 0 ? Math.floor(n) : 1,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

/** ClickUp's sprint naming convention: "Sprint 3 (8/10 - 8/23)". */
export function sprintBoardName(n: number, startDate: string, endDate: string): string {
  const fmt = (d: string) => format(parseISO(d), "M/d");
  return `Sprint ${n} (${fmt(startDate)} - ${fmt(endDate)})`;
}

/** Total vs done Sprint Points across the given items. Done-ness follows
 *  the board's own status groups (isDoneStatus), never a hardcoded value. */
export function computeSprintPoints(
  items: readonly Pick<BoardItemRow, "status" | "metadata">[],
  statuses: readonly StatusOption[],
): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const item of items) {
    const raw = item.metadata?.[SPRINT_POINTS_FIELD_KEY];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    total += n;
    if (isDoneStatus(statuses, item.status)) done += n;
  }
  return { total, done };
}

const DAY_MS = 86_400_000;

/** Countdown label for the sprint header strip. Active through the whole
 *  final calendar day (end-of-day of endDate). */
export function sprintDayLabel(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): { label: string; phase: "upcoming" | "active" | "ended" } {
  const start = parseISO(startDate).getTime();
  const endOfEnd = parseISO(endDate).getTime() + DAY_MS - 1;
  const t = now.getTime();
  if (t < start) {
    const n = Math.max(1, Math.ceil((start - t) / DAY_MS));
    return { label: `Starts in ${n}d`, phase: "upcoming" };
  }
  if (t <= endOfEnd) {
    // Full days remaining after today; 0 = the final day.
    const n = Math.floor((endOfEnd - t) / DAY_MS);
    return { label: n <= 0 ? "Ends today" : `${n} day${n === 1 ? "" : "s"} left`, phase: "active" };
  }
  return { label: "Ended", phase: "ended" };
}
