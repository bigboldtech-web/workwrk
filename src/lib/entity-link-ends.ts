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
