// GET /api/boards/[id]/assignable — the people who can be assigned a task
// on THIS list.
//
// The assignee pickers used to call /api/users?scope=all, which quietly
// downgrades any caller below ORG_WIDE_ALIGNMENT_LEVELS to their own report
// tree: a Space Admin with no reports got a picker containing one name, his
// own. That endpoint keeps its privacy rule (it serves the HR directory).
// This one answers a narrower question with a narrower payload: id, name,
// avatar, and an email only for the callers described below.
//
// TWO GATES, because this endpoint serves two different needs.
//
//   READ gets you the roster WITHOUT emails. A read-only viewer still has to
//   RENDER the people already on a task and in its USER/PEOPLE fields; refuse
//   them and a populated field turns into a permanent loading spinner or drops
//   an avatar on the floor.
//
//   CONTRIBUTE gets you the emails. On an ORG-visible list the candidate set is
//   the whole active org, so a read-gated roster carrying email was a
//   searchable company directory available to any guest. Gating the FIELD
//   rather than the endpoint keeps both halves honest: the picker (which only
//   opens for someone who can contribute) keeps its email search, and the
//   viewer the page labels "View only" keeps every avatar it needs to draw.
//
// Assigning itself is still gated by PATCH /api/items/[id], which resolves its
// own item role.

import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sessionAccessLevel } from "@/lib/alignment-scope";
import { canContributeBoard, getBoardForReader } from "@/lib/board";
import { listAssignableUsersForBoard } from "@/lib/assignable";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  if (!orgId || !userId) return jsonError("Unauthorized", 401);

  const { id } = await params;
  // A task list is not discoverable: "no access" and "no such board" are the
  // same answer, 404.
  const board = await getBoardForReader(id, userId, sessionAccessLevel(session));
  if (!board || board.organizationId !== orgId) return jsonError("Not found", 404);

  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  const includeEmail = await canContributeBoard(id, userId, sessionAccessLevel(session));
  const data = await listAssignableUsersForBoard(id, orgId, { search, limit, includeEmail });
  return jsonSuccess({ data, total: data.length }, 200, { "Cache-Control": "no-store" });
}
