// GET /api/me/everything/export.csv — the Everything "…" menu's Export CSV.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything, Data).
//
// It walks the same reader the page does, with the same filters and the same
// scope, so an export can never contain a row the page would not show. Never
// for a Guest, an Agent or an acting-as session (access section 9's export
// rule): an export is the one action that takes data out of the product.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";
import { listEverything } from "@/lib/everything";
import { csvCell } from "@/lib/trash-view";
import type { WorkGroupKey, WorkSortKey } from "@/lib/my-work";

export const dynamic = "force-dynamic";

const PAGE = 200;
const MAX_ROWS = 20_000;

function listParam(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    if (viewer.orgRole === "GUEST" || viewer.isAgent || viewer.actingAs) {
      return jsonError("Exports are not available to guests, agents, or while acting as somebody else.", 403);
    }

    const sp = new URL(req.url).searchParams;
    const base = {
      space: sp.get("space"),
      folder: sp.get("folder"),
      group: (sp.get("group") ?? "list") as WorkGroupKey,
      sort: (sp.get("sort") ?? "created") as WorkSortKey,
      dir: (sp.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
      done: (sp.get("done") === "1" || sp.get("done") === "only" ? sp.get("done") : "0") as "0" | "1" | "only",
      q: sp.get("q"),
      statuses: listParam(sp.get("status")),
      priorities: listParam(sp.get("priority")),
      listIds: listParam(sp.get("list")),
      spaceIds: listParam(sp.get("spaceId")),
      assigneeIds: listParam(sp.get("assignee")),
      includeSubtasks: sp.get("subtasks") !== "0",
      limit: PAGE,
    };

    const lines = [["Task", "Status", "Priority", "Assignees", "Due", "Space", "List", "Created"].map(csvCell).join(",")];
    let cursor: string | null = null;
    let n = 0;
    for (;;) {
      const page = await listEverything(viewer, { ...base, cursor });
      for (const r of page.rows) {
        lines.push(
          [
            r.title,
            r.statusLabel ?? "",
            r.priority ?? "",
            r.assignees.map((a) => `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()).filter(Boolean).join("; "),
            r.dueAt ?? "",
            r.space?.name ?? "",
            r.board?.name ?? "",
            r.createdAt,
          ].map(csvCell).join(","),
        );
        n += 1;
      }
      cursor = page.nextCursor;
      if (!cursor || n >= MAX_ROWS) break;
    }

    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="everything.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
