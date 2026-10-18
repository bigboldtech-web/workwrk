// The skill a browser follows (docs/plans/ai-teammates-phase5.md Decisions
// 15 to 17, step 4): one of the person's own ready skills, read by its id and
// its person, its teammate and its workspace, at the version a run pinned.
//
// A SKILL IS FOLLOWED ONLY AT ITS VERSION, AND ONLY WHILE READY (Decision
// 15): a skill edited, deleted or turned back into a draft since a run
// pinned it is no longer followed, and every reader here answers none for it.
// The start address is the start step's, as the person saw it whole at review
// and kept it (Decision 17), else the row's own startUrl.
//
// What the model reads of a skill is built from these steps by steps.ts
// skillDataLines, only as data (Decision 16).
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { storedSteps } from "./steps";
import type { SkillStep } from "./types";

/** A skill as a run follows it: its id and version, the person's words for it, its steps and its start. */
export interface FollowedSkill {
  id: string;
  version: number;
  name: string;
  description: string;
  steps: SkillStep[];
  startUrl: string;
}

/** The skill as a turn carries it (executor.ts counters.skill): enough to open its start and to name it. */
export type SkillPin = { id: string; version: number; name: string; startUrl: string };

export const FOLLOW_SELECT = { id: true, name: true, description: true, status: true, version: true, steps: true, startUrl: true } as const;

/** A row read by FOLLOW_SELECT, as a run follows it; null when it is not ready or has no start to open. */
export function followedFrom(row: { id: string; name: string; description: string | null; status: string; version: number; steps: unknown; startUrl: string | null } | null): FollowedSkill | null {
  if (!row || row.status !== "ready") return null;
  const steps = storedSteps(row.steps);
  const start = steps.find((s) => s.kind === "start");
  const startUrl = start && start.kind === "start" ? start.address : (row.startUrl ?? "");
  if (!startUrl) return null;
  return { id: row.id, version: row.version, name: row.name, description: row.description ?? "", steps, startUrl };
}

/**
 * One skill of this person's, for this teammate, in this workspace, ready,
 * at `version` when one is given; null otherwise (anyone else's, a draft, a
 * skill changed since, or one deleted). Never throws: a read that fails is
 * none, so nothing is followed on a guess.
 */
export async function readFollowedSkill(o: { organizationId: string; userId: string; agentId: string; id: string; version?: number }): Promise<FollowedSkill | null> {
  if (typeof o.id !== "string" || !o.id || o.id.length > 64) return null;
  try {
    const row = await prisma.teammateSkill.findFirst({ where: { id: o.id, organizationId: o.organizationId, userId: o.userId, agentId: o.agentId }, select: FOLLOW_SELECT });
    const skill = followedFrom(row);
    if (!skill) return null;
    if (typeof o.version === "number" && skill.version !== o.version) return null;
    return skill;
  } catch (err) {
    console.error(`[skills] follow read ${err instanceof Error ? err.name : "error"}`);
    return null;
  }
}

/** The skill as a turn carries it. */
export function pinOf(s: FollowedSkill): SkillPin {
  return { id: s.id, version: s.version, name: s.name, startUrl: s.startUrl };
}
