// Who may save or publish an automation with an AI teammate step
// (docs/plans/ai-teammates-phase2.md step 7).
//
// The teammate works as the automation's creator, so only the creator may
// put words in its request or publish them: anyone else editing that step
// would be telling another person's teammate what to do in their name. The
// teammate must be one the creator can use, read when the step is saved and
// again on every run (automation-turn.ts).

import { createHash } from "node:crypto";
import type { Viewer } from "@/lib/access/types";
import { stableJson } from "./definition";
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

/** The definition with each teammate step's teammate kept only when this person can use it, else left empty. */
export async function teammateSlugsUsableBy(definition: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
  if (!Array.isArray(definition.actions)) return definition;
  const actions = await Promise.all(
    definition.actions.map(async (raw) => {
      const a = asRecord(raw);
      const key = typeof a.key === "string" ? a.key : typeof a.action === "string" ? a.action : typeof a.type === "string" ? a.type : null;
      if (key !== TEAMMATE_STEP_KEY) return raw;
      const field = a.params !== undefined ? "params" : a.config !== undefined ? "config" : "params";
      const params = asRecord(a[field]);
      const slug = typeof params.teammate === "string" ? params.teammate : "";
      const usable = slug ? Boolean(await loadTeammate(slug, viewer).catch(() => null)) : false;
      return usable ? raw : { ...a, [field]: { ...params, teammate: null } };
    }),
  );
  return { ...definition, actions };
}

/**
 * Whether the person who made an automation can no longer be acted for here
 * (gone, deactivated, a Guest now, an agent account, or nobody on record).
 * Its teammate step can never run again, so whoever may edit the automation
 * may take that step out; adding or changing one stays theirs alone (review
 * round 7: else a working automation stayed broken for good). AI turned off
 * is not this: it can come back on. A read that fails keeps the lock.
 */
export async function teammateCreatorGone(orgId: string, creatorId: string | null): Promise<boolean> {
  if (!creatorId) return true;
  const { resolveActingPerson } = await import("@/lib/agents/acting");
  const acting = await resolveActingPerson(orgId, creatorId).catch(() => null);
  if (!acting) return false;
  return !acting.ok && acting.reason !== "ai_off";
}

/**
 * What a teammate does, as a short fingerprint: its name, job, instructions,
 * tools, approval rules and model. An automation's step works as its
 * creator, so a version records the fingerprint of each teammate it asks
 * when it is published, and a run whose teammate someone else changed since
 * does not run (review round 9: an Admin could rewrite a workspace teammate
 * to read what a Member's automation reaches). Its on or off state is not
 * part of it.
 */
export function teammateFingerprint(a: {
  name: string;
  description: string | null;
  systemPrompt: string | null;
  toolNames: unknown;
  approvalRules: unknown;
  modelOverride: string | null;
  productSlug: string | null;
}): string {
  const body = stableJson([a.name, a.description ?? "", a.systemPrompt ?? "", a.toolNames ?? null, a.approvalRules ?? null, a.modelOverride ?? "", a.productSlug ?? ""]);
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

/** The key in a version's snapshot that holds its teammates' fingerprints, by slug. */
export const TEAMMATE_PRINTS_KEY = "__teammates";

/** Each teammate a definition asks, as the publisher may use it now, by slug: the fingerprints a version keeps. */
export async function teammatePrintsFor(definition: unknown, viewer: Viewer): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const slug of new Set(teammateStepSlugs(definition))) {
    if (!slug) continue;
    const agent = await loadTeammate(slug, viewer).catch(() => null);
    if (agent) out[slug] = teammateFingerprint(agent);
  }
  return out;
}

/** Whether someone other than the creator may change this teammate: a workspace one, or anyone else's. */
export function othersMayChange(agent: { visibility: string; ownerId: string | null }, creatorId: string): boolean {
  return agent.visibility !== "PRIVATE" || agent.ownerId !== creatorId;
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
function emptyOutput(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
}

export function hideTeammateAnswers<T extends { order: number; stepType: string; stepKey: string; outputJson: unknown; inputJson?: unknown; status?: string }>(steps: readonly T[]): T[] {
  const first = steps.find((s) => s.stepType === "ACTION" && s.stepKey === TEAMMATE_STEP_KEY);
  if (!first) return [...steps];
  return steps.map((s) => {
    if (s.stepType !== "ACTION" || s.order < first.order) return s;
    // A step that returned nothing (it failed, or has not run) has nothing to
    // hide, and saying an answer is hidden would claim one (review round 4).
    // The engine stores a failed step's output as {}, so its status and an
    // empty output both count as nothing returned (review round 5).
    const returned = (s.status === undefined || s.status === "SUCCESS") && !emptyOutput(s.outputJson);
    if (s.stepKey === TEAMMATE_STEP_KEY) {
      // Nor which teammate: a private one's name and slug are its person's (review round 1).
      const input = asRecord(s.inputJson);
      return { ...s, outputJson: returned ? { answerHidden: true } : s.outputJson, ...(s.inputJson !== undefined ? { inputJson: { ...input, teammate: null } } : {}) };
    }
    // A later step's result is hidden because it can carry the answer, not
    // because it is the answer: it says so (review round 2).
    return returned ? { ...s, outputJson: { outputHidden: true } } : s;
  });
}
