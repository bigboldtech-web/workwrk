// Object-level authz for MUTATING an entity-link, keyed on the link's
// SOURCE entity.
//
// The entity-link graph is a general "reference anything to anything"
// primitive, and most sources (a task referencing a doc, a note embedding a
// whiteboard) are open to any org member who can see them. But some sources
// are GOVERNANCE objects whose edit rights are narrower than their read
// rights — a goal (OKR) can be seen org-wide yet only edited by its owner or
// their management line. The OkrLinkedWork UI already hides its attach/detach
// buttons behind that same edit check (`canEditGoal`); this makes the API
// enforce it too, so a member who can merely VIEW a goal can't re-wire the
// Spaces/Boards linked under it by calling the endpoint directly.
//
// Returns true (allowed) for every source type that carries no such gate, so
// existing open linking flows are unaffected.
//
// NODE SOURCES (the placement rule, node-rules P1). A link on a task, a List,
// a doc, a canvas, a Folder, a Space, a table, a form or a file is content
// added to that node, so linkWriteRefusalFor asks Can edit on the source (a
// task by the task edit rule, a file by the file edit rule) and Can view on
// the other end, for adding a link and for removing one. Both routes used to
// check nothing here: a Can view grantee, or someone with no access at all,
// attached files to a task, and removed other people's attachments.

import { prisma } from "@/lib/prisma";
import { canEditGoal } from "@/lib/alignment-scope";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { checkFileEdit } from "@/lib/access/node-placement";
import { roleAtLeast, type NodeKind, type NodeRef } from "@/lib/access/node-rules";
import { readableFileIds } from "@/lib/file-access";
import { gateItem } from "@/lib/item-gate";
import { LINK_NODE_KIND, LINK_TASK_TYPES, linkWriteVerdict, type LinkWriteFacts } from "@/lib/entity-link-ends";
import { loadReadableLinkEnds } from "@/lib/access/link-end-readable";

/** A session shape sufficient for the alignment-scope helpers. */
type SessionLike = { user?: { id?: string; organizationId?: string; accessLevel?: string } };

export async function canMutateLinkFromSource(
  session: SessionLike,
  orgId: string,
  source: { type: string; id: string },
): Promise<boolean> {
  if (source.type === "OKR") {
    const okr = await prisma.oKR.findFirst({
      where: { id: source.id, organizationId: orgId },
      select: { level: true, ownerId: true },
    });
    if (!okr) return false; // unknown / cross-org source: refuse the write
    return canEditGoal(session, { id: source.id, level: okr.level, ownerId: okr.ownerId });
  }
  if (source.type === "KEY_RESULT") {
    const kr = await prisma.keyResult.findFirst({
      where: { id: source.id, okr: { organizationId: orgId } },
      select: { okr: { select: { id: true, level: true, ownerId: true } } },
    });
    if (!kr) return false;
    return canEditGoal(session, kr.okr);
  }
  return true;
}

/**
 * The placement rule for adding or removing one link (node-rules P1, through
 * entity-link-ends linkWriteVerdict): null when the viewer may, else the
 * status and the one sentence the route answers with. Can edit on the source
 * node (a task by the task edit rule, a file by the file edit rule), and Can
 * view on the target; a source or a target out of sight is a 404.
 */
export async function linkWriteRefusalFor(
  viewer: { userId: string; organizationId: string; accessLevel: string },
  link: { sourceType: string; sourceId: string; targetType: string; targetId: string },
): Promise<{ status: 403 | 404; error: string } | null> {
  const org = viewer.organizationId;
  const ends = [{ type: link.sourceType, id: link.sourceId }, { type: link.targetType, id: link.targetId }];
  const taskIds = [...new Set(ends.filter((e) => LINK_TASK_TYPES.has(e.type)).map((e) => e.id))];
  const tasks = taskIds.length
    ? await prisma.item.findMany({ where: { organizationId: org, id: { in: taskIds } }, select: { id: true, boardId: true, ownerId: true, assigneeIds: true } })
    : [];
  const nodeRefs: NodeRef[] = [
    ...ends.flatMap((e) => (LINK_NODE_KIND[e.type] ? [{ kind: LINK_NODE_KIND[e.type] as NodeKind, id: e.id }] : [])),
    ...tasks.map((t) => ({ kind: "list" as NodeKind, id: t.boardId })),
  ];
  const fileIds = [...new Set(ends.filter((e) => e.type === "FILE").map((e) => e.id))];
  const ctx = nodeCtxFromLevel(viewer.userId, org, viewer.accessLevel);
  // A SOP, a goal, a key result, a KRA or a KPI end follows its own read rule
  // here too: a link never plants one the person cannot open, a guessed id or
  // another workspace's is not found, and nobody adds or removes links on one
  // they cannot read.
  const [decisions, readable, readableEnds] = await Promise.all([
    nodeRefs.length ? nodeRoles(ctx, nodeRefs) : Promise.resolve(new Map<string, { role: string }>()),
    fileIds.length ? readableFileIds({ ids: fileIds, viewer }) : Promise.resolve([] as string[]),
    loadReadableLinkEnds({ user: { id: viewer.userId, organizationId: org, accessLevel: viewer.accessLevel } }, org, ends),
  ]);
  const editableTasks = new Set<string>();
  if (LINK_TASK_TYPES.has(link.sourceType) && tasks.some((t) => t.id === link.sourceId)) {
    const gate = await gateItem(link.sourceId, { userId: viewer.userId, accessLevel: viewer.accessLevel, organizationId: org, userName: null }, "edit");
    if (!("error" in gate)) editableTasks.add(link.sourceId);
  }
  const editableFiles = new Set<string>();
  if (link.sourceType === "FILE") {
    const file = await prisma.fileEntry.findFirst({ where: { id: link.sourceId, organizationId: org }, select: { spaceId: true, spaceFolderId: true, uploadedById: true } });
    if (file && (await checkFileEdit(ctx, file)).ok) editableFiles.add(link.sourceId);
  }
  const roleOf = (kind: NodeKind, id: string) => (decisions.get(`${kind}:${id}`)?.role ?? "none") as Parameters<typeof roleAtLeast>[0];
  const facts: LinkWriteFacts = {
    userId: viewer.userId,
    nodeOpens: (kind, id) => roleAtLeast(roleOf(kind, id), "VIEW"),
    nodeEdits: (kind, id) => roleAtLeast(roleOf(kind, id), "EDIT"),
    readableFiles: new Set(readable),
    ...readableEnds,
    tasks: new Map(tasks.map((t) => [t.id, t])),
    editableTasks,
    editableFiles,
  };
  const verdict = linkWriteVerdict(link, facts);
  return verdict.ok ? null : { status: verdict.status, error: verdict.error };
}
