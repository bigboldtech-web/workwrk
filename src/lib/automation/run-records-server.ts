// The record a run happened to, resolved for ONE viewer (spec-ai-automation
// /automation/logs, the Record column). A task shows its title and links to
// it only when the viewer can open its List; otherwise the cell reads "Not
// available" and the run drawer hides the payloads, so the Logs page cannot
// be used to read a task in a List the viewer has no access to. An Owner or
// Admin sees every record.

import { prisma } from "@/lib/prisma";
import { accessibleIds } from "@/lib/access/index";
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
  /** False when the run is about a task in a List the viewer cannot open. */
  canSeeDetail(recordType: string | null, recordId: string | null): boolean;
}

export async function resolveRunRecords(
  viewer: Viewer,
  orgId: string,
  isAdmin: boolean,
  runs: Array<{ recordType: string | null; recordId: string | null }>,
): Promise<RecordResolver> {
  const taskIds = [...new Set(runs.filter((r) => r.recordType === "task" && r.recordId).map((r) => r.recordId as string))];
  const tasks = taskIds.length
    ? await prisma.item.findMany({ where: { id: { in: taskIds }, organizationId: orgId }, select: { id: true, title: true, boardId: true } })
    : [];
  const readableLists = !isAdmin && tasks.length ? (await accessibleIds(viewer, "list", "VIEW")).readable : null;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const readable = (id: string) => {
    const t = taskById.get(id);
    if (!t) return false;
    return isAdmin || Boolean(readableLists?.has(t.boardId));
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
    canSeeDetail(type, id) {
      if (isAdmin || type !== "task" || !id) return true;
      // A task that no longer exists cannot be checked, so its payload stays hidden too.
      return readable(id);
    },
  };
}
