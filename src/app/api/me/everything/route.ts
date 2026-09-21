// GET /api/me/everything: every task in every Space the viewer can see.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything, Data):
// "`accessibleIds(viewer, "list", VIEW).readable` replaces the per-board
// `getBoardForReader` loop, cursor pagination replaces `EVERYTHING_CAP`,
// per-row `role` from `canMany` for the read-only decision".
//
// ?space= and ?folder= narrow the readable set SERVER-side before paging, so a
// scoped view is a full page of that scope and not four rows that happened to
// survive a client filter.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { listEverything } from "@/lib/everything";
import type { WorkGroupKey, WorkSortKey } from "@/lib/my-work";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Every key WORK_GROUPS offers the picker, including "assignee": the picker is
// rendered from WORK_GROUPS unfiltered, so a key missing here was a control
// whose choice the server silently replaced with "list", scattering one
// person's tasks across pages under repeating group headers.
const GROUPS = new Set<WorkGroupKey>(["due", "status", "list", "priority", "assignee", "none"]);
const SORTS = new Set<WorkSortKey>(["due", "priority", "title", "list", "created", "updated"]);

function listParam(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    // The one Work-hub app key: /everything is a Work page like /home and
    // /my-work, and what a person sees inside it is decided per List.
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    const sp = new URL(req.url).searchParams;

    const group = sp.get("group") as WorkGroupKey | null;
    const sort = sp.get("sort") as WorkSortKey | null;
    const doneRaw = sp.get("done") ?? "0";
    const limitRaw = parseInt(sp.get("limit") ?? "", 10);

    const result = await listEverything(viewer, {
      space: sp.get("space"),
      folder: sp.get("folder"),
      // An unknown value falls back rather than erroring, so a stale link from
      // an old Space view lands on something real.
      group: group && GROUPS.has(group) ? group : "list",
      sort: sort && SORTS.has(sort) ? sort : "created",
      dir: sp.get("dir") === "asc" ? "asc" : "desc",
      done: doneRaw === "1" || doneRaw === "only" ? doneRaw : "0",
      q: sp.get("q"),
      statuses: listParam(sp.get("status")),
      priorities: listParam(sp.get("priority")),
      listIds: listParam(sp.get("list")),
      spaceIds: listParam(sp.get("spaceId")),
      assigneeIds: listParam(sp.get("assignee")),
      assignedByMe: sp.get("assignedBy") === "me",
      includeSubtasks: sp.get("subtasks") !== "0",
      cursor: sp.get("cursor"),
      limit: Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, limitRaw)) : DEFAULT_LIMIT,
    });

    return jsonSuccess(result, 200, { "Cache-Control": "private, no-store" });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
