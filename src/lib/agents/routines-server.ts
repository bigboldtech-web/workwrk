// Routines, the server half (docs/plans/ai-teammates.md 3.9): saving one.
// The rules are routines.ts; the runner (processDueRoutines, runRoutine)
// joins this file with the cron step.
//
// A routine works for ONE person, set at creation and never changed: its
// actingForId is the person who asked for it, re-checked on every run, and
// never a fallback to anyone else. It runs at most once an hour (every run
// spends one AI question), and one person has at most ROUTINE_LIMITS of them.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { computeNextRunAt } from "./autonomous";
import { splitScheduleZone } from "./cron";
import { ROUTINE_LIMITS, routineScheduleProblem } from "./routines";
import { describeSchedule, wordsInZone } from "./schedule-words";
import { TEAMMATE_ERRORS, routineLimitMessage } from "./teammate-copy";

export interface RoutineCreated {
  id: string;
  name: string;
  schedule: string;
  /** The schedule in words, its zone named when it is not the person's: "Weekdays at 9:00". */
  when: string;
  nextRunAt: string;
}

export type CreateRoutineResult =
  | { ok: true; routine: RoutineCreated }
  | { ok: false; code: "invalid" | "invalid_schedule" | "too_often" | "limit"; message: string };

/**
 * Save a routine for `actingForId` with one teammate, active from now: its
 * first run is the schedule's next slot. `zone` is the person's own zone, for
 * the words only (the schedule carries its own CRON_TZ=).
 */
export async function createRoutine(a: {
  organizationId: string;
  agentId: string;
  actingForId: string;
  name: string;
  prompt: string;
  schedule: string;
  createdVia: "chat" | "settings";
  zone?: string | null;
  now?: Date;
}): Promise<CreateRoutineResult> {
  const name = String(a.name ?? "").trim().replace(/\s+/g, " ").slice(0, ROUTINE_LIMITS.nameMax).trim();
  const prompt = String(a.prompt ?? "").trim().slice(0, ROUTINE_LIMITS.promptMax).trim();
  if (!name || !prompt) return { ok: false, code: "invalid", message: TEAMMATE_ERRORS.routineInvalid };
  const schedule = String(a.schedule ?? "").trim();
  const problem = routineScheduleProblem(schedule);
  if (problem === "too_often") return { ok: false, code: "too_often", message: TEAMMATE_ERRORS.routineTooOften };
  if (problem) return { ok: false, code: "invalid_schedule", message: TEAMMATE_ERRORS.routineInvalid };

  const [withThis, all] = await Promise.all([
    prisma.agentRoutine.count({ where: { agentId: a.agentId, actingForId: a.actingForId } }),
    prisma.agentRoutine.count({ where: { organizationId: a.organizationId, actingForId: a.actingForId } }),
  ]);
  if (withThis >= ROUTINE_LIMITS.perTeammate) return { ok: false, code: "limit", message: routineLimitMessage(ROUTINE_LIMITS.perTeammate, "teammate") };
  if (all >= ROUTINE_LIMITS.perPerson) return { ok: false, code: "limit", message: routineLimitMessage(ROUTINE_LIMITS.perPerson, "person") };

  const now = a.now ?? new Date();
  const nextRunAt = computeNextRunAt(schedule, now);
  const row = await prisma.agentRoutine.create({
    data: {
      organizationId: a.organizationId,
      agentId: a.agentId,
      actingForId: a.actingForId,
      name,
      prompt,
      schedule,
      status: "active",
      nextRunAt,
      createdVia: a.createdVia,
    },
    select: { id: true, name: true, schedule: true, nextRunAt: true },
  });
  return {
    ok: true,
    routine: {
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      when: wordsInZone(describeSchedule(row.schedule, true), splitScheduleZone(row.schedule).zone, a.zone ?? null),
      nextRunAt: (row.nextRunAt ?? nextRunAt).toISOString(),
    },
  };
}
