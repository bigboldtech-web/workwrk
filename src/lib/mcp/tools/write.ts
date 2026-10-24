// The eight write tools (docs/plans/mcp-server.md 4.1, 4.3, Decisions 8,
// 11 and 19): their contracts and their bodies.
//
// EACH RUNS THE APP'S OWN BODY, AS THE PERSON, INSIDE THE CONNECTION'S
// WORKSPACE, so a refusal is the route's own:
//   create_task      createItemAs (POST /api/boards/[id]/items), once for
//                    the task and once for each subtask, in order
//   update_task      updateTaskAs (the teammate's body: gatedTask edit,
//                    taskPatchFor, patchItemAs)
//   move_task        moveTaskAs (gatedTask move, targetListFor, patchItemAs)
//   add_comment      commentOnTaskAs (gatedTask comment, postItemCommentAs)
//   create_doc       createDocAs (POST /api/docs)
//   append_to_doc    appendToDocAs (editableDocFor, saveDocAs), never a doc
//                    on a colleague's Personal list (noOthersPersonal)
//   create_reminder  createReminderFor (POST /api/reminders, with its task gate)
//   give_kudos       giveKudos (the kudos wall's rules)
// Every id is looked up in the connection's workspace only. Other people's
// Personal lists and the hidden system Lists are never a place to write
// (list_lists shows neither), and a task on a colleague's Personal list is
// written only by its owner or an assignee (the task searches' rule).
//
// THE ANSWER IS NEVER AN ERROR ONCE SOMETHING WAS MADE (step 3 review, M2):
// each body tells the registry what it has made as it goes (call.made), a
// create's answer shrinks to fit, and its subtasks' own failures are
// reported with it. A route's failure is answered in our words, never with
// its exception's message.
//
// NOTHING IS EVER DELETED (Decision 11). A description is only added to
// (appendToDescription, under a version check, expectDescription), or set
// when it is empty; people can be assigned only to a task in a List; tags
// are matched by name and never made; a doc with no place goes to the
// person's own Notepad. Every title, description, comment, doc line,
// section, reminder note and kudos message goes through cleanOutwardText,
// so a link reads as its words.
//
// update_task and move_task carry destructiveHint true (review M6): one
// changes what others see in place, the other moves a task out of a List.
//
// Each answer says what it changed (effect): the registry counts the
// changes, writes the audit row, and remembers a creating write's answer
// for a retry (dedupe.ts).
//
// Server-only (the bodies read prisma).

import { getBoardStatuses } from "@/lib/board-items-shared";
import { statusOptionNamed } from "@/lib/agents/tools";
import {
  appendToDocAs,
  cleanOutwardText,
  commentOnTaskAs,
  isRefusal,
  livePersonByEmail,
  moveTaskAs,
  tagsNamed,
  updateTaskAs,
  type AppWriteOptions,
  type TaskPatchExtras,
  type UpdateTaskInput,
} from "@/lib/agents/teammate-tools";
import { statusesSentence } from "@/lib/agents/teammate-copy";
import type { ActingPerson } from "@/lib/agents/acting";
import { localDayIso, zonedIso } from "@/lib/item-date";
import { prisma } from "@/lib/prisma";
import { isSystemBoard, isSystemItemType } from "@/lib/system-items";
import { cutText } from "../data";
import { MCP_FIELD_COPY as F, MCP_SUMMARY_COPY as S, MCP_TOOL_COPY } from "../mcp-copy";
import { MAX_DOC_BLOCKS, markdownToBlocks } from "../markdown-blocks";
import { docOnOthersPersonal, isOthersPersonalList, taskOnOthersPersonal } from "../personal-lists";
import { fixed, refused, type McpTool, type ToolAnnotations, type ToolAnswer } from "../tool-types";
import { appUrl, taskShapes } from "./read";
import {
  BOOL,
  DAY,
  DAY_OR_NONE,
  EMAIL,
  ID,
  NAMED_OR_NULL,
  PERSON,
  PRIORITY,
  STR,
  STR_OR_NULL,
  TASK,
  input,
  output,
} from "./schemas";

const R = MCP_TOOL_COPY.refusals;

// The write paths, loaded on first use, as the read tools load the gates,
// each imported once and its promise kept, as teammate-tools.ts keeps its own
// (concurrent calls share one import).
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
}
const acting = once(() => import("@/lib/agents/acting"));
const itemGate = once(() => import("@/lib/item-gate"));
const itemCreate = once(() => import("@/lib/items/item-create"));
const docCreate = once(() => import("@/lib/docs/doc-create"));
const reminderCreate = once(() => import("@/lib/reminders/create"));
const kudosGive = once(() => import("@/lib/kudos-give"));
const boards = once(() => import("@/lib/board"));

const WRITE = (o: Partial<ToolAnnotations> = {}): ToolAnnotations => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });

const TASK_REF = () => output({ id: STR(), title: STR(), url: STR() });

// ── Shared ──

/** Text we write, links reduced to their words (cleanOutwardText), never "@" taken out (nothing here is Talk). */
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? cleanOutwardText(v, { talk: false, max }) : "";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

/** A route's answer, read once. */
async function answer(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body: body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

/** A real calendar day, YYYY-MM-DD (never the 30th of February). */
function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** A day as midnight in the person's zone (4.2 Dates), the way the app stores a due day; null when it is no day. */
function dayIso(day: string, p: ActingPerson): string | null {
  return isDay(day) ? localDayIso(day, { timezone: p.timezone }) : null;
}

/** The person as the item routes take a caller. */
async function itemCtxOf(p: ActingPerson) {
  return (await acting()).itemCtxFor(p);
}

/**
 * A task of this workspace that is a task (never the product's own Items, a
 * meeting's), as every task tool takes it. A task on somebody else's
 * Personal list is theirs: only its owner or an assignee may write to it
 * here, the rule the task searches read by (step 3 review, low 6).
 */
async function isTaskHere(p: ActingPerson, taskId: string): Promise<{ id: string; title: string } | null> {
  const row = await prisma.item.findFirst({
    where: { id: taskId, organizationId: p.organizationId },
    select: { id: true, title: true, itemType: true, boardId: true, ownerId: true, assigneeIds: true },
  });
  if (!row || isSystemItemType(row.itemType)) return null;
  // The one Personal list rule every tool asks (personal-lists.ts).
  if (await taskOnOthersPersonal(p, row)) return null;
  return { id: row.id, title: row.title };
}

/**
 * How every body runs for an app (teammate-tools.ts AppWriteOptions): a
 * route's own failure never passes on its exception's message (low 13), a
 * value the task already holds is not written again (low 9), and the hidden
 * system Lists are never a place (low 5). A tag change keeps the task's
 * archived tags for every caller (board-items.ts syncItemTags, low 2).
 */
const APP: AppWriteOptions = { failure: R.notSaved, onlyChanges: true, noSystemLists: true, noOthersPersonal: true };

/** A TASK row (4.2) from what a write already knows, for an answer when the task cannot be read back. */
function knownTask(t: { id: string; title: string; listId: string; personal: boolean; parentTaskId?: string | null }) {
  return {
    id: t.id, title: t.title, status: null, done: false, priority: null, dueDate: null, startDate: null,
    list: { id: t.listId, name: "", personal: t.personal }, owner: null, assignees: [], parentTaskId: t.parentTaskId ?? null,
    url: appUrl(`/item/${encodeURIComponent(t.id)}`),
  };
}

/** People by email, live in this workspace, or the email nobody has. */
async function peopleByEmail(p: ActingPerson, emails: readonly string[]): Promise<{ ids: string[] } | { unknown: string }> {
  const ids: string[] = [];
  for (const email of emails) {
    const who = await livePersonByEmail(p.organizationId, email);
    if (!who) return { unknown: email };
    if (!ids.includes(who.id)) ids.push(who.id);
  }
  return { ids };
}

const TASK_ROW_SELECT = { id: true, title: true, status: true, priority: true, dueAt: true, startAt: true, ownerId: true, assigneeIds: true, boardId: true, parentItemId: true } as const;

/** Tasks as the TASK rows of 4.2, read back after the write, in the order given. */
async function tasksAfter(p: ActingPerson, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.item.findMany({ where: { id: { in: [...ids] }, organizationId: p.organizationId }, select: TASK_ROW_SELECT });
  const shapes = new Map((await taskShapes(rows, p)).map((t) => [t.id, t]));
  return ids.map((id) => shapes.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
}

function taskRef(t: { id: string; title: string }) {
  return { id: t.id, title: t.title, url: appUrl(`/item/${encodeURIComponent(t.id)}`) };
}

/** A teammate body's refusal, its sentence and any detail (the Lists one name matched). */
function refusalOf(r: { error: string } & Record<string, unknown>): ToolAnswer {
  const { error, ...detail } = r;
  return refused(error, detail);
}

const DEDUPE_ALWAYS = () => true;

const createTask: McpTool = {
  name: "create_task",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 280 },
      description: { type: "string", maxLength: 10000 },
      listId: ID(F.listId),
      parentTaskId: ID(F.taskId),
      status: { type: "string", maxLength: 60, description: F.status },
      priority: PRIORITY(),
      dueDate: DAY(),
      startDate: DAY(),
      assigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
      subtasks: {
        type: "array",
        maxItems: 25,
        items: input(
          {
            title: { type: "string", minLength: 1, maxLength: 280 },
            dueDate: DAY(),
            assigneeEmails: { type: "array", items: EMAIL(), maxItems: 5 },
          },
          ["title"],
        ),
      },
    },
    ["title"],
  ),
  outputSchema: output({
    task: TASK(),
    // Each a TASK row, or, in a shortened answer, its id, title and url, or its id alone (subtasksShortened).
    subtasks: { type: "array", items: { type: "object", properties: TASK().properties, required: ["id"] } },
    failedSubtasks: { type: "array", items: output({ title: STR(), reason: STR() }) },
    subtasksShortened: BOOL(),
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  cost: (inp) => 1 + (Array.isArray(inp.subtasks) ? inp.subtasks.length : 0),
  run: async (call, inp) => {
    const p = call.person;
    const listId = str(inp.listId);
    const parentId = str(inp.parentTaskId);
    if (listId && parentId) return refused(R.listAndParent);
    const title = clean(inp.title, 280);
    if (!title) return refused(R.emptyTitle);
    const description = clean(inp.description, 10000);

    // 1. The home List: the listId, else the parent's List, else the person's own Personal list.
    const home = await homeListFor(p, listId, parentId);
    if ("reason" in home) return refused(home.reason);
    const statuses = getBoardStatuses(home);

    // 2. People, only in a List; with none, the List's defaults choose (createItemAs).
    const emails = strings(inp.assigneeEmails);
    if (emails.length && home.personal) return refused(R.assigneesNeedList);
    const people = await peopleByEmail(p, emails);
    if ("unknown" in people) return refused(R.unknownPerson(people.unknown));

    // 3. The status, a name on that List, matched as update_task matches one.
    let status: string | undefined;
    const statusName = str(inp.status);
    if (statusName) {
      const opt = statusOptionNamed(statuses, statusName);
      if (!opt) return refused(statusesSentence(statuses.map((o) => o.label)));
      status = opt.value;
    }

    // 4. Tags, matched by name, never made.
    const tagNames = strings(inp.tags);
    const tags = await tagsNamed(p.organizationId, tagNames);
    if (tags.unknown.length) return refused(R.unknownTags(tags.unknown));
    const tagIds = [...new Set(tagNames.map((n) => tags.byName.get(n)).filter((x): x is string => !!x))];

    // 5. The days, midnight in the person's zone.
    const dueAt = str(inp.dueDate) ? dayIso(String(inp.dueDate), p) : undefined;
    if (dueAt === null) return refused(R.badDay("dueDate"));
    const startAt = str(inp.startDate) ? dayIso(String(inp.startDate), p) : undefined;
    if (startAt === null) return refused(R.badDay("startDate"));

    // 6. The task, through the create route's own body.
    const { createItemAs } = await itemCreate();
    const c = await itemCtxOf(p);
    const made = await answer(
      await createItemAs(c, home.id, {
        title,
        ...(status ? { status } : {}),
        ...(typeof inp.priority === "string" ? { priority: inp.priority } : {}),
        ...(dueAt ? { dueAt } : {}),
        ...(startAt ? { startAt } : {}),
        ...(people.ids.length ? { assigneeIds: people.ids } : {}),
        ...(tagIds.length ? { tagIds } : {}),
        ...(description ? { metadata: { description } } : {}),
        ...(parentId ? { parentItemId: parentId } : {}),
      }),
    );
    const taskId = made.status === 201 ? idOf(made.body.item) : null;
    if (!taskId) return refused(createRefusal(made));

    // From here on the task exists: every step says what has been made
    // (call.made), each subtask's own failure is reported with it, and the
    // answer never becomes an error (review M2).
    const subs = Array.isArray(inp.subtasks) ? (inp.subtasks as Array<Record<string, unknown>>) : [];
    const subtaskIds: Array<{ id: string; title: string }> = [];
    const failedSubtasks: Array<{ title: string; reason: string }> = [];
    const titleOf = (sub: Record<string, unknown>) => {
      const raw = typeof sub.title === "string" ? sub.title : "";
      return clean(raw, 280) || raw.trim().slice(0, 280);
    };
    const effect = () => ({
      target: { type: "item" as const, id: taskId },
      touched: [`item:${taskId}`, ...subtaskIds.map((t) => `item:${t.id}`), ...(parentId ? [`item:${parentId}`] : [])],
      changes: 1 + subtaskIds.length,
    });
    const soFar = (from: number) =>
      call.made({
        effect: effect(),
        payload: {
          task: knownTask({ id: taskId, title, listId: home.id, personal: home.personal, parentTaskId: parentId }),
          subtasks: subtaskIds.map((t) => ({ id: t.id, title: t.title, url: appUrl(`/item/${encodeURIComponent(t.id)}`) })),
          failedSubtasks: [...failedSubtasks, ...subs.slice(from).map((sub) => ({ title: titleOf(sub), reason: R.notSaved }))],
          subtasksShortened: true,
          duplicate: false,
        },
      });
    soFar(0);

    // 7. Each subtask in order, under the task on its List, while the day's changes allow; one that fails is reported, the rest still made.
    for (const [i, sub] of subs.entries()) {
      const subTitle = clean(typeof sub.title === "string" ? sub.title : "", 280);
      const failed = (reason: string) => failedSubtasks.push({ title: titleOf(sub), reason });
      if (1 + subtaskIds.length >= call.allowance) failed(MCP_TOOL_COPY.errors.dailyCap);
      else if (!subTitle) failed(R.emptyTitle);
      else {
        try {
          const subEmails = strings(sub.assigneeEmails);
          const subPeople = subEmails.length && home.personal ? null : await peopleByEmail(p, subEmails);
          const subDue = str(sub.dueDate) ? dayIso(String(sub.dueDate), p) : undefined;
          if (!subPeople) failed(R.assigneesNeedList);
          else if ("unknown" in subPeople) failed(R.unknownPerson(subPeople.unknown));
          else if (subDue === null) failed(R.badDay("dueDate"));
          else {
            const res = await answer(
              await createItemAs(c, home.id, {
                title: subTitle,
                ...(subDue ? { dueAt: subDue } : {}),
                ...(subPeople.ids.length ? { assigneeIds: subPeople.ids } : {}),
                parentItemId: taskId,
              }),
            );
            const subId = res.status === 201 ? idOf(res.body.item) : null;
            if (subId) subtaskIds.push({ id: subId, title: subTitle });
            else failed(createRefusal(res));
          }
        } catch {
          console.warn("[mcp] create_task subtask_failed");
          failed(R.notSaved);
        }
      }
      soFar(i + 1);
    }

    // The rows as saved; should they not read back, what is known of them.
    let shapes: Awaited<ReturnType<typeof tasksAfter>>;
    try {
      shapes = await tasksAfter(p, [taskId, ...subtaskIds.map((t) => t.id)]);
    } catch {
      console.warn("[mcp] create_task read_back_failed");
      shapes = [];
    }
    const byId = new Map(shapes.map((t) => [t.id, t]));
    const task = byId.get(taskId) ?? knownTask({ id: taskId, title, listId: home.id, personal: home.personal, parentTaskId: parentId });
    const subtasks = subtaskIds.map((t) => byId.get(t.id) ?? knownTask({ id: t.id, title: t.title, listId: home.id, personal: home.personal, parentTaskId: taskId }));
    const done = effect();
    return {
      kind: "data",
      // The answer shrinks to fit (review M2): the subtasks as their id, title and url, then as ids, with titles cut.
      build: (step) => {
        if (step === 0) return { task, subtasks, failedSubtasks, subtasksShortened: false, duplicate: false };
        if (step === 1) {
          return {
            task,
            subtasks: subtasks.map((t) => ({ id: t.id, title: t.title, url: t.url })),
            failedSubtasks: failedSubtasks.map((f) => ({ title: cutText(f.title, 80).text, reason: f.reason })),
            subtasksShortened: true,
            duplicate: false,
          };
        }
        if (step === 2) {
          return {
            task: { ...task, title: cutText(task.title, 80).text },
            subtasks: subtasks.map((t) => ({ id: t.id })),
            failedSubtasks: failedSubtasks.map((f) => ({ title: cutText(f.title, 40).text, reason: f.reason })),
            subtasksShortened: true,
            duplicate: false,
          };
        }
        return null;
      },
      summary: (payload) => {
        const base = S.taskCreated(subtaskIds.length, failedSubtasks.length);
        return payload.subtasksShortened ? `${base} ${S.shortened}` : base;
      },
      effect: done,
    };
  },
};

function idOf(item: unknown): string | null {
  const id = item && typeof item === "object" ? (item as { id?: unknown }).id : null;
  return typeof id === "string" && id ? id : null;
}

/**
 * The create route's refusal, in words: its List not found, or not one to
 * add to. Anything else (its only free text is an exception's own message,
 * never passed on: review low 13) is the plain failure, which says to check
 * WorkwrK, as the route can fail after the task was saved.
 */
function createRefusal(res: { status: number; body: Record<string, unknown> }): string {
  if (res.status === 404) return R.listNotFound;
  if (res.status === 403) return R.cantAddToList;
  return R.notSaved;
}

/**
 * Where a new task goes, as the person may add to it: a List of this
 * workspace they can open (never somebody else's Personal list), the List of
 * a parent task they can open and add to, or their own Personal list.
 * createItemAs then asks the List's contribute check, as the route does.
 */
async function homeListFor(
  p: ActingPerson,
  listId: string | undefined,
  parentId: string | undefined,
): Promise<{ id: string; statuses: unknown; personal: boolean } | { reason: string }> {
  const select = { id: true, statuses: true, productSlug: true, ownerId: true, settings: true, itemType: true } as const;
  const othersPersonal = (b: { productSlug: string | null; ownerId: string | null }) => isOthersPersonalList(b, p.userId);
  if (parentId) {
    const [{ gateItem }, c] = await Promise.all([itemGate(), itemCtxOf(p)]);
    const gate = await gateItem(parentId, c, "view");
    if ("error" in gate || gate.item.organizationId !== p.organizationId || isSystemItemType(gate.item.itemType)) return { reason: R.taskNotFound };
    const board = await prisma.board.findFirst({ where: { id: gate.item.boardId, organizationId: p.organizationId }, select });
    if (!board || othersPersonal(board)) return { reason: R.taskNotFound };
    // A subtask is added to the parent's List (founder decision 3): Can edit there.
    if (!gate.canAddToList) return { reason: R.cantAddToList };
    return { id: board.id, statuses: board.statuses, personal: board.productSlug === "personal-list" };
  }
  if (listId) {
    const { canReadListAs } = await acting();
    const board = await prisma.board.findFirst({ where: { id: listId, organizationId: p.organizationId, archivedAt: null }, select });
    if (!board || othersPersonal(board) || isSystemBoard(board) || !(await canReadListAs(p, board.id))) return { reason: R.listNotFound };
    return { id: board.id, statuses: board.statuses, personal: board.productSlug === "personal-list" };
  }
  const { getOrCreatePersonalBoard } = await boards();
  const board = await getOrCreatePersonalBoard(p.organizationId, p.userId);
  return { id: board.id, statuses: board.statuses, personal: true };
}

const updateTask: McpTool = {
  name: "update_task",
  scope: "write",
  inputSchema: input(
    {
      taskId: ID(F.taskId),
      title: { type: "string", minLength: 1, maxLength: 280 },
      appendToDescription: { type: "string", minLength: 1, maxLength: 4000 },
      status: { type: "string", maxLength: 60, description: F.status },
      done: BOOL(),
      priority: { type: "string", enum: ["URGENT", "HIGH", "NORMAL", "LOW", "none"] },
      dueDate: DAY_OR_NONE(),
      startDate: DAY_OR_NONE(),
      addAssigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      removeAssigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      addTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
      removeTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
    },
    ["taskId"],
  ),
  outputSchema: output({ task: TASK(), changed: { type: "array", items: STR() } }),
  annotations: WRITE({ destructiveHint: true }),
  // Only an append-only call is a retry when repeated (4.6): every other field sets a value. An empty list
  // changes nothing, as `changed` reads it, so it never makes an append a setting call (final review, contract L2).
  dedupe: (inp) =>
    Object.keys(inp).every((k) => k === "taskId" || k === "appendToDescription" || inp[k] === undefined || (Array.isArray(inp[k]) && (inp[k] as unknown[]).length === 0)) &&
    inp.appendToDescription !== undefined,
  run: async (call, inp) => {
    const p = call.person;
    const taskId = String(inp.taskId);
    if (inp.status !== undefined && inp.done !== undefined) return refused(R.statusAndDone);
    const changed = [...new Set(UPDATE_FIELDS.filter(([k]) => inp[k] !== undefined && !(Array.isArray(inp[k]) && (inp[k] as unknown[]).length === 0)).map(([, name]) => name))];
    if (changed.length === 0) return refused(R.nothingToChange);
    if (!(await isTaskHere(p, taskId))) return refused(R.taskNotFound);
    const change: UpdateTaskInput & TaskPatchExtras = {
      taskId,
      ...(typeof inp.status === "string" ? { status: inp.status.trim() } : {}),
      ...(typeof inp.done === "boolean" ? { done: inp.done } : {}),
      ...(typeof inp.priority === "string" ? { priority: inp.priority as UpdateTaskInput["priority"] } : {}),
      ...(typeof inp.dueDate === "string" ? { dueDate: inp.dueDate } : {}),
      ...(typeof inp.title === "string" ? { title: inp.title } : {}),
      ...(typeof inp.startDate === "string" ? { startDate: inp.startDate } : {}),
      ...(typeof inp.appendToDescription === "string" ? { appendToDescription: inp.appendToDescription } : {}),
      addAssigneeEmails: strings(inp.addAssigneeEmails),
      removeAssigneeEmails: strings(inp.removeAssigneeEmails),
      addTags: strings(inp.addTags),
      removeTags: strings(inp.removeTags),
    };
    const done = await updateTaskAs(p, change, APP);
    if (isRefusal(done)) return refusalOf(done);
    const it = done.gate.item;
    const known = knownTask({ id: it.id, title: typeof done.item.title === "string" ? done.item.title : it.title, listId: it.boardId, personal: false, parentTaskId: it.parentItemId });
    // The task already held every value asked: nothing written, nothing counted (review low 9).
    const effect = done.unchanged
      ? { target: { type: "item" as const, id: it.id }, touched: [], changes: 0 }
      : { target: { type: "item" as const, id: it.id }, touched: [`item:${it.id}`], changes: 1 };
    if (!done.unchanged) call.made({ effect, payload: { task: known, changed } });
    const [task] = await tasksAfter(p, [it.id]).catch(() => [known]);
    return fixed({ task: task ?? known, changed: done.unchanged ? [] : changed }, done.unchanged ? S.taskUnchanged : S.taskUpdated, effect);
  },
};

/** update_task's fields, and the name each change goes by in `changed`. */
const UPDATE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["title", "title"],
  ["status", "status"],
  ["done", "status"],
  ["priority", "priority"],
  ["dueDate", "dueDate"],
  ["startDate", "startDate"],
  ["appendToDescription", "description"],
  ["addAssigneeEmails", "assignees"],
  ["removeAssigneeEmails", "assignees"],
  ["addTags", "tags"],
  ["removeTags", "tags"],
];

const moveTask: McpTool = {
  name: "move_task",
  scope: "write",
  inputSchema: input({ taskId: ID(F.taskId), listId: ID(F.listId), listName: { type: "string", minLength: 1, maxLength: 200 } }, ["taskId"]),
  outputSchema: output({ task: TASK_REF(), list: output({ id: STR(), name: STR() }), status: STR_OR_NULL() }),
  annotations: WRITE({ destructiveHint: true, idempotentHint: true }),
  run: async (call, inp) => {
    const p = call.person;
    const taskId = String(inp.taskId);
    if (!(await isTaskHere(p, taskId))) return refused(R.taskNotFound);
    const done = await moveTaskAs(p, { taskId, listId: str(inp.listId), listName: str(inp.listName) }, APP);
    if (isRefusal(done)) return refusalOf(done);
    return fixed(
      { task: taskRef(done.gate.item), list: { id: done.list.id, name: done.toListName }, status: done.status },
      S.taskMoved,
      { target: { type: "item", id: done.gate.item.id }, touched: [`item:${done.gate.item.id}`], changes: 1 },
    );
  },
};

const addComment: McpTool = {
  name: "add_comment",
  scope: "write",
  inputSchema: input({ taskId: ID(F.taskId), text: { type: "string", minLength: 1, maxLength: 4000 } }, ["taskId", "text"]),
  outputSchema: output({ comment: output({ id: STR() }), task: TASK_REF(), duplicate: BOOL() }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  run: async (call, inp) => {
    const p = call.person;
    const taskId = String(inp.taskId);
    if (!(await isTaskHere(p, taskId))) return refused(R.taskNotFound);
    const done = await commentOnTaskAs(p, { taskId, text: String(inp.text ?? "") }, APP);
    if (isRefusal(done)) return refusalOf(done);
    return fixed(
      { comment: { id: done.commentId ?? "" }, task: taskRef(done.gate.item), duplicate: false },
      S.commented,
      { target: { type: "item", id: done.gate.item.id }, touched: [`item:${done.gate.item.id}`], changes: 1 },
    );
  },
};

const createDoc: McpTool = {
  name: "create_doc",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 200 },
      markdown: { type: "string", maxLength: 50000 },
      place: input({ spaceId: ID(F.spaceId), folderId: ID(), listId: ID(F.listId), parentDocId: ID(F.docId) }),
    },
    ["title"],
  ),
  outputSchema: output({
    doc: output({
      id: STR(),
      title: STR(),
      place: output({ kind: STR(), name: STR_OR_NULL() }),
      private: BOOL(),
      inNotepad: BOOL(),
      url: STR(),
    }),
  }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  run: async (call, inp) => {
    const p = call.person;
    const place = (inp.place && typeof inp.place === "object" ? inp.place : {}) as Record<string, unknown>;
    const given = PLACE_KEYS.filter((k) => str(place[k]));
    if (given.length > 1) return refused(R.twoPlaces);
    const title = clean(inp.title, 200);
    if (!title) return refused(R.emptyTitle);
    const blocks = markdownToBlocks(typeof inp.markdown === "string" ? inp.markdown : "", (t) => clean(t, 5000));
    if (!blocks.ok) return refused(R.tooManyBlocks(MAX_DOC_BLOCKS));

    // With no place, the person's own Notepad (NOTEPAD/<their id>): theirs alone, listed only there.
    const key = given[0];
    const id = key ? String(place[key]).trim() : null;
    let anchor: { entityType: string | null; entityId: string | null; parentId: string | null } = { entityType: "NOTEPAD", entityId: p.userId, parentId: null };
    // Every place is looked up in the connection's workspace first (review low 14).
    const org = p.organizationId;
    if (key === "spaceId") {
      if (!(await prisma.space.findFirst({ where: { id: id!, organizationId: org }, select: { id: true } }))) return refused(R.placeNotFound);
      anchor = { entityType: "SPACE", entityId: id, parentId: null };
    } else if (key === "folderId") {
      if (!(await prisma.folder.findFirst({ where: { id: id!, organizationId: org }, select: { id: true } }))) return refused(R.placeNotFound);
      anchor = { entityType: "FOLDER", entityId: id, parentId: null };
    } else if (key === "listId") {
      // Somebody else's Personal list, and the hidden system Lists, are never a place (list_lists shows neither).
      const board = await prisma.board.findFirst({ where: { id: id!, organizationId: org }, select: { productSlug: true, ownerId: true, settings: true, itemType: true } });
      if (!board || isSystemBoard(board) || isOthersPersonalList(board, p.userId)) return refused(R.placeNotFound);
      anchor = { entityType: "BOARD", entityId: id, parentId: null };
    } else if (key === "parentDocId") {
      const parent = await prisma.doc.findFirst({ where: { id: id!, organizationId: org }, select: { id: true, entityType: true, entityId: true, parentId: true } });
      // Never under a doc on a colleague's Personal list, or on a task there (final review, security L1).
      if (!parent || (await docOnOthersPersonal(p, parent))) return refused(R.placeNotFound);
      anchor = { entityType: null, entityId: null, parentId: id };
    }

    const [{ createDocAs }, { docSaveCtxOf }] = await Promise.all([docCreate(), acting()]);
    const res = await answer(
      await createDocAs(docSaveCtxOf(p), { title, content: { blocks: blocks.blocks }, entityType: anchor.entityType, entityId: anchor.entityId, parentId: anchor.parentId }),
    );
    const doc = res.status === 200 ? (res.body.doc as { id?: unknown; title?: unknown } | undefined) : undefined;
    if (!doc || typeof doc.id !== "string") {
      if (res.status === 404) return refused(R.placeNotFound);
      // The route's own sentences come with a code; nothing else it says is passed on (review low 13).
      return refused(typeof res.body.code === "string" && typeof res.body.message === "string" ? res.body.message : R.notSaved);
    }
    const docId = doc.id;
    const inNotepad = anchor.entityType === "NOTEPAD";
    const effect = { target: { type: "doc" as const, id: docId }, touched: [`doc:${docId}`, ...(anchor.parentId ? [`doc:${anchor.parentId}`] : [])], changes: 1 };
    const shape = (where: { place: { kind: string; name: string | null }; inNote: boolean }) => ({
      doc: {
        id: docId,
        title: typeof doc.title === "string" ? doc.title : title,
        place: where.place,
        private: inNotepad || where.inNote,
        inNotepad,
        url: appUrl(`/work/docs/${encodeURIComponent(docId)}`),
      },
    });
    const guess = { place: { kind: inNotepad ? "notepad" : anchor.parentId ? "page" : "docs", name: null }, inNote: inNotepad };
    call.made({ effect, payload: shape(guess) });
    const where = await docPlaceOf(p, anchor).catch(() => guess);
    return fixed(shape(where), inNotepad ? S.docInNotepad : S.docCreated, effect);
  },
};

const PLACE_KEYS = ["spaceId", "folderId", "listId", "parentDocId"] as const;

/** Where a new doc went, by the names the Docs list shows, and whether it sits under a note (and so is private too). */
async function docPlaceOf(
  p: ActingPerson,
  a: { entityType: string | null; entityId: string | null; parentId: string | null },
): Promise<{ place: { kind: string; name: string | null }; inNote: boolean }> {
  const org = p.organizationId;
  if (a.entityType === "NOTEPAD") return { place: { kind: "notepad", name: null }, inNote: true };
  if (a.entityType === "SPACE" && a.entityId) {
    const row = await prisma.space.findFirst({ where: { id: a.entityId, organizationId: org }, select: { name: true } });
    return { place: { kind: "space", name: row?.name ?? null }, inNote: false };
  }
  if (a.entityType === "FOLDER" && a.entityId) {
    const row = await prisma.folder.findFirst({ where: { id: a.entityId, organizationId: org }, select: { name: true } });
    return { place: { kind: "folder", name: row?.name ?? null }, inNote: false };
  }
  if (a.entityType === "BOARD" && a.entityId) {
    const row = await prisma.board.findFirst({ where: { id: a.entityId, organizationId: org }, select: { name: true } });
    return { place: { kind: "list", name: row?.name ?? null }, inNote: false };
  }
  if (a.parentId) {
    // A page under a note is the note owner's alone (node-rules R6a): up its parents, as the rule walks them.
    let inNote = false;
    let cursor: string | null = a.parentId;
    let parentTitle: string | null = null;
    for (let hops = 0; cursor && hops <= 8; hops += 1) {
      const row: { title: string; entityType: string | null; parentId: string | null } | null = await prisma.doc.findFirst({
        where: { id: cursor, organizationId: org },
        select: { title: true, entityType: true, parentId: true },
      });
      if (!row) break;
      if (hops === 0) parentTitle = row.title;
      if (row.entityType === "NOTEPAD") {
        inNote = true;
        break;
      }
      cursor = row.parentId;
    }
    return { place: { kind: "page", name: parentTitle }, inNote };
  }
  return { place: { kind: "docs", name: null }, inNote: false };
}

const appendToDoc: McpTool = {
  name: "append_to_doc",
  scope: "write",
  inputSchema: input({ docId: ID(F.docId), heading: { type: "string", maxLength: 120 }, text: { type: "string", minLength: 1, maxLength: 8000 } }, ["docId", "text"]),
  outputSchema: output({ doc: output({ id: STR(), title: STR(), url: STR() }), version: { type: ["integer", "null"] } }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  run: async (call, inp) => {
    const done = await appendToDocAs(
      call.person,
      {
        docId: String(inp.docId),
        ...(typeof inp.heading === "string" && inp.heading.trim() ? { heading: inp.heading } : {}),
        text: String(inp.text ?? ""),
      },
      APP,
    );
    if (isRefusal(done)) return refusalOf(done);
    return fixed(
      { doc: { id: done.doc.id, title: done.doc.title, url: appUrl(`/work/docs/${encodeURIComponent(done.doc.id)}`) }, version: done.version },
      S.appended,
      { target: { type: "doc", id: done.doc.id }, touched: [`doc:${done.doc.id}`], changes: 1 },
    );
  },
};

const createReminder: McpTool = {
  name: "create_reminder",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 200 },
      remindAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})?$" },
      note: { type: "string", maxLength: 2000 },
      taskId: ID(F.taskId),
      email: BOOL(),
    },
    ["title", "remindAt"],
  ),
  outputSchema: output({
    reminder: output({ id: STR(), title: STR(), remindAt: STR(), task: NAMED_OR_NULL() }),
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  run: async (call, inp) => {
    const p = call.person;
    const title = clean(inp.title, 200);
    if (!title) return refused(R.emptyTitle);
    const note = clean(inp.note, 2000);
    const at = remindAtOf(String(inp.remindAt ?? ""), p);
    if (!at || at.getTime() <= call.now.getTime()) return refused(R.reminderWhen);
    const taskId = str(inp.taskId);
    const task = taskId ? await isTaskHere(p, taskId) : null;
    if (taskId && !task) return refused(R.taskNotFound);
    const { createReminderFor, REMINDER_TASK_ENTITY } = await reminderCreate();
    const res = await answer(
      await createReminderFor(await itemCtxOf(p), {
        title,
        ...(note ? { body: note } : {}),
        remindAt: at.toISOString(),
        notifyEmail: inp.email === true,
        ...(task ? { entityType: REMINDER_TASK_ENTITY, entityId: task.id } : {}),
      }),
    );
    const reminder = res.status === 201 ? (res.body.reminder as { id?: unknown; title?: unknown } | undefined) : undefined;
    if (!reminder || typeof reminder.id !== "string") return refused(res.status === 404 || res.status === 403 ? R.taskNotFound : R.reminderWhen);
    return fixed(
      {
        reminder: { id: reminder.id, title: typeof reminder.title === "string" ? reminder.title : title, remindAt: at.toISOString(), task: task ? { id: task.id, name: task.title } : null },
        duplicate: false,
      },
      S.reminderSet,
      { target: { type: "reminder", id: reminder.id }, touched: [`reminder:${reminder.id}`], changes: 1 },
    );
  },
};

/**
 * The moment remindAt names: with an offset (Z, +02:00) as written; with
 * none, that wall-clock time in the person's own zone (4.3). Null for a time
 * that is not on the calendar.
 */
export function remindAtOf(raw: string, p: Pick<ActingPerson, "timezone">): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(raw.trim());
  if (!m || !isDay(m[1])) return null;
  const [hh, mm, ss] = [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) return null;
  if (m[6]) {
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = zonedIso(m[1], hh, mm, { timezone: p.timezone });
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + ss * 1000);
}

const giveKudos: McpTool = {
  name: "give_kudos",
  scope: "write",
  inputSchema: input(
    { toEmail: EMAIL(), message: { type: "string", minLength: 1, maxLength: 500 }, companyValue: { type: "string", maxLength: 80 } },
    ["toEmail", "message"],
  ),
  outputSchema: output({
    kudos: output({ id: STR(), message: STR(), companyValue: STR_OR_NULL(), to: PERSON() }),
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
  dedupe: DEDUPE_ALWAYS,
  run: async (call, inp) => {
    const p = call.person;
    const email = String(inp.toEmail ?? "").trim();
    const who = await livePersonByEmail(p.organizationId, email);
    if (!who) return refused(R.unknownPerson(email));
    const message = clean(inp.message, 500);
    if (!message) return refused(R.emptyText);
    const companyValue = clean(inp.companyValue, 80) || null;
    const { giveKudos } = await kudosGive();
    // The wall's own rules (never a Guest, never yourself, a resend in two minutes answered once).
    const given = await giveKudos({ organizationId: p.organizationId, giverId: p.userId, receiverId: who.id, message, companyValue });
    if (!given.ok) return refused(given.error === "Not found" ? R.cantKudos : given.error);
    const k = given.kudos;
    return fixed(
      { kudos: { id: k.id, message: k.message, companyValue: k.companyValue ?? null, to: { id: who.id, name: who.name } }, duplicate: given.duplicate },
      given.duplicate ? S.duplicate : S.kudosGiven,
      // The wall's own resend check made nothing new: nothing to count or audit.
      { target: { type: "kudos", id: k.id }, touched: [`kudos:${k.id}`], changes: given.duplicate ? 0 : 1 },
    );
  },
};

/** The eight write tools, in the order tools/list gives them. */
export const WRITE_TOOLS: readonly McpTool[] = [createTask, updateTask, moveTask, addComment, createDoc, appendToDoc, createReminder, giveKudos];
