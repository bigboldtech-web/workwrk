// What a teammate's call would do, decided by the server before anything
// runs (docs/plans/ai-teammates.md 3.3, 3.5, 3.7 and 3.13).
//
// prepareCall reads the call's input once and answers, for the person as
// they are now:
//   input      the cleaned, resolved input that runs (a channel name becomes
//              its conversation's id, a List name its id, an email the
//              spelling stored for that person, text without links or pings)
//   the right  the same gate the tool's write path stands behind, checked
//              NOW, so a call the person cannot make fails before anything
//              is proposed, and again at approval (actions.ts re-runs this)
//   risk       the tool's base class, raised by what the input does (a task
//              for someone else, a comment on a task others are on): the
//              escalations of the 3.3 table, never lowered
//   preview    the card: what it does, the exact text, the facts (who reads
//              it, who is told), the undo, the one editable field, and
//              "don't ask again" only where the policy allows it
//   targetKey  the one target a scoped "Don't ask again" names ("conv:<id>")
//
// THE CARD IS THE SERVER'S. It is built from the stored input, never from
// the model's words, and what runs is exactly what it shows: the executor
// stores `input` on the AgentAction and the approval runs that input.
//
// Server-only: reads prisma and the gates.

import { mayEditGoal } from "@/lib/goals/goal-rights";
import { objectHref } from "@/lib/nav/object-href";
import { checkPlanLimit } from "@/lib/plan-limits";
import { prisma } from "@/lib/prisma";
import { canPost } from "@/lib/talk-access";
import { talkGateForUser } from "@/lib/talk-gate";
// The person's legacy level is read only in acting.ts, which hands it to the
// permission matrix, the List helpers and the goal rules.
import { canContributeAs, goalActorFor, isManagerPerson, personMay, type ActingPerson } from "./acting";
import { splitScheduleZone } from "./cron";
import { routineScheduleFrom, routineScheduleProblem, type RoutineScheduleInput } from "./routines";
import { describeSchedule, wordsInZone, zoneName } from "./schedule-words";
import {
  ACTION_VERB,
  APPROVAL_CARD,
  CHANGE_LABELS,
  GOAL_LEVEL_LINES,
  PREVIEW_LINES,
  TEAMMATE_ERRORS,
  TEAMMATE_TOOL_ERRORS as ERR,
  TOOL_PICKER_COPY,
  alreadyInList,
  approveAlwaysIn,
  approveAlwaysInChannel,
  cantPostIn,
  changeLine,
  forPersonTitle,
  kpiUnderLine,
  kraHoldersLine,
  meetingAtLine,
  moveTitle,
  ownerTold,
  peopleCanRead,
  personTold,
  personalListOf,
  placeTitle,
  quotedTitle,
  statusBecomes,
  unknownPerson,
  withPeopleLine,
} from "./teammate-copy";
import type { ActionPreview } from "./teammate-thread";
import {
  TEAMMATE_INPUT,
  appendSection,
  badInput,
  cleanOutwardText,
  editableDocFor,
  gatedTask,
  isOwnNote,
  isPrivateTask,
  isRefusal,
  livePersonByEmail,
  movedStatusLabel,
  talkAudience,
  talkTargetFor,
  targetListFor,
  taskPatchFor,
} from "./teammate-tools";
import { BASE_RISK, EDITABLE_FIELD, alwaysKeyFor, maxRisk, type ApprovalRules, type ToolRisk } from "./tool-policy";
import { isToolName, type ToolName } from "./tool-names";
import { PRECHECK_REFUSALS, toGoalLevel, type TeammateToolContext } from "./tools";

export type { ActionPreview };

export interface PrepareContext {
  /** The person the call acts for, resolved by the caller a moment before (resolveActingPerson). */
  person: ActingPerson;
  teammate: Pick<TeammateToolContext, "agentId" | "agentName" | "trigger">;
  /** The teammate's managers' tightening: a tool they set to "ask" is never offered "don't ask again". */
  agentRules?: ApprovalRules;
}

export type Prepared =
  | { ok: true; tool: ToolName; input: Record<string, unknown>; risk: ToolRisk; preview: ActionPreview; targetKey: string | null }
  /** `detail`: what the model can retry with, as the tool would answer it (the ids of Lists that share a name). */
  | { ok: false; error: string; detail?: Record<string, unknown> };

/** What one tool's preparation found, before the shared fields are added. */
interface Found {
  input: Record<string, unknown>;
  /** What the input makes the call: never below the tool's base. */
  risk?: ToolRisk;
  preview: ActionPreview;
  targetKey?: string | null;
}

/** The longest a subject runs on a card's title line. */
const SUBJECT_MAX = 80;

function short(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SUBJECT_MAX ? `${t.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : t;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function verb(tool: ToolName): string {
  return ACTION_VERB[tool] ?? TOOL_PICKER_COPY[tool].label;
}

/** A title with its subject quoted, or the bare verb when there is no subject. */
function titled(tool: ToolName, subject: string): string {
  return subject ? quotedTitle(verb(tool), short(subject)) : verb(tool);
}

function fail(error: string, detail?: Record<string, unknown>): { ok: false; error: string; detail?: Record<string, unknown> } {
  return detail && Object.keys(detail).length > 0 ? { ok: false, error, detail } : { ok: false, error };
}

/** "Mon 12 Oct, 14:00, Kolkata time": a moment in the person's zone, named. */
function whenWords(at: Date, zone: string): string {
  const p: Record<string, string> = {};
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    // Never hour12:false: some runtimes print midnight as "24".
    hourCycle: "h23",
  }).formatToParts(at);
  for (const part of parts) p[part.type] = part.value;
  // Assembled from the parts, so the words do not move with the runtime's
  // locale data; a runtime that still says "24" means the midnight that starts the day.
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.weekday} ${p.day} ${p.month}, ${hour}:${p.minute}, ${zoneName(zone)}`;
}

/**
 * Prepare one call of `tool` for the person (see the file header). A READ
 * tool passes through as READ. A call the person cannot make answers
 * { ok: false, error } in their words, and nothing may be proposed for it.
 */
export async function prepareCall(tool: string, rawInput: unknown, ctx: PrepareContext): Promise<Prepared> {
  if (!isToolName(tool)) return fail(ERR.notAllowed);
  const raw = rec(rawInput);
  const base = BASE_RISK[tool];
  if (base === "READ") return { ok: true, tool, input: raw, risk: "READ", preview: { title: TOOL_PICKER_COPY[tool].label }, targetKey: null };

  const found = await prepareOne(tool, raw, ctx);
  if ("error" in found) {
    const { error, ...detail } = found as { error: string } & Record<string, unknown>;
    return fail(error, detail);
  }
  const risk = maxRisk(base, found.risk ?? base);
  const targetKey = found.targetKey ?? null;
  const preview: ActionPreview = { ...found.preview };
  const editable = EDITABLE_FIELD[tool];
  if (editable) preview.editable = { ...editable };
  const tightened = ctx.agentRules && Object.prototype.hasOwnProperty.call(ctx.agentRules, tool) && ctx.agentRules[tool] === "ask";
  const alwaysKey = tightened ? null : alwaysKeyFor(tool, risk, targetKey);
  if (alwaysKey) {
    preview.alwaysKey = alwaysKey;
    preview.alwaysLabel ??= APPROVAL_CARD.approveAlways;
  } else {
    delete preview.alwaysLabel;
  }
  return { ok: true, tool, input: found.input, risk, preview, targetKey };
}

async function prepareOne(tool: ToolName, raw: Record<string, unknown>, ctx: PrepareContext): Promise<Found | { error: string }> {
  const { person } = ctx;
  switch (tool) {
    case "update_task": {
      const parsed = TEAMMATE_INPUT.update_task.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      const found = await gatedTask(person, parsed.data.taskId, "edit");
      if (isRefusal(found)) return found;
      const built = await taskPatchFor(found.gate, parsed.data, person);
      if (isRefusal(built)) return built;
      const mine = await isPrivateTask(found.gate, person);
      const outwardOwner = built.newOwner !== null && built.newOwner.id !== person.userId;
      const outward = !mine || outwardOwner;
      const lines = built.changes.map((c) => changeLine(CHANGE_LABELS[c.field], c.value));
      if (outward) {
        if (built.changes.some((c) => c.field === "status")) lines.push(PREVIEW_LINES.statusAudience);
        if (outwardOwner && built.newOwner) lines.push(ownerTold(built.newOwner.name));
        lines.push(PREVIEW_LINES.automations);
      }
      // What runs is what the card shows: the resolved status value (a
      // "done" is already its status), the day and the owner's stored email.
      const input: Record<string, unknown> = { taskId: found.gate.item.id };
      if (typeof built.patch.status === "string") input.status = built.patch.status;
      if (parsed.data.dueDate !== undefined) input.dueDate = parsed.data.dueDate.toLowerCase();
      if (parsed.data.priority !== undefined) input.priority = parsed.data.priority;
      if (built.newOwner) input.assigneeEmail = built.newOwner.email;
      return {
        input,
        risk: outward ? "OUTWARD" : "INTERNAL",
        preview: {
          title: titled(tool, found.gate.item.title),
          lines,
          target: { label: short(found.gate.item.title), href: `/item/${encodeURIComponent(found.gate.item.id)}` },
        },
      };
    }

    case "comment_on_task": {
      const parsed = TEAMMATE_INPUT.comment_on_task.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      const text = cleanOutwardText(parsed.data.text, { talk: false, max: 4000 });
      if (!text) return { error: ERR.emptyText };
      const found = await gatedTask(person, parsed.data.taskId, "comment");
      if (isRefusal(found)) return found;
      const mine = await isPrivateTask(found.gate, person);
      return {
        input: { taskId: found.gate.item.id, text },
        risk: mine ? "INTERNAL" : "OUTWARD",
        preview: {
          title: titled(tool, found.gate.item.title),
          body: text,
          ...(mine ? {} : { lines: [PREVIEW_LINES.commentAudience] }),
          target: { label: short(found.gate.item.title), href: `/item/${encodeURIComponent(found.gate.item.id)}` },
        },
      };
    }

    case "move_task": {
      const parsed = TEAMMATE_INPUT.move_task.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      const found = await gatedTask(person, parsed.data.taskId, "move");
      if (isRefusal(found)) return found;
      // PATCH's other half: Can edit on the List the task leaves, too.
      if (!(await canContributeAs(person, found.gate.item.boardId))) return { error: ERR.cantMoveOut };
      const to = await targetListFor(person, parsed.data);
      if (isRefusal(to)) return to;
      if (to.list.id === found.gate.item.boardId) return { error: alreadyInList(to.list.name) };
      const lines: string[] = [];
      const subtasks = await prisma.item.count({ where: { parentItemId: found.gate.item.id, archivedAt: null } });
      if (subtasks > 0) lines.push(PREVIEW_LINES.subtasksMove);
      const status = movedStatusLabel(found.gate, to.list);
      if (status) lines.push(statusBecomes(status));
      lines.push(PREVIEW_LINES.automations);
      return {
        input: { taskId: found.gate.item.id, listId: to.list.id },
        preview: {
          title: moveTitle(short(found.gate.item.title), short(to.list.name)),
          lines,
          target: { label: short(found.gate.item.title), href: `/item/${encodeURIComponent(found.gate.item.id)}` },
        },
      };
    }

    case "post_in_talk": {
      const parsed = TEAMMATE_INPUT.post_in_talk.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      const talk = await talkGateForUser(person.userId, person.organizationId);
      if (!talk.ok) return { error: talk.reason === "talk_off" ? ERR.talkOff : ERR.personCant };
      const found = await talkTargetFor(person, talk.gate, parsed.data);
      if (isRefusal(found)) return found;
      const t = found.target;
      if (!canPost(t.facts, t.role)) return { error: cantPostIn(t.place) };
      const text = cleanOutwardText(parsed.data.text, { talk: true, max: 3000 });
      if (!text) return { error: ERR.emptyText };
      const audience = await talkAudience(t.id);
      const isPublicChannel = t.type === "CHANNEL" && !t.facts.restricted;
      return {
        input: { conversationId: t.id, text },
        targetKey: `conv:${t.id}`,
        preview: {
          title: placeTitle(verb(tool), t.place),
          body: text,
          lines: [isPublicChannel ? PREVIEW_LINES.anyoneCanOpenChannel : peopleCanRead(audience), PREVIEW_LINES.notifiedBySettings],
          audience,
          target: { label: t.place, href: `/tlk/${encodeURIComponent(t.id)}` },
          alwaysLabel: t.type === "CHANNEL" ? approveAlwaysInChannel(t.name ?? "channel") : approveAlwaysIn(t.place),
        },
      };
    }

    case "update_doc": {
      const parsed = TEAMMATE_INPUT.update_doc.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      const heading = parsed.data.heading ? cleanOutwardText(parsed.data.heading, { talk: false, max: 120 }) : "";
      const text = cleanOutwardText(parsed.data.text, { talk: false, max: 8000 });
      if (!text) return { error: ERR.emptyText };
      const found = await editableDocFor(person, parsed.data.docId);
      if (isRefusal(found)) return found;
      if (!appendSection(found.doc.content, heading || null, text)) return { error: ERR.docFormat };
      const mine = isOwnNote(found.doc, person);
      return {
        input: { docId: found.doc.id, ...(heading ? { heading } : {}), text },
        risk: mine ? "INTERNAL" : "OUTWARD",
        preview: {
          title: titled(tool, found.doc.title),
          body: heading ? `${heading}\n\n${text}` : text,
          ...(mine ? {} : { lines: [PREVIEW_LINES.docAudience] }),
          undo: PREVIEW_LINES.docUndo,
          target: { label: short(found.doc.title), href: objectHref("doc", found.doc.id, "ai") },
        },
      };
    }

    case "remember": {
      const parsed = TEAMMATE_INPUT.remember.safeParse(raw);
      if (!parsed.success) return { error: ERR.memoryEmpty };
      return { input: parsed.data, preview: { title: titled(tool, parsed.data.key), body: parsed.data.value } };
    }

    case "forget": {
      const parsed = TEAMMATE_INPUT.forget.safeParse(raw);
      if (!parsed.success) return badInput(parsed.error);
      return { input: parsed.data, preview: { title: titled(tool, parsed.data.key) } };
    }

    case "create_routine": {
      if (ctx.teammate.trigger === "ROUTINE") return { error: TEAMMATE_ERRORS.routineInRoutine };
      const parsed = TEAMMATE_INPUT.create_routine.safeParse(raw);
      if (!parsed.success) return { error: TEAMMATE_ERRORS.routineInvalid };
      const schedule = routineScheduleFrom(parsed.data.schedule as RoutineScheduleInput, person.timezone);
      if (!schedule) return { error: TEAMMATE_ERRORS.routineInvalid };
      const problem = routineScheduleProblem(schedule);
      if (problem) return { error: problem === "too_often" ? TEAMMATE_ERRORS.routineTooOften : TEAMMATE_ERRORS.routineInvalid };
      const when = wordsInZone(describeSchedule(schedule, true), splitScheduleZone(schedule).zone, person.timezone);
      return { input: parsed.data, preview: { title: titled(tool, parsed.data.name), body: parsed.data.instructions, lines: [when] } };
    }

    case "create_task": {
      const title = str(raw.title).slice(0, 280).trim();
      if (!title) return { error: ERR.taskTitle };
      const email = str(raw.assigneeEmail);
      let forOther: { name: string; email: string } | null = null;
      const input: Record<string, unknown> = { ...raw, title };
      if (email) {
        const who = await livePersonByEmail(person.organizationId, email);
        if (!who) return { error: unknownPerson(email) };
        input.assigneeEmail = who.email;
        if (who.id !== person.userId) forOther = who;
      }
      const description = str(raw.description);
      return {
        input,
        risk: forOther ? "OUTWARD" : "INTERNAL",
        preview: {
          title: forOther ? forPersonTitle(titled(tool, title), forOther.name) : titled(tool, title),
          ...(description ? { body: description } : {}),
          ...(forOther ? { lines: [personalListOf(forOther.name)] } : {}),
        },
      };
    }

    case "create_meeting": {
      if (!(await personMay(person, "meetings", "create"))) return { error: PRECHECK_REFUSALS.meetings };
      const title = str(raw.title);
      if (!title) return { error: PRECHECK_REFUSALS.meetingTitle };
      const when = new Date(String(raw.scheduledAt ?? ""));
      if (Number.isNaN(when.getTime())) return { error: PRECHECK_REFUSALS.meetingTime };
      const asked = Array.isArray(raw.attendeeEmails) ? (raw.attendeeEmails as unknown[]).filter((e): e is string => typeof e === "string" && e.trim().length > 0) : [];
      // Who it adds, as the card names them: live people of this workspace
      // only (the handler drops anyone else), by their stored emails.
      const people: Array<{ id: string; name: string; email: string }> = [];
      for (const e of asked.slice(0, 50)) {
        const who = await livePersonByEmail(person.organizationId, e);
        if (who && !people.some((p) => p.id === who.id)) people.push(who);
      }
      const others = people.filter((p) => p.id !== person.userId);
      const lines = [meetingAtLine(whenWords(when, person.timezone))];
      if (others.length > 0) lines.push(withPeopleLine(others.slice(0, 5).map((p) => p.name), Math.max(0, others.length - 5)));
      const agenda = str(raw.agenda);
      return {
        input: { ...raw, title, attendeeEmails: people.map((p) => p.email) },
        risk: others.length > 0 ? "OUTWARD" : "INTERNAL",
        preview: { title: titled(tool, title), lines, ...(agenda ? { body: agenda } : {}) },
      };
    }

    case "create_okr": {
      // create_okr's own rules (POST /api/okrs's), checked now.
      const title = str(raw.title);
      if (!title) return { error: ERR.goalTitle };
      const level = toGoalLevel(raw.level ?? "INDIVIDUAL");
      const manager = isManagerPerson(person);
      if (!manager && level !== "INDIVIDUAL") return { error: PRECHECK_REFUSALS.goalLevel };
      let owner: { id: string; name: string; email: string } | null = null;
      const ownerEmail = str(raw.ownerEmail);
      if (ownerEmail) {
        owner = await livePersonByEmail(person.organizationId, ownerEmail);
        if (!owner) return { error: unknownPerson(ownerEmail) };
        if (!manager && owner.id !== person.userId) return { error: PRECHECK_REFUSALS.goalOwner };
      }
      const ownerId = owner?.id ?? person.userId;
      if (level === "COMPANY" && !mayEditGoal(await goalActorFor(person), { level: "COMPANY", ownerId, creatorId: person.userId })) {
        return { error: PRECHECK_REFUSALS.goalCompany };
      }
      const forOther = owner !== null && owner.id !== person.userId;
      const lines: string[] = [];
      if (forOther && owner) lines.push(ownerTold(owner.name));
      if (level !== "INDIVIDUAL") lines.push(GOAL_LEVEL_LINES[level]);
      return {
        input: { ...raw, title, level, ...(owner ? { ownerEmail: owner.email } : {}) },
        risk: forOther || level !== "INDIVIDUAL" ? "OUTWARD" : "INTERNAL",
        preview: { title: titled(tool, title), ...(lines.length ? { lines } : {}) },
      };
    }

    case "create_kra": {
      if (!(await personMay(person, "kras", "create"))) return { error: PRECHECK_REFUSALS.kras };
      const name = str(raw.name);
      const roleTitle = str(raw.roleTitle);
      if (!roleTitle) return { error: PRECHECK_REFUSALS.kraNeedsRole };
      const role = await prisma.role.findFirst({
        where: { organizationId: person.organizationId, title: { equals: roleTitle, mode: "insensitive" } },
        select: { id: true, title: true },
      });
      if (!role) return { error: `Role '${roleTitle}' not found in this org` };
      return { input: { ...raw, name, roleTitle: role.title }, preview: { title: titled(tool, name), lines: [kraHoldersLine(role.title)] } };
    }

    case "create_kpi": {
      if (!(await personMay(person, "kras", "create"))) return { error: PRECHECK_REFUSALS.kpis };
      const name = str(raw.name);
      const kraName = str(raw.kraName);
      if (!kraName) return { error: PRECHECK_REFUSALS.kpiNeedsKra };
      const kra = await prisma.kRA.findFirst({
        where: { organizationId: person.organizationId, name: { equals: kraName, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (!kra) return { error: `KRA '${kraName}' not found in this org` };
      return { input: { ...raw, name, kraName: kra.name }, preview: { title: titled(tool, name), lines: [kpiUnderLine(kra.name)] } };
    }

    case "create_sop": {
      if (!(await personMay(person, "sops", "create"))) return { error: PRECHECK_REFUSALS.sops };
      const plan = await checkPlanLimit(person.organizationId, "sops");
      if (!plan.allowed) return { error: plan.message };
      return { input: raw, preview: { title: titled(tool, str(raw.title)) } };
    }

    case "create_workspace": {
      if (!isManagerPerson(person)) return { error: PRECHECK_REFUSALS.workspace };
      return { input: raw, preview: { title: titled(tool, str(raw.name)) } };
    }

    case "send_kudos": {
      const email = str(raw.receiverEmail);
      const message = cleanOutwardText(str(raw.message), { talk: false, max: 500 });
      if (!email || !message) return { error: ERR.kudosMessage };
      const who = await livePersonByEmail(person.organizationId, email);
      if (!who) return { error: unknownPerson(email) };
      if (who.id === person.userId) return { error: ERR.kudosSelf };
      return {
        input: { ...raw, receiverEmail: who.email, message },
        preview: {
          title: placeTitle(verb(tool), who.name),
          body: message,
          lines: [PREVIEW_LINES.kudosAudience, personTold(who.name)],
          target: { label: who.name },
        },
      };
    }

    case "invite_person_with_role": {
      if (!(await personMay(person, "people", "create"))) return { error: PRECHECK_REFUSALS.invite };
      const email = str(raw.email);
      if (!email) return { error: ERR.inviteEmail };
      return {
        input: { ...raw, email },
        preview: { title: placeTitle(verb(tool), email), lines: [PREVIEW_LINES.inviteSent, PREVIEW_LINES.invitePending], target: { label: email } },
      };
    }

    // Something new that only the person sees; each handler holds its own
    // rules (the Tables module, a private form). create_sprint,
    // create_contract and update_contract are TEAMMATE_EXCLUDED: no teammate
    // is given them, so only their title is spelled here.
    case "create_doc":
    case "create_form":
    case "create_data_table":
    case "create_sprint":
    case "create_contract":
      return { input: raw, preview: { title: titled(tool, str(raw.title) || str(raw.name)) } };
    case "update_contract":
      return { input: raw, preview: { title: verb(tool) } };

    default:
      // A READ tool never reaches here (prepareCall passes it through).
      return { input: raw, preview: { title: verb(tool) } };
  }
}
