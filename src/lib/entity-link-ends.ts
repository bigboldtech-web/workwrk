// Which ends of an entity link a viewer may see (GET /api/entity-links).
//
// A link carries both ends' types and ids and its free text context, so a
// row is shown only when the viewer can open BOTH ends: the source as well
// as the target, and the anchor a lookup is made by is itself an end of
// every row it returns. Node ends (a doc, a canvas, a Folder, a List, a
// Space, a table, a form) are decided by the one resolver; a task follows
// its List or its assignment; a file follows the file read rule. Ends that
// are not nodes (a SOP, a KRA, an OKR, a person) pass, as before.
//
// Pure: the route loads the decisions and hands them in.

import type { NodeKind } from "./access/node-rules";

export const LINK_NODE_KIND: Readonly<Partial<Record<string, NodeKind>>> = {
  NOTE: "doc",
  DOC: "doc",
  WHITEBOARD: "canvas",
  BOARD: "list",
  SPACE: "space",
  FOLDER: "folder",
  TABLE: "table",
  FORM: "form",
};

export const LINK_TASK_TYPES: ReadonlySet<string> = new Set(["TASK", "BOARD_ITEM"]);

export interface LinkEndFacts {
  userId: string;
  /** Can the viewer open this node (Can view or better)? */
  nodeOpens: (kind: NodeKind, id: string) => boolean;
  readableFiles: ReadonlySet<string>;
  tasks: ReadonlyMap<string, { boardId: string; ownerId: string | null; assigneeIds: readonly string[] }>;
}

export function linkEndVisible(type: string, id: string, f: LinkEndFacts): boolean {
  if (type === "FILE") return f.readableFiles.has(id);
  if (LINK_TASK_TYPES.has(type)) {
    const t = f.tasks.get(id);
    // A TASK id that is no task (a legacy row) is not a node: no node gate.
    // A BOARD_ITEM that is not in this org is nothing the viewer may see.
    if (!t) return type === "TASK";
    return f.nodeOpens("list", t.boardId) || t.ownerId === f.userId || t.assigneeIds.includes(f.userId);
  }
  const kind = LINK_NODE_KIND[type];
  if (!kind) return true;
  return f.nodeOpens(kind, id);
}

export function linkVisible(link: { sourceType: string; sourceId: string; targetType: string; targetId: string }, f: LinkEndFacts): boolean {
  return linkEndVisible(link.sourceType, link.sourceId, f) && linkEndVisible(link.targetType, link.targetId, f);
}

// ── adding and removing a link (POST, DELETE /api/entity-links) ──────

/** What the write half needs on top of the read facts: who may change each source. */
export interface LinkWriteFacts extends LinkEndFacts {
  /** Can the viewer edit this node (Can edit or better)? */
  nodeEdits: (kind: NodeKind, id: string) => boolean;
  /** The source tasks the viewer may edit (the task edit rule: its List, its assignee, its creator). */
  editableTasks: ReadonlySet<string>;
  /** The source files the viewer may change (the file edit rule: Can edit where the file sits). */
  editableFiles: ReadonlySet<string>;
}

export type LinkWriteVerdict = { ok: true } | { ok: false; status: 403 | 404; error: string };

const SOURCE_NOUN: Readonly<Record<string, string>> = {
  TASK: "task", BOARD_ITEM: "task", BOARD: "List", NOTE: "doc", DOC: "doc", WHITEBOARD: "canvas",
  SPACE: "Space", FOLDER: "folder", TABLE: "table", FORM: "form", FILE: "file",
};

/** P6: the one sentence a refused link write answers with. */
export function linkWriteRefusal(sourceType: string): string {
  return `You need Can edit on this ${SOURCE_NOUN[sourceType] ?? "item"} to add or remove its links and attachments.`;
}

const NOT_FOUND: LinkWriteVerdict = { ok: false, status: 404, error: "Not found" };

/**
 * May the viewer add a link FROM this source, or remove one? A link on a task,
 * a List, a doc, a canvas, a Folder, a Space, a table, a form or a file is
 * content added to that node (an attachment, a relation), or taken from it,
 * so the placement rule's create rule holds (node-rules P1): Can edit or
 * higher on the source; Can view and Can comment never add or remove one. A
 * task answers by the task edit rule, a file by the file edit rule. The
 * other end must be something the viewer can open: a link never plants a
 * node they cannot see where other people read it, and never becomes the
 * door to a file they could not open. A source or a target out of sight
 * reads as not found, so a guessed id confirms nothing. Sources that are not
 * nodes (a SOP, a KRA, a goal, a person) keep their own gates.
 */
export function linkWriteVerdict(
  link: { sourceType: string; sourceId: string; targetType: string; targetId: string },
  f: LinkWriteFacts,
): LinkWriteVerdict {
  const { sourceType: type, sourceId: id } = link;
  if (!linkEndVisible(type, id, f)) return NOT_FOUND;
  let edits = true;
  if (type === "FILE") edits = f.editableFiles.has(id);
  else if (LINK_TASK_TYPES.has(type)) edits = f.tasks.has(id) ? f.editableTasks.has(id) : type === "TASK";
  else if (LINK_NODE_KIND[type]) edits = f.nodeEdits(LINK_NODE_KIND[type] as NodeKind, id);
  if (!edits) return { ok: false, status: 403, error: linkWriteRefusal(type) };
  if (!linkEndVisible(link.targetType, link.targetId, f)) return NOT_FOUND;
  return { ok: true };
}
