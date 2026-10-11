// Deleting a List, Folder or Space for a person: DELETE /api/boards/[id],
// /api/folders/[id] and /api/spaces/[id] with ?hard=1, after each route's own
// role gate. It moves the container and everything in it to Trash.
//
// The Agent tier never deletes a task (AGENT_TIER_BLURB; resolve.ts rule 12,
// "Agents never delete"), and a container's tasks go with it, so an Agent's
// delete runs with moveToTrash's keepTasks: an empty container still goes, one
// that holds a task (archived ones too) is refused and nothing is written.
// Archiving keeps every task and stays open to an Agent.
//
// Server-only (it reaches the database through moveToTrash).

import { moveToTrash, TrashHoldsTasks } from "@/lib/trash";
import { agentTrashRefusal } from "./labels";
import { isAgentOf } from "./org-role";

export type ContainerKind = "board" | "folder" | "space";

const NOUN: Record<ContainerKind, "List" | "Folder" | "Space"> = { board: "List", folder: "Folder", space: "Space" };

export type ContainerTrashResult =
  | { ok: true; moved: boolean }
  | { ok: false; status: 403; error: string; code: "agent_keeps_tasks" };

export async function trashContainer(
  kind: ContainerKind,
  id: string,
  actor: { organizationId: string; userId: string; userName: string | null; accessLevel: string | null | undefined },
): Promise<ContainerTrashResult> {
  try {
    const moved = await moveToTrash(kind, id, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      userName: actor.userName,
      keepTasks: isAgentOf(actor.accessLevel),
    });
    return { ok: true, moved };
  } catch (e) {
    if (e instanceof TrashHoldsTasks) {
      return { ok: false, status: 403, error: agentTrashRefusal(NOUN[kind], e.tasks), code: "agent_keeps_tasks" };
    }
    throw e;
  }
}
