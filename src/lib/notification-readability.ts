// notification-readability.ts — can the viewer still open what this
// notification points at, and if not, why.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, "Target the
// viewer can no longer open"): the pane never 404s and never shows a locked
// object's contents; it renders the notification's own stored title and
// message with one sentence saying which case it is, and no Open button.
// "The server decides this, not the client."
//
// WHY IT MATTERS MORE THAN IT LOOKS. A notification is a permanent record of
// something that happened to you, written at a moment when you could see the
// thing. Tasks get deleted, Lists get restricted, people leave. The row must
// stay in the list and stay clearable — hiding it would leave an unread count
// that cannot be cleared — while the pane stops pretending the object is still
// there.
//
// It is ONE world for every target the page shows (the one node-access
// resolver, src/lib/access/node-access.ts), so the Inbox answers exactly what
// the object's own page answers: a task by its List's role or the assignment
// grant, a doc by its anchor, parent page, listings and restricted flag, a
// Folder by its own grants and the PRIVATE cut, a table, canvas or form by
// its container and its grants. Anything it does not know about comes back
// absent from the map, which the caller reads as "openable": an external
// href or a route with no object behind it is not a locked object.

import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import type { NotificationTarget, TargetKind, UnreadableReason } from "./notification-target";

export interface TargetVerdict {
  readable: boolean;
  reason: UnreadableReason | null;
}

/** `"item:abc"` — the key both this map and the caller build. */
export function targetKey(target: Pick<NotificationTarget, "kind" | "id">): string {
  return `${target.kind}:${target.id ?? ""}`;
}

/** The kinds this module resolves. Everything else is left openable. */
const RESOLVED: readonly TargetKind[] = ["item", "board", "space", "folder", "doc", "sop", "table", "canvas", "form", "agent"];

/** A row that exists, whether it is archived, and the node it is (a task is its List). */
interface Found { archived: boolean; ref: NodeRef | null; mine?: boolean }

/**
 * A verdict per distinct target. Absent from the map = nothing to check.
 *
 * The three reasons, in the words the pane prints:
 *   deleted   the row is gone from the table entirely
 *   moved     the row exists but is archived / in the Trash
 *   no_access the row exists and is live, and this viewer cannot read it
 */
export async function readableTargets(
  userId: string,
  organizationId: string,
  targets: readonly NotificationTarget[],
  accessLevel?: string | null,
): Promise<Map<string, TargetVerdict>> {
  const out = new Map<string, TargetVerdict>();
  if (!organizationId) return out;

  const byKind = new Map<TargetKind, Set<string>>();
  for (const t of targets) {
    if (!t.id || !RESOLVED.includes(t.kind)) continue;
    const set = byKind.get(t.kind) ?? new Set<string>();
    set.add(t.id);
    byKind.set(t.kind, set);
  }
  if (byKind.size === 0) return out;
  const ids = (k: TargetKind) => [...(byKind.get(k) ?? [])];
  const where = { organizationId };

  // Which rows exist (and are live), one query per kind asked for.
  const [items, boards, spaces, folders, docs, sops, tables, canvases, forms, requests] = await Promise.all([
    ids("item").length ? prisma.item.findMany({ where: { ...where, id: { in: ids("item") } }, select: { id: true, archivedAt: true, ownerId: true, assigneeIds: true, boardId: true, board: { select: { archivedAt: true } } } }) : [],
    // A board link carries the SLUG, not the id, so both are matched.
    ids("board").length ? prisma.board.findMany({ where: { ...where, OR: [{ id: { in: ids("board") } }, { slug: { in: ids("board") } }] }, select: { id: true, slug: true, archivedAt: true } }) : [],
    ids("space").length ? prisma.space.findMany({ where: { ...where, OR: [{ id: { in: ids("space") } }, { slug: { in: ids("space") } }] }, select: { id: true, slug: true, archivedAt: true } }) : [],
    ids("folder").length ? prisma.folder.findMany({ where: { ...where, id: { in: ids("folder") } }, select: { id: true, archivedAt: true } }) : [],
    ids("doc").length ? prisma.doc.findMany({ where: { ...where, id: { in: ids("doc") } }, select: { id: true, archivedAt: true } }) : [],
    ids("sop").length ? prisma.sOP.findMany({ where: { ...where, id: { in: ids("sop") } }, select: { id: true } }) : [],
    ids("table").length ? prisma.dataTable.findMany({ where: { ...where, id: { in: ids("table") } }, select: { id: true } }) : [],
    ids("canvas").length ? prisma.whiteboard.findMany({ where: { ...where, id: { in: ids("canvas") } }, select: { id: true, archivedAt: true } }) : [],
    ids("form").length ? prisma.formDefinition.findMany({ where: { ...where, id: { in: ids("form") } }, select: { id: true } }) : [],
    // An AI teammate's request is its person's alone: anyone else's reads as
    // gone, as GET /api/agents/actions/[id] answers it.
    ids("agent").length ? prisma.agentAction.findMany({ where: { ...where, id: { in: ids("agent") }, actingForId: userId }, select: { id: true } }) : [],
  ]);

  const found = new Map<string, Found>();
  for (const r of items) {
    // Access rule 9: being assigned a task grants Can edit on that task, List
    // membership or no. The task page short-circuits on exactly this, so the
    // Inbox must agree with it or an assignee is told they cannot open a task
    // that opens perfectly well.
    const mine = r.ownerId === userId || (r.assigneeIds ?? []).includes(userId);
    found.set(`item:${r.id}`, { archived: r.archivedAt !== null || r.board?.archivedAt != null, ref: { kind: "list", id: r.boardId }, mine });
  }
  for (const r of boards) {
    const v: Found = { archived: r.archivedAt !== null, ref: { kind: "list", id: r.id } };
    found.set(`board:${r.id}`, v);
    found.set(`board:${r.slug}`, v);
  }
  for (const r of spaces) {
    const v: Found = { archived: r.archivedAt !== null, ref: { kind: "space", id: r.id } };
    found.set(`space:${r.id}`, v);
    found.set(`space:${r.slug}`, v);
  }
  for (const r of folders) found.set(`folder:${r.id}`, { archived: r.archivedAt !== null, ref: { kind: "folder", id: r.id } });
  for (const r of docs) found.set(`doc:${r.id}`, { archived: r.archivedAt !== null, ref: { kind: "doc", id: r.id } });
  // SOPs sit outside this access model: a live SOP is openable here and its
  // own page applies the SOP centre's folder rules.
  for (const r of sops) found.set(`sop:${r.id}`, { archived: false, ref: null });
  for (const r of tables) found.set(`table:${r.id}`, { archived: false, ref: { kind: "table", id: r.id } });
  for (const r of canvases) found.set(`canvas:${r.id}`, { archived: r.archivedAt !== null, ref: { kind: "canvas", id: r.id } });
  for (const r of forms) found.set(`form:${r.id}`, { archived: false, ref: { kind: "form", id: r.id } });
  // A decided or cancelled request still opens: its card says how it ended.
  for (const r of requests) found.set(`agent:${r.id}`, { archived: false, ref: null });

  const refs = [...found.values()].map((f) => f.ref).filter((r): r is NodeRef => r !== null);
  const decisions = refs.length ? await nodeRoles(nodeCtxFromLevel(userId, organizationId, accessLevel), refs) : new Map();

  for (const [kind, set] of byKind) {
    for (const id of set) {
      const key = `${kind}:${id}`;
      const f = found.get(key);
      if (!f) out.set(key, { readable: false, reason: "deleted" });
      else if (f.archived) out.set(key, { readable: false, reason: "moved" });
      else {
        const role = f.ref ? decisions.get(`${f.ref.kind}:${f.ref.id}`)?.role ?? "none" : "VIEW";
        const readable = !!f.mine || roleAtLeast(role, "VIEW");
        out.set(key, readable ? { readable: true, reason: null } : { readable: false, reason: "no_access" });
      }
    }
  }
  return out;
}
