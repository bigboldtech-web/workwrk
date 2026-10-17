// A person's own skills, as the skill routes read, change and delete them
// (docs/plans/ai-teammates-phase5.md step 3, Decisions 10 to 14, 24, 25 and
// 28), and "Delete every skill" for Owners and Admins.
//
// EVERY READ AND WRITE IS THE VIEWER'S OWN (Decision 25): by their id in
// their workspace, so anyone else's skill, an Owner's request included, is
// not there (404). Owners and Admins delete every skill of the workspace
// without reading any (deleteEverySkill answers a count only).
//
// AN EDIT (Decision 11) runs in one transaction under the person's lock
// (73_040, store.ts SKILL_LOCK_CLASS): the row FOR UPDATE by its id and the
// viewer's own; a recording refuses; the version it read must be the stored
// one (409 skill_changed: a stale tab never writes an old list back); the
// steps through steps.ts editSkill, which keeps only the ids stored, in their
// order, each with only its title, its value and forgetName, every other
// field rebuilt from the stored step; the name unique case aside; `ready`
// turns a draft ready; the version moves on and the sites follow the steps.
// A live browser following this skill keeps its pinned version, so its next
// call drops the skill there (Decision 15, step 4).
//
// WHAT A SKILL'S SITES MAY OPEN IS READ NOW (Decision 12): the teammate's
// own sites within the workspace's lists, by the guard's own verdict
// (sites.ts siteVerdict), never the recording's.
//
// AUDIT ROWS CARRY HOSTS AND COUNTS ONLY (Decision 24): never a skill's
// name, a step's title or a value. Server logs carry codes only.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { computerAgentFrom } from "@/lib/agents/browser-access";
import { plainData } from "@/lib/agents/plain-data";
import { SKILL_AUDIT_COPY, SKILL_ROUTE_ERRORS, SKILL_VALUE_WORDS, SKILLS_COPY, TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { siteHomeAddress, skillsOffered } from "@/lib/browser/config";
import { computerAccess, type ComputerAccess } from "@/lib/browser/sessions";
import { entryBase, siteVerdict } from "@/lib/browser/sites";
import { prisma } from "@/lib/prisma";
import { skillsRefusal, stopRecordingsOf } from "./recorder";
import { editSkill, holdsSensitive, sitesNotAllowed, skillSites, storedSteps, type EditKeep, type TitleProblem } from "./steps";
import { skillsMayBeKept } from "./kept";
import { SKILL_LOCK_CLASS, everySkillOfViewer, ownSkill, skillsOfViewer, type SkillRow } from "./store";
import { SKILL_LIMITS, type SkillStep } from "./types";
import { skillListView, skillView, type OwnSkillRow, type SkillListView, type SkillView } from "./views";

type ViewerLike = { userId: string; organizationId: string };

/** The teammate as the skill routes read it (teammate-server.ts TEAMMATE_SELECT's fields they need). */
export interface SkillTeammate {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  browserSites: unknown;
  toolNames: unknown;
}

/** A database error's code only (the conventions: never its detail, which can hold the row). */
function codeOf(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return err instanceof Error ? err.name : "error";
}

/** A refusal as the routes answer it: `{ error, code }`, with the step and the value's problem where it has one. */
export type SkillRefusal = { ok: false; status: number; code: string; error: string; stepId?: string; problem?: string };

const refusal = (status: number, code: string, error: string, more: { stepId?: string; problem?: string } = {}): SkillRefusal => ({ ok: false, status, code, error, ...more });
const notFound = (): SkillRefusal => refusal(404, "not_found", SKILL_ROUTE_ERRORS.notFound);

// ── Whether this teammate may learn now, and where Teach a skill starts ──

/** Teach a skill's start: a host and its home address as the message sends it (config.ts siteHomeAddress). */
export interface StartSite {
  site: string;
  address: string;
}

export interface SkillsAvailability {
  /** This WorkwrK offers teaching by showing (skillsOffered). */
  offered: boolean;
  /** Skills may be used with this teammate now (Decisions 1, 2 and 4: offered, the computer available, the workspace's switch, the teammate holding use_skill). */
  on: boolean;
  /** Teach a skill is offered: on, the teammate holding open_page too, and at least one start site. */
  canTeach: boolean;
  /** Why Teach a skill is not offered, in its real words (Decision 28), or null. */
  reason: string | null;
}

/**
 * The teammate's start sites (step 3): its effective sites now (sessions.ts
 * computerAccess), each plain host as it is and each wildcard entry as its
 * base host (sites.ts entryBase), kept only when the guard's own verdict
 * lets its home address open under the rules now. Never a "*.".
 */
export function startSitesOf(access: Extract<ComputerAccess, { ok: true }>): StartSite[] {
  const out: StartSite[] = [];
  const seen = new Set<string>();
  for (const entry of access.sites) {
    const host = entryBase(entry);
    if (!host || host.startsWith("*") || seen.has(host)) continue;
    const address = siteHomeAddress(host, access.cfg);
    if (!siteVerdict(address, access.rules).ok) continue;
    seen.add(host);
    out.push({ site: host, address });
  }
  return out;
}

/** Whether a host may be opened now, by the guard's own verdict over its home address (Decision 12). */
function allowedNowOf(access: Extract<ComputerAccess, { ok: true }>): (host: string) => boolean {
  return (host) => siteVerdict(siteHomeAddress(host, access.cfg), access.rules).ok;
}

/** Whether the stored tools hold this one tool. */
function holds(toolNames: unknown, name: string): boolean {
  return Array.isArray(toolNames) && toolNames.includes(name);
}

/**
 * Whether this teammate may learn by showing for the viewer now, read fresh
 * (Decisions 1, 2, 4 and 12), the Teach a skill start sites, and which hosts
 * it may open now (null when that cannot be said: the computer is not
 * available, or the teammate was removed). In order, as the record route
 * reads them (recorder.ts skillsAccess): offered, the computer's access, the
 * workspace's switch, the teammate holding use_skill; then open_page and a
 * start site for Teach a skill. A removed or paused teammate is never on.
 */
export async function skillsAvailabilityFor(organizationId: string, agent: SkillTeammate): Promise<{ availability: SkillsAvailability; startSites: StartSite[]; allowedNow: ((host: string) => boolean) | null }> {
  const offered = skillsOffered();
  if (agent.status === "ARCHIVED") return { availability: { offered, on: false, canTeach: false, reason: null }, startSites: [], allowedNow: null };
  const cagent = computerAgentFrom({ id: agent.id, name: agent.name, status: agent.status, browserSites: agent.browserSites, toolNames: agent.toolNames });
  const access = await computerAccess({ organizationId, agent: cagent });
  // A host is "not allowed now" only where the computer could be used: with no site at all, none is.
  const allowedNow = access.ok ? allowedNowOf(access) : access.reason === "no_sites" ? () => false : null;
  const off = (reason: string | null) => ({ availability: { offered, on: false, canTeach: false, reason }, startSites: [], allowedNow });
  if (!offered) return off(null);
  if (agent.status !== "ENABLED") return off(null);
  if (!access.ok) return off(skillsRefusal(access.reason, agent.name).error);
  if (!access.policy.skillsEnabled) return off(SKILL_ROUTE_ERRORS.skillsOff);
  if (!cagent.learns) return off(SKILL_ROUTE_ERRORS.cantLearn(agent.name));
  if (!holds(agent.toolNames, "open_page")) return { availability: { offered, on: true, canTeach: false, reason: SKILL_ROUTE_ERRORS.cantOpen(agent.name) }, startSites: [], allowedNow };
  const startSites = startSitesOf(access);
  if (startSites.length === 0) return { availability: { offered, on: true, canTeach: false, reason: SKILLS_COPY.noSites }, startSites, allowedNow };
  return { availability: { offered, on: true, canTeach: true, reason: null }, startSites, allowedNow };
}

// ── Reading ─────────────────────────────────────────────────────────

/** How many routines each skill has (step 5 makes them; they go with it, AgentRoutine_skillId_fkey CASCADE). */
async function routineCounts(skillIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skillIds.length === 0) return out;
  const rows = await prisma.agentRoutine.findMany({ where: { skillId: { in: [...skillIds] } }, select: { skillId: true } });
  for (const r of rows) if (r.skillId) out.set(r.skillId, (out.get(r.skillId) ?? 0) + 1);
  return out;
}

function notAllowedOf(row: Pick<SkillRow, "steps">, allowedNow: ((host: string) => boolean) | null): string[] {
  return allowedNow ? sitesNotAllowed(storedSteps(row.steps), allowedNow) : [];
}

/** The viewer's own skills with this teammate, newest first, as the Skills tab lists them. */
export async function listOwnSkills(viewer: ViewerLike, agent: SkillTeammate): Promise<{ skills: SkillListView[]; availability: SkillsAvailability; startSites: StartSite[] }> {
  const [rows, avail] = await Promise.all([skillsOfViewer(viewer, agent.id), skillsAvailabilityFor(viewer.organizationId, agent)]);
  const routines = await routineCounts(rows.map((r) => r.id));
  return {
    skills: rows.map((r) => skillListView(r, { notAllowed: notAllowedOf(r, avail.allowedNow), routines: routines.get(r.id) ?? 0 })),
    availability: avail.availability,
    startSites: avail.startSites,
  };
}

/**
 * Every skill of the viewer's own in this workspace, newest first, each with
 * its teammate's name read by its id (review of step 3, M2): My account's
 * list, reached with AI or the computer off (Decision 13), so a skill can
 * always be seen and deleted by its person. No availability is read (no
 * site is said "not allowed now" here). Nothing is read where no skill can
 * be kept (skills/kept.ts): production, where none ever was.
 */
export async function listEveryOwnSkill(viewer: ViewerLike): Promise<OwnSkillRow[]> {
  if (!(await skillsMayBeKept())) return [];
  const rows = await everySkillOfViewer(viewer);
  if (rows.length === 0) return [];
  const [agents, routines] = await Promise.all([
    prisma.agent.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.agentId))] }, organizationId: viewer.organizationId }, select: { id: true, name: true } }),
    routineCounts(rows.map((r) => r.id)),
  ]);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ ...skillListView(r, { notAllowed: [], routines: routines.get(r.id) ?? 0 }), teammate: names.get(r.agentId) ?? "" }));
}

/** The pictures of these ids still kept, the person's own, with when each goes. */
async function keptShots(viewer: ViewerLike, steps: readonly SkillStep[]): Promise<Map<string, string>> {
  const ids = [...new Set(steps.map((s) => s.shotId).filter((x): x is string => typeof x === "string"))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.teammateBrowserShot.findMany({ where: { id: { in: ids }, userId: viewer.userId, organizationId: viewer.organizationId, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true } });
  return new Map(rows.map((r) => [r.id, r.expiresAt.toISOString()]));
}

/** One skill whole, the viewer's own, with what its teammate may open now; null for anyone else's (Decision 25). */
export async function readOwnSkill(viewer: ViewerLike, id: string): Promise<SkillView | null> {
  const row = await ownSkill(viewer, id);
  if (!row) return null;
  return viewOfRow(viewer, row);
}

async function viewOfRow(viewer: ViewerLike, row: SkillRow): Promise<SkillView> {
  const agent = await prisma.agent.findFirst({ where: { id: row.agentId, organizationId: viewer.organizationId }, select: { id: true, name: true, status: true, organizationId: true, browserSites: true, toolNames: true } });
  const [avail, routines, kept] = await Promise.all([
    agent ? skillsAvailabilityFor(viewer.organizationId, agent) : Promise.resolve(null),
    routineCounts([row.id]),
    keptShots(viewer, storedSteps(row.steps)),
  ]);
  return skillView(row, { notAllowed: notAllowedOf(row, avail?.allowedNow ?? null), routines: routines.get(row.id) ?? 0, kept });
}

// ── Changing ────────────────────────────────────────────────────────

/** A person's words for a skill or what it is for: one line, plain, its runs of white space made one, control and invisible characters gone (the record route's rule). */
export function cleanSkillWords(raw: string): string {
  return plainData(String(raw ?? ""))
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SkillEdit {
  version: number;
  name?: string;
  description?: string;
  steps?: EditKeep[];
  startHome?: true;
  ready?: true;
}

/** A title's refusal in its own words (review of step 3): empty, too long, or holding the words removed. */
function titleWords(p: TitleProblem | undefined): string {
  return p === "empty" ? SKILL_ROUTE_ERRORS.titleNeeded : p === "too_long" ? SKILL_ROUTE_ERRORS.titleTooLong : SKILL_ROUTE_ERRORS.badTitle;
}

/** editSkill's refusal as the route answers it (Decision 28: its real reason). */
function editRefusal(problem: string, stepId: string | undefined, valueProblem: string | undefined, titleProblem?: TitleProblem): SkillRefusal {
  switch (problem) {
    case "unknown_step":
    case "order":
      return refusal(400, "bad_step", SKILL_ROUTE_ERRORS.badStep, { stepId });
    case "start":
      return refusal(400, "bad_step", SKILL_ROUTE_ERRORS.startNeeded, { stepId });
    case "title":
      return refusal(400, "bad_title", titleWords(titleProblem), { stepId });
    case "too_many":
      return refusal(400, "too_many_steps", SKILL_ROUTE_ERRORS.tooManySteps);
    case "value":
      if (valueProblem && Object.prototype.hasOwnProperty.call(SKILL_VALUE_WORDS, valueProblem)) {
        return refusal(400, "bad_value", SKILL_VALUE_WORDS[valueProblem as keyof typeof SKILL_VALUE_WORDS], { stepId, problem: valueProblem });
      }
      return refusal(400, "bad_step", SKILL_ROUTE_ERRORS.badStep, { stepId });
    default:
      return refusal(400, "bad_step", SKILL_ROUTE_ERRORS.noSteps);
  }
}

class EditRefused extends Error {
  constructor(readonly r: SkillRefusal) {
    super(r.code);
  }
}

type Locked = { id: string; agentId: string; status: string; version: number; steps: unknown; name: string; description: string; startUrl: string | null };

/**
 * The person's review or edit of their own skill (see the header). Answers
 * the skill as it is now, or the refusal. The audit row is written after the
 * commit, hosts and counts only.
 */
export async function editOwnSkill(viewer: ViewerLike, id: string, edit: SkillEdit): Promise<{ ok: true; skill: SkillView } | SkillRefusal> {
  if (typeof id !== "string" || !id || id.length > 64) return notFound();
  let name: string | undefined;
  if (edit.name !== undefined) {
    name = cleanSkillWords(edit.name);
    if (!name) return refusal(400, "name_needed", SKILL_ROUTE_ERRORS.nameNeeded);
    if (name.length > SKILL_LIMITS.nameMax) return refusal(400, "invalid", TEAMMATE_ROUTE_ERRORS.invalid);
    // A name the model reads as data (Decision 16) never carries a card number or a code.
    if (holdsSensitive(name)) return refusal(400, "name_sensitive", SKILL_ROUTE_ERRORS.nameSensitive);
  }
  let description: string | undefined;
  if (edit.description !== undefined) {
    description = cleanSkillWords(edit.description);
    if (description.length > SKILL_LIMITS.descriptionMax) return refusal(400, "invalid", TEAMMATE_ROUTE_ERRORS.invalid);
    if (holdsSensitive(description)) return refusal(400, "description_sensitive", SKILL_ROUTE_ERRORS.descriptionSensitive);
  }

  let out: { was: Locked; changed: string[]; nowReady: boolean; steps: SkillStep[] };
  try {
    out = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SKILL_LOCK_CLASS}::int, hashtext(${viewer.userId}))`;
      const rows = await tx.$queryRaw<Locked[]>`
        SELECT "id", "agentId", "status", "version", "steps", "name", "description", "startUrl" FROM "TeammateSkill"
         WHERE "id" = ${id} AND "userId" = ${viewer.userId} AND "organizationId" = ${viewer.organizationId} FOR UPDATE`;
      const was = rows[0];
      if (!was) throw new EditRefused(notFound());
      if (was.status === "recording") throw new EditRefused(refusal(409, "still_recording", SKILL_ROUTE_ERRORS.stillRecording));
      if (Number(was.version) !== edit.version) throw new EditRefused(refusal(409, "skill_changed", SKILL_ROUTE_ERRORS.changed));

      const stored = storedSteps(was.steps);
      let steps = stored;
      const changed: string[] = [];
      if (edit.steps !== undefined || edit.startHome === true) {
        // No steps sent with startHome: every stored step kept as it is.
        const keep: EditKeep[] = edit.steps ?? stored.map((s) => ({ id: s.id }));
        const r = editSkill(stored, keep, edit.startHome === true ? { startHome: true } : {});
        if (!r.ok) throw new EditRefused(editRefusal(r.problem, r.stepId, r.valueProblem, r.titleProblem));
        if (JSON.stringify(r.steps) !== JSON.stringify(stored)) changed.push("steps");
        steps = r.steps;
      }
      const nowReady = edit.ready === true && was.status === "draft";
      if (edit.ready === true) {
        if (steps.length > SKILL_LIMITS.stepsMax) throw new EditRefused(refusal(400, "too_many_steps", SKILL_ROUTE_ERRORS.tooManySteps));
        if (!steps.some((s) => s.kind !== "start" && s.kind !== "gap")) throw new EditRefused(refusal(400, "no_steps", SKILL_ROUTE_ERRORS.noSteps));
      }
      if (name !== undefined && name !== was.name) {
        // One name per person and teammate, case aside (use_skill finds it by name, Decision 10).
        const [c] = await tx.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS "n" FROM "TeammateSkill"
           WHERE "userId" = ${viewer.userId} AND "agentId" = ${was.agentId} AND lower("name") = lower(${name}) AND "id" <> ${id}`;
        if (Number(c?.n ?? 0) > 0) throw new EditRefused(refusal(409, "name_taken", SKILL_ROUTE_ERRORS.nameTaken));
        changed.push("name");
      }
      if (description !== undefined && description !== was.description) changed.push("description");
      if (nowReady) changed.push("ready");
      if (changed.length === 0) return { was, changed, nowReady, steps };

      const startStep = steps.find((s) => s.kind === "start");
      const data: Prisma.TeammateSkillUpdateManyMutationInput = {
        version: Number(was.version) + 1,
        updatedAt: new Date(),
        ...(changed.includes("steps") ? { steps: steps as unknown as Prisma.InputJsonValue, stepCount: steps.length, sites: skillSites(steps), ...(startStep && startStep.kind === "start" ? { startUrl: startStep.address } : {}) } : {}),
        ...(name !== undefined && changed.includes("name") ? { name } : {}),
        ...(description !== undefined && changed.includes("description") ? { description } : {}),
        ...(nowReady ? { status: "ready" } : {}),
      };
      const w = await tx.teammateSkill.updateMany({ where: { id, userId: viewer.userId, organizationId: viewer.organizationId, version: Number(was.version) }, data });
      if (w.count !== 1) throw new EditRefused(refusal(409, "skill_changed", SKILL_ROUTE_ERRORS.changed));
      return { was, changed, nowReady, steps };
    });
  } catch (err) {
    if (err instanceof EditRefused) return err.r;
    // The name index's own refusal, a second save with that name at the same moment.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return refusal(409, "name_taken", SKILL_ROUTE_ERRORS.nameTaken);
    console.error(`[skills] edit ${codeOf(err)}`);
    throw err;
  }

  if (out.changed.length > 0) {
    const sites = skillSites(out.steps);
    await logActivity({
      type: out.nowReady ? "teammate_skill.saved" : "teammate_skill.changed",
      actorId: viewer.userId,
      actingForId: viewer.userId,
      organizationId: viewer.organizationId,
      description: out.nowReady ? SKILL_AUDIT_COPY.saved(out.steps.length, sites.join(", ")) : SKILL_AUDIT_COPY.changed(out.steps.length),
      targetId: out.was.agentId,
      targetType: "agent",
      // Hosts, counts and which parts changed: never a name, a title or a value (Decision 24).
      metadata: { skillId: id, agentId: out.was.agentId, steps: out.steps.length, sites, changed: out.changed, version: Number(out.was.version) + 1 },
      severity: "info",
    }).catch((err) => console.error(`[skills] edit audit ${codeOf(err)}`));
  }
  const now = await ownSkill(viewer, id);
  if (!now) return notFound();
  return { ok: true, skill: await viewOfRow(viewer, now) };
}

// ── Deleting ────────────────────────────────────────────────────────

/**
 * The person deletes their own skill (Decision 14): its routines go with it
 * (AgentRoutine_skillId_fkey CASCADE) and a browser following it forgets it
 * (ON DELETE SET NULL). A recording is not deleted here: Discard in the
 * browser card ends it (409 still_recording).
 */
export async function deleteOwnSkill(viewer: ViewerLike, id: string): Promise<{ ok: true } | SkillRefusal> {
  const row = await ownSkill(viewer, id);
  if (!row) return notFound();
  if (row.status === "recording") return refusal(409, "still_recording", SKILL_ROUTE_ERRORS.stillRecording);
  const gone = await prisma.teammateSkill.deleteMany({ where: { id: row.id, userId: viewer.userId, organizationId: viewer.organizationId, status: { not: "recording" } } });
  if (gone.count !== 1) return notFound();
  const steps = storedSteps(row.steps);
  await logActivity({
    type: "teammate_skill.deleted",
    actorId: viewer.userId,
    actingForId: viewer.userId,
    organizationId: viewer.organizationId,
    description: SKILL_AUDIT_COPY.deleted,
    targetId: row.agentId,
    targetType: "agent",
    metadata: { skillId: row.id, agentId: row.agentId, steps: steps.length, sites: skillSites(steps) },
    severity: "info",
  }).catch((err) => console.error(`[skills] delete audit ${codeOf(err)}`));
  return { ok: true };
}

/** One statement of "Delete every skill" deletes at most this many. */
export const DELETE_ALL_BATCH = 1000;
/** And it runs at most this many statements (200,000 skills; a workspace holds at most 50 a person). */
const DELETE_ALL_STATEMENTS_MAX = 200;

/**
 * Every skill in the workspace deleted, unseen (Decision 14, Owners and
 * Admins): recordings in progress stopped first, deleting what they
 * recorded rather than keeping it (recorder.ts stopRecordingsOf with `keep`
 * false: a "kept as a draft" line would be untrue a moment later), then
 * DELETE_ALL_BATCH rows a statement, by "TeammateSkill_organizationId_idx",
 * until none is left (their routines cascade). Nothing about any skill is
 * read or answered: a count only.
 */
export async function deleteEverySkill(organizationId: string): Promise<number> {
  await stopRecordingsOf(organizationId, "skills_off", { keep: false }).catch((err) => console.error(`[skills] delete all, recordings not stopped ${codeOf(err)}`));
  let total = 0;
  for (let i = 0; i < DELETE_ALL_STATEMENTS_MAX; i += 1) {
    const n = await prisma.$executeRaw`
      DELETE FROM "TeammateSkill" WHERE "id" IN (SELECT "id" FROM "TeammateSkill" WHERE "organizationId" = ${organizationId} LIMIT ${DELETE_ALL_BATCH})`;
    total += Number(n);
    if (Number(n) === 0) break;
  }
  return total;
}

