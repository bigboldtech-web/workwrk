// Who may save or publish an automation with an AI teammate step
// (docs/plans/ai-teammates-phase2.md step 7).
//
// The teammate works as the automation's creator, so only the creator may
// put words in its request or publish them: anyone else editing that step
// would be telling another person's teammate what to do in their name. The
// teammate must be one the creator can use, read when the step is saved and
// again on every run (automation-turn.ts).

import type { Viewer } from "@/lib/access/types";
import { loadTeammate } from "@/lib/agents/teammate-server";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";

export const TEAMMATE_STEP_KEY = "ask_teammate";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The teammate slugs of a definition's teammate steps, in order (the engine's own action shapes). */
export function teammateStepSlugs(definition: unknown): string[] {
  const actions = asRecord(definition).actions;
  if (!Array.isArray(actions)) return [];
  const slugs: string[] = [];
  for (const raw of actions) {
    const a = asRecord(raw);
    const key = typeof a.key === "string" ? a.key : typeof a.action === "string" ? a.action : typeof a.type === "string" ? a.type : null;
    if (key !== TEAMMATE_STEP_KEY) continue;
    const params = asRecord(a.params ?? a.config);
    slugs.push(typeof params.teammate === "string" ? params.teammate : "");
  }
  return slugs;
}

export type TeammateStepProblem = { status: 400 | 403; error: string; code: "teammate_step_creator_only" | "teammate_not_found" };

/**
 * Why this definition may not be saved or published by this person, or null.
 * `viewer` is the saver; their teammates are checked only when they are the
 * creator (anyone else is refused first).
 */
export async function teammateStepProblem(
  definition: unknown,
  who: { saverId: string; creatorId: string | null; viewer: Viewer },
): Promise<TeammateStepProblem | null> {
  const slugs = teammateStepSlugs(definition);
  if (slugs.length === 0) return null;
  if (!who.creatorId || who.saverId !== who.creatorId) {
    return { status: 403, error: AUTOMATION_TEAMMATE_COPY.creatorOnly, code: "teammate_step_creator_only" };
  }
  for (const slug of new Set(slugs)) {
    if (!slug || !(await loadTeammate(slug, who.viewer))) {
      return { status: 400, error: AUTOMATION_TEAMMATE_COPY.teammateNotFound, code: "teammate_not_found" };
    }
  }
  return null;
}

/**
 * A run's steps as a viewer who is neither the automation's creator nor an
 * Owner or Admin reads them: a teammate step's answer was read from the
 * creator's own reach, so it is hidden, and so is what every action after
 * it returned, which can carry it (a task's title, an email's subject).
 * What went in is the step as written, never the answer, and stays.
 */
export function hideTeammateAnswers<T extends { order: number; stepType: string; stepKey: string; outputJson: unknown }>(steps: readonly T[]): T[] {
  const first = steps.find((s) => s.stepType === "ACTION" && s.stepKey === TEAMMATE_STEP_KEY);
  if (!first) return [...steps];
  return steps.map((s) => {
    if (s.stepType !== "ACTION" || s.order < first.order) return s;
    if (s.stepKey === TEAMMATE_STEP_KEY) {
      const out = asRecord(s.outputJson);
      return { ...s, outputJson: { teammate: typeof out.teammate === "string" ? out.teammate : null, answerHidden: true } };
    }
    return { ...s, outputJson: { answerHidden: true } };
  });
}
