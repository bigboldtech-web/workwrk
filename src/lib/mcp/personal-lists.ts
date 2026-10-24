// "On someone else's Personal list" (final review of the MCP server,
// security L1 and privacy L4): one rule for every MCP tool that reaches a
// task or a doc by id.
//
// A Personal list is its owner's own to-dos. list_lists never shows a
// colleague's, the task searches drop its tasks (src/lib/agents/tools.ts
// ownPersonalOnly), and no write puts anything there (write.ts homeListFor's
// othersPersonal, isTaskHere). But an Owner or Admin holds Full access on
// every List, a colleague's Personal list included, so get_task by id,
// search_docs (a doc anchored to such a List or to a task on it), get_doc,
// append_to_doc and create_doc's parentDocId reached them. Now each asks the
// same question, for Owners and Admins too:
//   - a List is on someone else's Personal list when it is a Personal list
//     ("personal-list") whose owner is not the person;
//   - a task, when its List is, and the person neither owns it nor is
//     assigned to it (the searches' rule and the writes', so a task given to
//     the person on a colleague's list stays theirs to read, as search_tasks
//     already lists it);
//   - a doc, when its home (node-placement docHomeOf: its own anchor, else
//     the first anchor up its pages) is such a List, or such a task.
// A doc anchored to a note (NOTEPAD) is its owner's alone by the doc gate
// itself (node-rules R6a), so it needs nothing here.
//
// Server-only.

import { prisma } from "@/lib/prisma";

type Person = { userId: string; organizationId: string };
type ListRow = { productSlug: string | null; ownerId: string | null };
type TaskRow = { boardId: string; ownerId: string | null; assigneeIds: string[] | null };
type DocPlace = { entityType: string | null; entityId: string | null; parentId: string | null };

/** A List that is someone else's Personal list. */
export function isOthersPersonalList(board: ListRow | null | undefined, userId: string): boolean {
  return !!board && board.productSlug === "personal-list" && board.ownerId !== userId;
}

/** Is the task the person's own: theirs, or given to them? */
function ownTask(task: TaskRow, userId: string): boolean {
  return task.ownerId === userId || (task.assigneeIds ?? []).includes(userId);
}

/** A task on someone else's Personal list that the person neither owns nor is assigned to. */
export async function taskOnOthersPersonal(p: Person, task: TaskRow): Promise<boolean> {
  if (ownTask(task, p.userId)) return false;
  const board = await prisma.board.findFirst({ where: { id: task.boardId, organizationId: p.organizationId }, select: { productSlug: true, ownerId: true } });
  return isOthersPersonalList(board, p.userId);
}

/** Which of these docs live on someone else's Personal list, or on a task there that is not the person's own (see the header). */
export async function docsOnOthersPersonal(p: Person, docs: ReadonlyArray<DocPlace & { id: string }>): Promise<Set<string>> {
  const out = new Set<string>();
  if (docs.length === 0) return out;
  const { docHomeOf } = await import("@/lib/access/node-placement");
  const homes = new Map<string, { entityType: string; entityId: string }>();
  // A page with no anchor of its own lives where its parent does: one walk up the pages per parent, shared by its siblings.
  const byParent = new Map<string, ReturnType<typeof docHomeOf>>();
  for (const d of docs) {
    // Only an anchor on a List or a task, or a page whose home is found up its parents, can be one.
    if (d.entityType && d.entityType !== "BOARD" && d.entityType !== "BOARD_ITEM") continue;
    if (!d.entityType && !d.parentId) continue;
    let home: Awaited<ReturnType<typeof docHomeOf>> | null;
    if (d.entityType && d.entityId) home = await docHomeOf(p.organizationId, d);
    else if (d.parentId) {
      let walk = byParent.get(d.parentId);
      if (!walk) {
        walk = docHomeOf(p.organizationId, { entityType: null, entityId: null, parentId: d.parentId });
        byParent.set(d.parentId, walk);
      }
      home = await walk;
    } else home = null;
    if (home && home.kind === "anchor" && (home.entityType === "BOARD" || home.entityType === "BOARD_ITEM")) homes.set(d.id, { entityType: home.entityType, entityId: home.entityId });
  }
  if (homes.size === 0) return out;
  const of = (kind: string) => [...new Set([...homes.values()].filter((h) => h.entityType === kind).map((h) => h.entityId))];
  const taskIds = of("BOARD_ITEM");
  const tasks = taskIds.length
    ? await prisma.item.findMany({ where: { id: { in: taskIds }, organizationId: p.organizationId }, select: { id: true, boardId: true, ownerId: true, assigneeIds: true } })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const boardIds = [...new Set([...of("BOARD"), ...tasks.map((t) => t.boardId)])];
  const boards = boardIds.length
    ? await prisma.board.findMany({ where: { id: { in: boardIds }, organizationId: p.organizationId }, select: { id: true, productSlug: true, ownerId: true } })
    : [];
  const boardById = new Map(boards.map((b) => [b.id, b]));
  for (const [docId, home] of homes) {
    if (home.entityType === "BOARD") {
      if (isOthersPersonalList(boardById.get(home.entityId), p.userId)) out.add(docId);
      continue;
    }
    const task = taskById.get(home.entityId);
    if (task && !ownTask(task, p.userId) && isOthersPersonalList(boardById.get(task.boardId), p.userId)) out.add(docId);
  }
  return out;
}

/** One doc (docsOnOthersPersonal). */
export async function docOnOthersPersonal(p: Person, doc: DocPlace & { id: string }): Promise<boolean> {
  return (await docsOnOthersPersonal(p, [doc])).has(doc.id);
}
