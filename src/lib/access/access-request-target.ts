// Who answers a Request access, and where the inbox row opens (Phase 8
// stage E; moved out of POST /api/access-requests so the decision route
// shares it). The object's owner, else nobody named (the caller then asks
// the workspace Owners and Admins); the link is the object's own page, where
// the owner can share it. An object type with no page gets no link.

import { prisma } from "@/lib/prisma";
import { addressHref, workDoorHref } from "@/lib/nav/object-href";

export const OWNER_FIELD: Record<string, "space" | "board" | "folder" | "sop" | "sop_folder" | "contract" | "tool" | "goal" | "doc" | "table" | "canvas" | "form" | null> = {
  space: "space",
  board: "board",
  list: "board",
  folder: "folder",
  // The process unit's read-only banner (spec-process section 1): a Can
  // view / Can comment viewer of a SOP asks its author (a filed SOP asks
  // the folder's managers, who are the org admins today).
  sop: "sop",
  sop_folder: "sop_folder",
  // A Member party on /agreements/[id] asks the contract's sender.
  contract: "contract",
  // The Tool drawer's read-only banner (spec-tools-misc 2.1): a Can view
  // holder asks whoever added the tool.
  tool: "tool",
  // The goal page's read-only banner (spec-goals /okrs/[id]): a Can view
  // viewer asks the goal's owner for Can edit (no owner: the admins).
  goal: "goal",
  // Docs, Tables, Canvases and Forms ask their creator (the Full holder by
  // rule 5), and the inbox row opens the object's Work address, where the
  // Manage access dialog shares it. No creator: the workspace admins.
  doc: "doc",
  table: "table",
  canvas: "canvas",
  whiteboard: "canvas",
  form: "form",
};

export type RequestTarget = { ownerId: string | null; link: string | null };

/**
 * Who to notify and where the notification opens: the object's own page,
 * where the owner can share it (a Space or List by slug, a Folder by id).
 * An object type with no page gets no link rather than a dead one.
 */
export async function requestTargetFor(type: string, id: string, organizationId: string): Promise<RequestTarget> {
  const model = OWNER_FIELD[type] ?? null;
  if (!model) return { ownerId: null, link: null };
  const where = { id, organizationId } as const;
  try {
    if (model === "space") {
      const s = await prisma.space.findFirst({ where, select: { ownerId: true, slug: true } });
      return { ownerId: s?.ownerId ?? null, link: s ? `/spaces/${s.slug}` : null };
    }
    if (model === "board") {
      const b = await prisma.board.findFirst({ where, select: { ownerId: true, slug: true } });
      return { ownerId: b?.ownerId ?? null, link: b ? `/boards/${b.slug}` : null };
    }
    if (model === "folder") {
      const f = await prisma.folder.findFirst({ where, select: { ownerId: true } });
      return { ownerId: f?.ownerId ?? null, link: f ? `/folders/${id}` : null };
    }
    if (model === "sop") {
      const s = await prisma.sOP.findFirst({ where, select: { createdById: true } });
      return { ownerId: s?.createdById ?? null, link: s ? addressHref("sop", id, { scope: "work" }) : null };
    }
    if (model === "sop_folder") {
      const f = await prisma.sOPFolder.findFirst({ where, select: { id: true } });
      return { ownerId: null, link: f ? "/sops/manage?tab=sop-folders" : null };
    }
    if (model === "tool") {
      const t = await prisma.tool.findFirst({ where, select: { addedBy: true } });
      return { ownerId: t?.addedBy ?? null, link: t ? `/tools?tool=${id}` : null };
    }
    if (model === "goal") {
      const g = await prisma.oKR.findFirst({ where, select: { ownerId: true } });
      return { ownerId: g?.ownerId ?? null, link: g ? `/okrs/${id}` : null };
    }
    if (model === "doc") {
      const d = await prisma.doc.findFirst({ where, select: { createdById: true } });
      return { ownerId: d?.createdById ?? null, link: d ? workDoorHref("doc", id) : null };
    }
    if (model === "table") {
      const t = await prisma.dataTable.findFirst({ where, select: { createdById: true } });
      return { ownerId: t?.createdById ?? null, link: t ? workDoorHref("table", id) : null };
    }
    if (model === "canvas") {
      const w = await prisma.whiteboard.findFirst({ where, select: { ownerId: true } });
      return { ownerId: w?.ownerId ?? null, link: w ? workDoorHref("canvas", id) : null };
    }
    if (model === "form") {
      const f = await prisma.formDefinition.findFirst({ where, select: { createdById: true } });
      return { ownerId: f?.createdById ?? null, link: f ? workDoorHref("form", id) : null };
    }
    if (model === "contract") {
      const a = await prisma.agreement.findFirst({ where, select: { createdById: true } });
      return { ownerId: a?.createdById ?? null, link: a ? `/agreements/${id}` : null };
    }
  } catch {
    // A model without ownerId, or a table this org never wrote: fall through.
  }
  return { ownerId: null, link: null };
}


/**
 * The object's own name for the deciders' list (the owner or an Admin reads
 * it, so it is shown only to people who already see requests on it). Null
 * when the kind has no name to show or the row is gone.
 */
export async function requestObjectName(type: string, id: string, organizationId: string): Promise<string | null> {
  const where = { id, organizationId } as const;
  try {
    switch (type) {
      case "space":
        return (await prisma.space.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "board":
      case "list":
        return (await prisma.board.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "folder":
        return (await prisma.folder.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "doc":
        return (await prisma.doc.findFirst({ where, select: { title: true } }))?.title ?? null;
      case "table":
        return (await prisma.dataTable.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "canvas":
      case "whiteboard":
        return (await prisma.whiteboard.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "form":
        return (await prisma.formDefinition.findFirst({ where, select: { name: true } }))?.name ?? null;
      case "sop":
        return (await prisma.sOP.findFirst({ where, select: { title: true } }))?.title ?? null;
      case "goal":
        return (await prisma.oKR.findFirst({ where, select: { title: true } }))?.title ?? null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
