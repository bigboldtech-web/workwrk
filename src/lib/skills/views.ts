// What the skill routes answer (docs/plans/ai-teammates-phase5.md step 3,
// Decisions 11, 13 and 14): a person's own skills as the Skills tab lists
// them, and one skill's steps as its step editor shows them.
//
// ONLY WHAT THE PERSON MAY SEE OF THEIR OWN SKILL. Every field comes from
// the stored row and its steps (steps.ts storedSteps, read defensively); a
// picture's id only by shotSrc's rule (1 to 64 letters, digits, hyphens and
// underscores) and only while its file is kept (24 hours, Decision 9). The
// routes read every row by the viewer's own id (Decision 25), so nothing
// here is ever anyone else's.
//
// Pure: types and words, safe on the client.

import { SKILLS_COPY } from "@/lib/agents/teammate-copy";
import { shotSrc } from "@/lib/browser/views";
import { roleWords, storedSteps, wordsFreeTitle } from "./steps";
import { RECORDING_ENDS, SKILL_LIMITS, SKILL_STATUSES, type RecordingEnd, type SkillStatus, type SkillStep, type SkillValue, type YourselfReason } from "./types";

export interface SkillListView {
  id: string;
  /** The workspace it was read in: every write from the tab sends it. */
  organizationId: string;
  agentId: string;
  name: string;
  description: string;
  status: SkillStatus;
  version: number;
  stepCount: number;
  sites: string[];
  /** Its hosts the teammate may not open now (Decision 12), in the order first met. */
  notAllowed: string[];
  lastRunAt: string | null;
  runCount: number;
  recordingEndReason: RecordingEnd | null;
  /** How many routines are made from it (step 5): they go with it when it is deleted. */
  routines: number;
  /** When it will be deleted, its person or teammate gone (Decision 14): orphanedAt plus 30 days, else null. */
  deletesOn: string | null;
  createdAt: string;
}

/** One of the person's own skills as My account lists it (review of step 3, M2): with its teammate's name, a removed one's too ("" when it is not there). */
export type OwnSkillRow = SkillListView & { teammate: string };

export interface SkillStepView {
  id: string;
  kind: SkillStep["kind"];
  title: string;
  /** What it does, with its page (stepFacts). */
  facts: string;
  /** A typing or choosing step's value: asked each time or the person's fixed words; null for any other. */
  value: SkillValue | null;
  /** It keeps words of the page (forgetName can remove them). */
  hasName: boolean;
  /** Its page's picture while it is kept, read only through shotSrc. */
  shot: { id: string; expiresAt: string } | null;
  // Beyond the spec's view (step 3's After Phase 5 entry):
  /** It had a picture that is gone (its 24 hours passed): the editor says pictureGone. */
  pictureGone: boolean;
  /** The title it goes back to when its page's words are removed (steps.ts wordsFreeTitle), for a step with a name; else null. */
  plainTitle: string | null;
  /** A step the person does themselves: why (yourselfLine). */
  reason: YourselfReason | null;
  /** The start step's address, whole (Decision 17: seen whole at review); null for any other. */
  address: string | null;
}

export interface SkillView extends SkillListView {
  startUrl: string | null;
  steps: SkillStepView[];
}

/** A skill's row as the views read it (store.ts SKILL_SELECT's shape). */
export interface SkillRowLike {
  id: string;
  organizationId: string;
  agentId: string;
  name: string;
  description: string;
  status: string;
  version: number;
  steps: unknown;
  stepCount: number;
  sites: unknown;
  startUrl: string | null;
  recordingEndReason: string | null;
  orphanedAt: Date | null;
  lastRunAt: Date | null;
  runCount: number;
  createdAt: Date;
}

const STATUS: ReadonlySet<string> = new Set(SKILL_STATUSES);
const ENDS: ReadonlySet<string> = new Set(RECORDING_ENDS);
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a skill whose person or teammate is gone will be deleted: orphanedAt plus orphanDays (Decision 14). */
export function deletesOnOf(orphanedAt: Date | null | undefined): string | null {
  if (!(orphanedAt instanceof Date) || Number.isNaN(orphanedAt.getTime())) return null;
  return new Date(orphanedAt.getTime() + SKILL_LIMITS.orphanDays * DAY_MS).toISOString();
}

/** Where a step happened, as its facts say it: its page, else its host. */
function pageOf(s: SkillStep): string {
  return s.page || s.site;
}

/**
 * What a step does, as the step editor says it (SKILLS_COPY.FACTS): its
 * kind, its kept words (none when it keeps none) and its page; the start
 * step's whole address (Decision 17: the person sees it whole at review).
 */
export function stepFacts(s: SkillStep): string {
  const F = SKILLS_COPY.FACTS;
  const p = pageOf(s);
  switch (s.kind) {
    case "start":
      return F.start(s.address);
    case "link":
      return F.link(s.name, p);
    case "click":
      return F.click(roleWords(s.role), s.name, p);
    case "type":
      return F.type(s.name, p, s.pressEnter);
    case "choose":
      if (s.via === "suggestion") return F.suggestion(s.name, p);
      if (s.via === "item") return F.item(s.name, p);
      return F.choose(s.name, p);
    case "yourself":
      return F.yourself(s.reason, p);
    case "gap":
      return F.gap;
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** One skill as the Skills tab lists it. `notAllowed` and `routines` come from the route's own reads. */
export function skillListView(row: SkillRowLike, o: { notAllowed: readonly string[]; routines: number }): SkillListView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    name: row.name,
    description: row.description ?? "",
    status: (STATUS.has(row.status) ? row.status : "draft") as SkillStatus,
    version: row.version,
    stepCount: row.stepCount,
    sites: strings(row.sites),
    notAllowed: [...o.notAllowed],
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    runCount: row.runCount,
    recordingEndReason: row.recordingEndReason && ENDS.has(row.recordingEndReason) ? (row.recordingEndReason as RecordingEnd) : null,
    routines: Math.max(0, Math.floor(o.routines)),
    deletesOn: deletesOnOf(row.orphanedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** One step as the step editor shows it. `kept`: the pictures still kept, by id, with when each goes. */
export function stepView(s: SkillStep, kept: ReadonlyMap<string, string>): SkillStepView {
  const expiresAt = s.shotId && shotSrc(s.shotId) ? kept.get(s.shotId) : undefined;
  const named = "name" in s && s.name.length > 0;
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    facts: stepFacts(s),
    value: s.kind === "type" || s.kind === "choose" ? { ...s.value } : null,
    hasName: named,
    shot: s.shotId && expiresAt ? { id: s.shotId, expiresAt } : null,
    pictureGone: Boolean(s.shotId) && !expiresAt,
    plainTitle: named ? wordsFreeTitle(s) : null,
    reason: s.kind === "yourself" ? s.reason : null,
    address: s.kind === "start" ? s.address : null,
  };
}

/** One skill whole, as GET /api/teammate-skills/[id] answers it. */
export function skillView(row: SkillRowLike, o: { notAllowed: readonly string[]; routines: number; kept: ReadonlyMap<string, string> }): SkillView {
  return {
    ...skillListView(row, o),
    startUrl: row.startUrl,
    steps: storedSteps(row.steps).map((s) => stepView(s, o.kept)),
  };
}
