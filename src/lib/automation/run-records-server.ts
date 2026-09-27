// The record a run happened to, resolved for ONE viewer (spec-ai-automation
// /automation/logs, the Record column). A task shows its title and links to
// it only when the viewer can open it (its List through node access, or it
// is theirs); otherwise the cell reads "Not available" and the run drawer
// hides the payloads, so the Logs page cannot be used to read a task in a
// List the viewer has no access to. An Owner or Admin sees every record.
//
// The payloads of every OTHER kind of run are people's data (a KPI reading
// carries a userId, an actual, a target and a score; a review its outcome),
// and Logs is open to every Member. So a run that is not about a task shows
// what went in and came back only to an Owner or Admin and to whoever made
// the automation: a Member's automation on a person event only ever runs on
// their own data (author-reach.ts), so the creator reads nothing that is not
// theirs. Kudos (public by design) and a scheduled tick (no record at all)
// carry nothing to hide.

import { prisma } from "@/lib/prisma";
import { nodeCtxFromViewer, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import type { Viewer } from "@/lib/access/types";
import { recordHref } from "./run-query";

export interface RunRecord {
  type: string;
  id: string;
  name: string;
  url: string | null;
}

export interface RecordResolver {
  record(recordType: string | null, recordId: string | null): RunRecord | null;
  /**
   * False when the run is about a task in a List the viewer cannot open, or
   * about anything that is not a task, kudos or a schedule tick unless the
   * viewer made the automation (`createdById`) or is an Owner or Admin.
   */
  canSeeDetail(recordType: string | null, recordId: string | null, createdById: string | null | undefined): boolean;
}

/** Record kinds whose payload holds nothing about a person that the product hides. */
const OPEN_RECORD_TYPES: ReadonlySet<string> = new Set(["kudos", "schedule"]);

export async function resolveRunRecords(
  viewer: Viewer,
  orgId: string,
  isAdmin: boolean,
  runs: Array<{ recordType: string | null; recordId: string | null }>,
): Promise<RecordResolver> {
  const taskIds = [...new Set(runs.filter((r) => r.recordType === "task" && r.recordId).map((r) => r.recordId as string))];
  const tasks = taskIds.length
    ? await prisma.item.findMany({ where: { id: { in: taskIds }, organizationId: orgId }, select: { id: true, title: true, boardId: true, ownerId: true, assigneeIds: true } })
    : [];
  // The one node resolver, over ONE world for every List the page names.
  const listRoles = !isAdmin && tasks.length
    ? await nodeRoleMap(nodeCtxFromViewer(viewer), "list", tasks.map((t) => t.boardId))
    : null;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  // A reader of the task's List, or the person it is owned by or assigned
  // to: the same people the task page opens for.
  const readable = (id: string) => {
    const t = taskById.get(id);
    if (!t) return false;
    if (isAdmin) return true;
    if (t.ownerId === viewer.userId || t.assigneeIds.includes(viewer.userId)) return true;
    return roleAtLeast(listRoles?.get(t.boardId) ?? "none", "VIEW");
  };
  return {
    record(type, id) {
      if (!type || !id) return null;
      if (type === "task") {
        const t = taskById.get(id);
        if (!t || !readable(id)) return null;
        return { type, id, name: t.title || "Untitled task", url: recordHref(type, id) };
      }
      if (type === "kudos") return { type, id, name: "Kudos", url: recordHref(type, id) };
      if (type === "kpi") return { type, id, name: "KPI reading", url: recordHref(type, id) };
      return null;
    },
    canSeeDetail(type, id, createdById) {
      if (isAdmin) return true;
      if (type === "task") {
        // A task that no longer exists cannot be checked, so its payload stays hidden too.
        return Boolean(id) && readable(id as string);
      }
      if (type && OPEN_RECORD_TYPES.has(type)) return true;
      return Boolean(createdById) && createdById === viewer.userId;
    },
  };
}
