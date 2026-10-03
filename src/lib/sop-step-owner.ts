// A step of a step-by-step SOP can name a JOB TITLE (a Role row: the title a
// person holds in the workspace, User.roleId) and can be marked to create a
// task when the SOP is run. This module is the pure half: the step fields as
// they are stored in SOP.content, and the one rule that picks who the task
// goes to. Server code loads the people and hands them in
// (src/lib/sop-spawn.ts); the editor and the run dialog read the same fields.
//
// THE STORED SHAPE (additive keys on a step in content.steps, and the same
// keys on content.flow.steps so the flow layout keeps them):
//
//   jobTitle?:    { roleId: string; title: string }   the owner, by title
//   createsTask?: boolean                             run creates a task
//
// and on the content itself `spawn?: { boardId: string }`, the List a run
// puts the tasks on unless the person running it picks another.
//
// THE SOONEST AVAILABLE RULE (written down here, shown on the run dialog,
// and tested in sop-step-owner.test.ts). Among the people who hold the job
// title in this workspace:
//
//   1. Only real, current people count: not removed (deletedAt), not an AI
//      agent, and not INACTIVE. People on probation, on a PIP or serving
//      notice are working and count.
//   2. Each person is available from a moment: now, unless they are out of
//      office until a known time, which is then that time. Out of office is
//      read from the status the product really stores (isOutOfOfficeStatus):
//      the Set status presets "Vacation" and "Sick", or a status that says
//      "OOO" or "out of office". Someone ON_LEAVE, or out of office with no
//      return time, has no known moment and is not picked.
//   3. The earliest moment wins; then the fewest open tasks assigned to
//      them; then a fixed order by person id, so the same inputs always give
//      the same person.
//   4. When nobody holds the title, or every holder has no known moment, the
//      task is created UNASSIGNED and carries a notice saying why. The rule
//      never guesses (it never falls back to the person running the SOP).

import { decodePresence } from "./people/presence-codec";
import type { SopKind } from "./sop-kind";

export interface StepJobTitle {
  roleId: string;
  title: string;
}

export interface StepOwnerFields {
  jobTitle?: StepJobTitle | null;
  createsTask?: boolean;
}

/** Read the job title off a stored step, tolerating any JSON. */
export function stepJobTitle(step: unknown): StepJobTitle | null {
  const jt = (step as { jobTitle?: unknown } | null)?.jobTitle as { roleId?: unknown; title?: unknown } | null | undefined;
  if (!jt || typeof jt !== "object") return null;
  if (typeof jt.roleId !== "string" || !jt.roleId) return null;
  const title = typeof jt.title === "string" && jt.title.trim() ? jt.title.trim().slice(0, 120) : "Job title";
  return { roleId: jt.roleId, title };
}

export function stepCreatesTask(step: unknown): boolean {
  return (step as { createsTask?: unknown } | null)?.createsTask === true;
}

/** The fields of a recorded step the public read view draws (RecordingRead). */
const PUBLIC_RECORDED_STEP_KEYS = ["order", "action", "description", "url", "screenshot"] as const;

/**
 * A copy of an SOP's content safe to send to a signed-out reader: no
 * `spawn` (the id of the List a run fills), and no `jobTitle` or
 * `createsTask` on any step of `steps` or `flow.steps`. Job titles are the
 * workspace's internal names and the ids are internal; the public read view
 * already hides them on screen, but a client component receives its whole
 * prop, so anything left in the content is readable in the page source.
 *
 * A RECORDED SOP (pass its kind) keeps only what the read view draws: the
 * content's type, and per step its order, action, description, url and
 * screenshot. The capture also stores the clicked element's text and tag,
 * the screenshot's storage key and the recorder's session id; the element
 * text can be a customer's name in a row the recorder clicked, even when the
 * step's caption was edited to leave it out. A field added to recordings
 * later stays private until it is added to the list above.
 *
 * Never mutates the stored content. Pure.
 */
export function publicSopContent<T>(content: T, kind?: SopKind): T {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  if (kind === "recording") {
    const c = content as Record<string, unknown>;
    const steps = Array.isArray(c.steps)
      ? c.steps.map((step) => {
          const from = step && typeof step === "object" && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
          const kept: Record<string, unknown> = {};
          for (const k of PUBLIC_RECORDED_STEP_KEYS) if (k in from) kept[k] = from[k];
          return kept;
        })
      : [];
    return { ...(typeof c.type === "string" ? { type: c.type } : {}), steps } as T;
  }
  const strip = (steps: unknown): unknown =>
    Array.isArray(steps)
      ? steps.map((step) => {
          if (!step || typeof step !== "object" || Array.isArray(step)) return step;
          const rest: Record<string, unknown> = { ...(step as Record<string, unknown>) };
          delete rest.jobTitle;
          delete rest.createsTask;
          return rest;
        })
      : steps;
  const out: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  delete out.spawn;
  if ("steps" in out) out.steps = strip(out.steps);
  const flow = out.flow;
  if (flow && typeof flow === "object" && !Array.isArray(flow) && "steps" in (flow as Record<string, unknown>)) {
    out.flow = { ...(flow as Record<string, unknown>), steps: strip((flow as Record<string, unknown>).steps) };
  }
  return out as T;
}

/** The List a run defaults to, from content.spawn.boardId. */
export function contentSpawnBoardId(content: unknown): string | null {
  const s = (content as { spawn?: { boardId?: unknown } } | null)?.spawn;
  return s && typeof s.boardId === "string" && s.boardId ? s.boardId : null;
}

export interface HolderCandidate {
  id: string;
  name: string;
  status: string;
  /** An AI agent, not a person (the engine's mirror, access/job-title-holders.ts). */
  isAgent: boolean;
  deletedAt: Date | string | null;
  presenceStatus: string | null;
  presenceUntil: Date | string | null;
  /** Open (not done, not archived) tasks assigned to them right now. */
  openTasks: number;
}

export type HolderPick =
  | { kind: "assigned"; userId: string; name: string; availableAt: Date; holders: number }
  | { kind: "nobody"; notice: string; holders: 0 }
  | { kind: "unavailable"; notice: string; holders: number };

const COUNTED_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "PROBATION", "PIP", "NOTICE_PERIOD", "ON_LEAVE"]);

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The Set status presets that mean "not at work" (set-status-modal.tsx:
// "Sick" is OOO for today, "Vacation" OOO until Thursday). Compared as words,
// ignoring case and the emoji the codec puts in front.
const AWAY_LABELS: ReadonlySet<string> = new Set(["vacation", "sick"]);
// "OOO" as a word, so a status like "Cooool" is not read as away.
const OOO_WORD = /(^|[^a-z0-9])ooo([^a-z0-9]|$)/;

/**
 * Does a stored User.presenceStatus say the person is out of office? It reads
 * what PUT /api/me/presence really writes (presence-codec encodePresence: an
 * emoji, a space, the label), so "🏖️ Vacation" and "🤒 Sick" count, as does
 * any status saying "OOO" or "out of office", and the bare "ooo" this rule
 * first matched. Pure.
 */
export function isOutOfOfficeStatus(status: string | null | undefined): boolean {
  const decoded = decodePresence(status, null);
  if (!decoded) return false;
  const label = decoded.label.trim().toLowerCase();
  return AWAY_LABELS.has(label) || OOO_WORD.test(label) || label.includes("out of office");
}

/** When this person is next available, or null for "no known moment". */
export function availableFrom(c: HolderCandidate, now: Date): Date | null {
  if (c.status === "ON_LEAVE") return null;
  if (isOutOfOfficeStatus(c.presenceStatus)) {
    const until = toDate(c.presenceUntil);
    if (!until) return null;
    return until.getTime() > now.getTime() ? until : now;
  }
  return now;
}

export function nobodyNotice(title: string): string {
  return `Nobody holds the ${title} job title yet, so this task is unassigned. Give someone the title in People, then assign it.`;
}

export function unavailableNotice(title: string, holders: number): string {
  const who = holders === 1 ? "The one person who holds" : `All ${holders} people who hold`;
  return `${who} the ${title} job title ${holders === 1 ? "is" : "are"} away with no return date, so this task is unassigned.`;
}

/** The soonest available holder of a job title (the rule in the header). Pure. */
export function pickJobTitleHolder(candidates: readonly HolderCandidate[], title: string, now: Date = new Date()): HolderPick {
  const holders = candidates.filter(
    (c) => !c.deletedAt && !c.isAgent && COUNTED_STATUSES.has(c.status),
  );
  if (holders.length === 0) return { kind: "nobody", notice: nobodyNotice(title), holders: 0 };
  const ranked = holders
    .map((c) => ({ c, at: availableFrom(c, now) }))
    .filter((r): r is { c: HolderCandidate; at: Date } => r.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.c.openTasks - b.c.openTasks || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  const first = ranked[0];
  if (!first) return { kind: "unavailable", notice: unavailableNotice(title, holders.length), holders: holders.length };
  return { kind: "assigned", userId: first.c.id, name: first.c.name, availableAt: first.at, holders: holders.length };
}

/** The one sentence the run dialog shows under the steps (the rule, in plain words). */
export const SOONEST_AVAILABLE_RULE =
  "Each task goes to the person holding the step's job title who is available soonest: people out of office are counted from their return time, then the one with the fewest open tasks. When nobody holds the title, the task is created unassigned with a note saying so.";

/**
 * What a spawned task stores at metadata.sopStep. It is a plain key, so it
 * travels with every normal metadata save, and anyone who can edit the task
 * can also write it: the trail therefore never shows its step text or its
 * notice as stored. It checks the step against the SOP's own content and
 * words the notice from current facts (src/lib/task-trail-server.ts).
 */
export interface SopStepOrigin {
  sopId: string;
  /**
   * The SOP's title as it was when the task was made. No longer written: the
   * metadata travels to every reader of the task, and a reader who may not
   * open the SOP must not learn its name from it (the trail reads the live
   * title under the SOP read rule). Older tasks may still carry it; the item
   * projection drops it (board-items-view.ts).
   */
  sopTitle?: string;
  stepId: string;
  n: number;
  stepTitle: string;
  runId: string;
  jobTitle: StepJobTitle | null;
  /** "job-title" when the rule picked someone, "none" when it could not. */
  assignedBy: "job-title" | "none";
  /** The person the rule picked, when it picked someone. */
  assigneeId?: string | null;
  /** Why nobody was picked: no holder, or every holder away with no return date. */
  reason?: "nobody" | "unavailable" | null;
  notice: string | null;
}

export function readSopStepOrigin(metadata: unknown): (SopStepOrigin & { sopTitle: string }) | null {
  const o = (metadata as { sopStep?: unknown } | null)?.sopStep as Partial<SopStepOrigin> | null | undefined;
  if (!o || typeof o !== "object" || typeof o.sopId !== "string" || typeof o.stepId !== "string") return null;
  return {
    sopId: o.sopId,
    sopTitle: typeof o.sopTitle === "string" ? o.sopTitle : "SOP",
    stepId: o.stepId,
    n: typeof o.n === "number" ? o.n : 0,
    stepTitle: typeof o.stepTitle === "string" ? o.stepTitle : "",
    runId: typeof o.runId === "string" ? o.runId : "",
    jobTitle: stepJobTitle(o),
    assignedBy: o.assignedBy === "job-title" ? "job-title" : "none",
    assigneeId: typeof o.assigneeId === "string" && o.assigneeId ? o.assigneeId : null,
    reason: o.reason === "nobody" || o.reason === "unavailable" ? o.reason : null,
    notice: typeof o.notice === "string" ? o.notice : null,
  };
}

/**
 * A task's metadata with any stored SOP title taken out of sopStep, for
 * sending to a reader. The title names a SOP the reader may not be allowed
 * to open (a SOP filed in a folder they hold no grant on), and nothing reads
 * it: the trail reads the live title under the SOP read rule. The pointer
 * itself (sopId, stepId, runId) stays, so a whole-blob save made from this
 * copy keeps everything a retried run and the trail need. Returns the same
 * object when there is nothing to drop. Pure.
 */
export function withoutStoredSopTitle<T>(metadata: T): T {
  const o = (metadata as { sopStep?: unknown } | null)?.sopStep;
  if (!o || typeof o !== "object" || Array.isArray(o) || !("sopTitle" in o)) return metadata;
  const rest: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  delete rest.sopTitle;
  return { ...(metadata as Record<string, unknown>), sopStep: rest } as T;
}

export interface RunnableStep {
  stepId: string;
  n: number;
  title: string;
  jobTitle: StepJobTitle | null;
  createsTask: boolean;
}

/** The steps of a step-by-step SOP's content, in order (the list layout, else the flow's). Pure. */
export function runnableSteps(content: unknown): RunnableStep[] {
  const c = (content ?? {}) as { steps?: unknown; flow?: { steps?: unknown } };
  const list = Array.isArray(c.steps) && c.steps.length > 0 ? c.steps : Array.isArray(c.flow?.steps) ? (c.flow!.steps as unknown[]) : [];
  const out: RunnableStep[] = [];
  list.forEach((raw, i) => {
    const s = raw as { id?: unknown; title?: unknown };
    if (!s || typeof s !== "object") return;
    const stepId = typeof s.id === "string" && s.id ? s.id : `step-${i + 1}`;
    const title = typeof s.title === "string" && s.title.trim() ? s.title.trim().slice(0, 240) : `Step ${i + 1}`;
    out.push({ stepId, n: i + 1, title, jobTitle: stepJobTitle(raw), createsTask: stepCreatesTask(raw) });
  });
  return out;
}

export interface StepPlan extends RunnableStep {
  pick: HolderPick | null;
  /** The job title's CURRENT name (a renamed title reads as it is now), or null when it was deleted. */
  currentTitle: string | null;
}

/**
 * Who each step of ONE run goes to, step by step. Pure.
 *
 * The rule is applied in step order, and every task the run gives a holder
 * counts as one more open task for the steps after it, so two steps with
 * the same job title are spread across its holders the way two runs would
 * be. A step the run already made (`alreadyMade`, a retry of the same run)
 * is already in the open-task counts, so it adds nothing.
 */
export function planRunPicks(
  steps: readonly RunnableStep[],
  holdersByRole: ReadonlyMap<string, readonly HolderCandidate[]>,
  currentTitleOf: ReadonlyMap<string, string>,
  now: Date = new Date(),
  alreadyMade: ReadonlySet<string> = new Set(),
): StepPlan[] {
  const extra = new Map<string, number>();
  return steps.map((s) => {
    if (!s.jobTitle) return { ...s, pick: null, currentTitle: null };
    const currentTitle = currentTitleOf.get(s.jobTitle.roleId) ?? null;
    const label = currentTitle ?? s.jobTitle.title;
    // A deleted job title has no holders: the same visible "nobody" notice.
    const pool = currentTitle ? holdersByRole.get(s.jobTitle.roleId) ?? [] : [];
    const counted = pool.map((c) => ({ ...c, openTasks: c.openTasks + (extra.get(c.id) ?? 0) }));
    const pick = pickJobTitleHolder(counted, label, now);
    if (pick.kind === "assigned" && s.createsTask && !alreadyMade.has(s.stepId)) {
      extra.set(pick.userId, (extra.get(pick.userId) ?? 0) + 1);
    }
    return { ...s, pick, currentTitle };
  });
}
