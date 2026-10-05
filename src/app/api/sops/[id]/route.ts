import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, hasPermission, isOrgAdmin, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { broadcastWebhook } from "@/lib/webhooks";
import { enrichScribeScreenshots } from "@/lib/scribe-enrich";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
import { syncLinksFromBlocks } from "@/lib/doc-link-extract";
import { canWriteToFolder, folderGrantRole, resolveSopViewerRole } from "@/lib/sop-access";
import { isSOPContentEmpty, isSOPTitleEmpty } from "@/lib/sop-content";
import { getSopKind, getSopLayout } from "@/lib/sop-kind";
import { moveToTrash } from "@/lib/trash";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
    include: {
      compliance: {
        take: 20,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      folder: { select: { id: true, name: true, color: true, parentId: true } },
    },
  });

  if (!sop) return jsonError("SOP not found", 404);

  // The viewer's own assignment and active run (spec-process section 2
  // `/sops/[id]` Data: `myAssignment`, `myRun`, `access.role`), so the page
  // decides its one blue button from the payload instead of a second hop.
  const userId = getUserId(session);

  // Visibility: the same rule as the list (sopVisibilityWhere). Admins see
  // everything; the author sees their own; an assignee sees what was
  // assigned to them; a filed SOP needs a grant on its folder OR an
  // ancestor (grants cascade), and a Can view grant reads published SOPs
  // only; an unfiled SOP reads for everyone once published (or archived),
  // and before that only for the people who could edit it.
  if (!isOrgAdmin(session) && sop.createdById !== userId) {
    const assigned = !!(await prisma.sOPAssignment.findUnique({ where: { sopId_userId: { sopId: id, userId } }, select: { id: true } }));
    if (!assigned) {
      const readable = sop.status === "PUBLISHED" || sop.status === "ARCHIVED";
      if (sop.folderId) {
        const grant = await folderGrantRole(session, sop.folderId);
        if (!grant) return jsonError("SOP not found", 404);
        if (!readable && grant === "VIEWER") return jsonError("SOP not found", 404);
      } else if (!readable && !(await hasPermission(session, "sops", "edit"))) {
        return jsonError("SOP not found", 404);
      }
    }
  }

  const [myAssignment, myRun] = await Promise.all([
    prisma.sOPAssignment.findUnique({
      where: { sopId_userId: { sopId: id, userId } },
      select: { id: true, status: true, dueDate: true, mandatory: true, completedAt: true, stepsTotal: true, stepsCompleted: true },
    }),
    sop.sopType === "CHECKLIST"
      ? prisma.processRun.findFirst({
          where: { sopId: id, assigneeId: userId, status: { in: ["ACTIVE", "OVERDUE"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, shareToken: true, progress: true, status: true, dueDate: true, title: true },
        })
      : Promise.resolve(null),
  ]);
  const role = await resolveSopViewerRole(session, sop, !!myAssignment);

  const enriched = await enrichScribeScreenshots(sop as Parameters<typeof enrichScribeScreenshots>[0]);
  // For blocks-format WRITTEN SOPs, also refresh image / file URLs.
  const final = enriched && enriched.content
    ? { ...enriched, content: await presignBlocksImagesAndFiles(enriched.content) }
    : enriched;
  return jsonSuccess({
    ...final,
    kind: getSopKind(sop.sopType, sop.content),
    layout: getSopLayout(sop.content),
    myAssignment: myAssignment
      ? { assignmentId: myAssignment.id, status: myAssignment.status, dueDate: myAssignment.dueDate, mandatory: myAssignment.mandatory, completedAt: myAssignment.completedAt, stepsTotal: myAssignment.stepsTotal, stepsCompleted: myAssignment.stepsCompleted }
      : null,
    myRun,
    access: { role },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "edit");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  // Edit gate: the author, a folder Editor/Owner, or an org admin may
  // edit. (canWriteToFolder now requires an EDITOR/OWNER folder role.)
  const isAuthor = existing.createdById === getUserId(session);
  if (!isAuthor && !(await canWriteToFolder(session, existing.folderId))) {
    return jsonError("You can only edit SOPs you authored or have edit access to.", 403);
  }

  const body = await req.json();
  // `version` is deliberately not read — the server owns version
  // numbers (bumped below when a snapshot is taken). A client-sent
  // version let two SOPVersion rows share a number. `sopType` is also
  // not accepted: changing it post-create would orphan the content
  // shape.
  const { title: rawTitle, description: rawDescription, category, subcategory, content, status, folderId, tags, kraId } = body;
  // Publish confirm switch "Require everyone to acknowledge again"
  // (spec-process section 2): a fresh acknowledgement round resets every
  // completed assignment to Assigned. Only read alongside a publish.
  const reacknowledge = body?.reacknowledge === true;

  // Same trim rule as POST. Treat a whitespace-only string as an
  // intentional blank, which the PUBLISHED guard below will catch.
  const title = typeof rawTitle === "string" ? rawTitle.trim() : rawTitle;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : rawDescription;

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (category !== undefined) data.category = category;
  if (subcategory !== undefined) data.subcategory = subcategory;
  if (content !== undefined) data.content = content;
  if (tags !== undefined) {
    data.tags = Array.isArray(tags)
      ? Array.from(new Set(
          tags.map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
              .filter((t: string) => t.length > 0 && t.length <= 40),
        ))
      : [];
  }

  // Link/unlink the owning KRA. `null` clears; a non-null id must be a
  // KRA in this org so a cross-org id can't be attached.
  if (kraId !== undefined) {
    if (kraId === null) {
      data.kraId = null;
    } else {
      const kra = await prisma.kRA.findFirst({
        where: { id: kraId, organizationId: orgId },
        select: { id: true },
      });
      if (!kra) return jsonError("KRA not found", 404);
      data.kraId = kraId;
    }
  }

  // Moving between folders requires write access on the target too.
  // Moving TO the unfoldered bucket (null) is allowed for anyone with
  // write access on the current folder.
  if (folderId !== undefined) {
    const next: string | null = folderId || null;
    if (next) {
      const folder = await prisma.sOPFolder.findFirst({
        where: { id: next, organizationId: orgId },
        select: { id: true, name: true, parentId: true },
      });
      if (!folder) return jsonError("Target folder not found", 404);
      if (!(await canWriteToFolder(session, next))) {
        return jsonError("You don't have access to the target folder", 403);
      }
      // One taxonomy: the folder chain IS the category. Mirror its names into
      // the legacy category/subcategory strings so every older reader (list
      // chips, filters, exports) agrees with the tree. A top-level folder is
      // the category; a nested one contributes (top ancestor, itself).
      let top = folder;
      while (top.parentId) {
        const parent = await prisma.sOPFolder.findFirst({
          where: { id: top.parentId, organizationId: orgId },
          select: { id: true, name: true, parentId: true },
        });
        if (!parent) break;
        top = parent;
      }
      data.category = top.name;
      data.subcategory = top.id === folder.id ? null : folder.name;
    } else {
      data.category = null;
      data.subcategory = null;
    }
    data.folderId = next;
  }

  // Editing a PUBLISHED row directly is allowed but dangerous — we
  // had four prod SOPs end up empty because a PATCH (or a publish
  // accepting a blank form) overwrote the live row with no recovery
  // path. Two guards:
  //   1) Refuse a mutation that would blank title/content/description.
  //      Customers should archive, not silently empty a published SOP.
  //   2) Snapshot the pre-mutation state to SOPVersion before changing
  //      title/content/description on a PUBLISHED row, so a future
  //      blank still has somewhere to roll back from.
  const touchesContent = data.content !== undefined;
  const touchesTitle = data.title !== undefined;
  const touchesDescription = data.description !== undefined;
  const isAlreadyPublished = existing.status === "PUBLISHED";

  if (isAlreadyPublished) {
    if (touchesTitle && isSOPTitleEmpty(data.title)) {
      return jsonError("Cannot blank the title of a published SOP. Archive it instead.");
    }
    if (touchesContent && isSOPContentEmpty(data.content)) {
      return jsonError("Cannot blank the content of a published SOP. Archive it instead.");
    }

    if (touchesContent || touchesTitle || touchesDescription) {
      await prisma.sOPVersion.create({
        data: {
          sopId: id,
          version: existing.version,
          title: existing.title,
          description: existing.description,
          content: existing.content as Prisma.InputJsonValue,
          publishedBy: getUserId(session),
        },
      });
      // Snapshot taken under the old number → the live row moves to the
      // next one, so no two SOPVersion rows ever share a number.
      data.version = existing.version + 1;
    }
  }

  if (status !== undefined) {
    if (status === "PUBLISHED") {
      // Publishing requires the dedicated capability (split out from edit).
      const publishDenied = await requirePermission(session, "sops", "publish");
      if (publishDenied) return publishDenied;
      // Validating before the publish write-through prevents the
      // original bug: a publish that accepts blank form values and
      // silently nukes the live row. Helper covers `null`, `{}`, and
      // mixed-shape edge cases the inline check used to miss.
      const proposedTitle = (data.title as string | undefined) ?? existing.title;
      const proposedContent = data.content !== undefined ? data.content : existing.content;

      if (isSOPTitleEmpty(proposedTitle)) {
        return jsonError("SOP title is required before publishing");
      }
      if (isSOPContentEmpty(proposedContent)) {
        return jsonError("Add some content before publishing");
      }

      data.status = status;
      data.publishedAt = new Date();
      data.publishedBy = getUserId(session);
      // Snapshot the existing pre-publish state so we can roll back to
      // the prior draft if needed. Skip if we already snapshotted above
      // (PUBLISHED → PUBLISHED with content edits already wrote one).
      if (!isAlreadyPublished) {
        await prisma.sOPVersion.create({
          data: {
            sopId: id,
            version: existing.version,
            title: existing.title,
            description: existing.description,
            content: existing.content as Prisma.InputJsonValue,
            publishedBy: getUserId(session),
          },
        });
        // Same rule as the published-edit snapshot above: the snapshot
        // keeps the old number, the live row advances.
        data.version = existing.version + 1;
      }
    } else {
      data.status = status;
    }
  }

  const updated = await prisma.sOP.update({
    where: { id },
    data,
    include: {
      compliance: {
        take: 20,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (status === "PUBLISHED" && reacknowledge) {
    await prisma.sOPAssignment.updateMany({
      where: { sopId: id, status: "COMPLETED" },
      data: { status: "ASSIGNED", completedAt: null, stepsCompleted: 0 },
    });
  }

  if (status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    broadcastWebhook({
      organizationId: getOrgId(session),
      event: "sop_published",
      payload: { sopId: id, title: updated.title, category: updated.category },
    });
  }

  // Sync EntityLink graph for backlinks. Only blocks-format SOP
  // content holds the references we know how to extract.
  const updatedContent = updated.content as { type?: string } | null;
  if (updatedContent && updatedContent.type === "blocks") {
    void syncLinksFromBlocks({
      organizationId: getOrgId(session),
      sourceType: "SOP",
      sourceId: id,
      content: updated.content,
      createdById: (session as { user: { id: string } }).user.id,
    }).catch((err) => {
      console.warn("[sops PATCH] syncLinksFromBlocks failed", err);
    });
  }

  const enriched = await enrichScribeScreenshots(updated as Parameters<typeof enrichScribeScreenshots>[0]);
  return jsonSuccess({ ...enriched, kind: getSopKind(updated.sopType, updated.content), layout: getSopLayout(updated.content) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "delete");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  // Folder write access required to delete.
  if (!(await canWriteToFolder(session, existing.folderId))) {
    return jsonError("You don't have access to this SOP's folder", 403);
  }

  await moveToTrash("sop", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });

  return jsonSuccess({ success: true });
}
