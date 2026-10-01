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
//      office (presence "ooo") until a known time, which is then that time.
//      Someone ON_LEAVE, or out of office with no return time, has no known
//      moment and is not picked.
//   3. The earliest moment wins; then the fewest open tasks assigned to
//      them; then a fixed order by person id, so the same inputs always give
//      the same person.
//   4. When nobody holds the title, or every holder has no known moment, the
//      task is created UNASSIGNED and carries a notice saying why. The rule
//      never guesses (it never falls back to the person running the SOP).

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

/** When this person is next available, or null for "no known moment". */
export function availableFrom(c: HolderCandidate, now: Date): Date | null {
  if (c.status === "ON_LEAVE") return null;
  if (c.presenceStatus === "ooo") {
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

/** What a spawned task stores at metadata.sopStep (a plain, non-reserved key). */
export interface SopStepOrigin {
  sopId: string;
  sopTitle: string;
  stepId: string;
  n: number;
  stepTitle: string;
  runId: string;
  jobTitle: StepJobTitle | null;
  /** "job-title" when the rule picked someone, "none" when it could not. */
  assignedBy: "job-title" | "none";
  notice: string | null;
}

export function readSopStepOrigin(metadata: unknown): SopStepOrigin | null {
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
    notice: typeof o.notice === "string" ? o.notice : null,
  };
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
