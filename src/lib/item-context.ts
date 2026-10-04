// Which List a task request is made in (Phase 5b, tasks in more than one
// List). Shared by PATCH /api/items/[id] and the routes that write one List's
// field values on a task (POST /api/items/[id]/ai-fill), so every one of
// them answers a context the caller cannot read exactly alike.
//
// Server-only: reads the task's links and the caller's List roles.

import { decideContext } from "@/lib/list-links";
import { linkedListsOf, listReader, type LinkRow, type ReadableList } from "@/lib/list-links-server";
import type { ItemCtx, ItemGateOk } from "@/lib/item-gate";

/**
 * The linked context a request asked for, when it is one: a List the task
 * (or its top-level ancestor on the same home) is linked into and the caller
 * can read. "home" for the home and for no request; "invalid" for anything
 * else, which the caller answers as it decides (GET: as if absent; a write:
 * invalid_context).
 */
export async function linkedContextFor(
  gate: ItemGateOk,
  requested: string | null | undefined,
  c: ItemCtx,
): Promise<{ list: ReadableList; link: LinkRow; rootId: string } | "home" | "invalid"> {
  if (!requested || requested === gate.item.boardId) return "home";
  const { rootId, links } = await linkedListsOf(gate.item);
  const link = links.find((l) => l.boardId === requested) ?? null;
  const list = link ? await listReader(c).row(requested) : null;
  const kind = decideContext({
    requested,
    homeBoardId: gate.item.boardId,
    linkedBoardIds: links.map((l) => l.boardId),
    requestedReadable: !!list,
  });
  if (kind === "linked" && link && list) return { list, link, rootId };
  return kind === "home" ? "home" : "invalid";
}
