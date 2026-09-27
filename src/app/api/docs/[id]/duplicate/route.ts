// POST /api/docs/[id]/duplicate: clone a doc as a fresh note.
//
// Copies title (with " (copy)" suffix), content, meta, excerpt, the
// entityType/entityId anchor and the parent page, so the copy sits beside the
// original and is open to exactly the people who reach that place. The actor
// must be able to create a doc there (canCreateDocAt, the rule POST /api/docs
// applies, a locked parent page included), and the place must still be live
// (docPlaceLive: never into an archived Space or a Folder in Trash): a grant on
// one doc never plants a copy in a Folder or Space the person holds no role
// on, where they could not open it.
//
// A restricted source (node-rules docCopyVerdict): its copy keeps the
// restriction and the people listed, and only someone who may change who
// opens the source (Can edit on it) makes one. A Can view holder of a
// restricted page once copied it into an open copy the whole Folder read.
//
// Does NOT carry over comments or version history: those belong to the
// original. Generates new block ids so the clone doesn't accidentally share
// comment threads via blockId.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canCreateDocAt, docAccess } from "@/lib/doc-access";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { RESTRICTED_COPY_REFUSAL, docCopyVerdict } from "@/lib/access/node-rules";
import { docPlaceLive } from "@/lib/access/node-placement";
import { docSharingEntries, lockOrgSettings, writeDocSharingEntry } from "@/lib/access/access-grant-store";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const original = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: {
      title: true, content: true, excerpt: true,
      id: true, entityType: true, entityId: true, parentId: true, archivedAt: true, createdById: true,
    },
  });
  if (!original) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The one resolver: no role (a restricted doc that does not list the
  // viewer included) is the same 404 as a doc that is not there.
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const access = await docAccess(nodeCtx, original.id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (original.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  // A restricted source keeps its restriction on the copy, and only the
  // people who may change who opens it make one.
  const sharing = (await docSharingEntries(ctx.orgId, [original.id])).get(original.id);
  const verdict = docCopyVerdict(sharing, access.unlockedRole, { sourceCreatorId: original.createdById, copierId: ctx.userId });
  if (!verdict.ok) return NextResponse.json({ error: RESTRICTED_COPY_REFUSAL, code: "forbidden", message: RESTRICTED_COPY_REFUSAL }, { status: 403 });

  const anchor = original.entityType && original.entityId ? { entityType: original.entityType, entityId: original.entityId } : null;
  if (!(await docPlaceLive(ctx.orgId, { entityType: original.entityType, entityId: original.entityId, parentId: original.parentId }))) {
    const message = "The place this doc lives in is archived or in Trash, so nothing can be added to it.";
    return NextResponse.json({ error: message, code: "place_gone", message }, { status: 400 });
  }
  if (!(await canCreateDocAt(nodeCtx, anchor, original.parentId))) {
    // The sentence rides in `error` because apiFetch, and so every toast
    // built on r.error, reads `error` first: as "forbidden" it reached the
    // person as that one bare word. The code moves to `code`.
    const message = "You can't add docs where this one lives, so it can't be copied there.";
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }

  // Re-key every block so the clone's comment-storage namespace (which
  // is `${docId}:${blockId}`) is fresh: no chance of a comment thread
  // unexpectedly attaching to the new doc through a recycled block id.
  const clonedContent = remintBlockIds(original.content);

  // The copy, its first version and (for a restricted source) its sharing
  // entry in one transaction: a copy never exists, even for a moment, open
  // to readers its source is hidden from.
  const carry = verdict.carry;
  const created = await prisma.$transaction(async (tx) => {
    const doc = await tx.doc.create({
      data: {
        organizationId: ctx.orgId,
        title: `${original.title} (copy)`,
        content: clonedContent as object,
        excerpt: original.excerpt,
        entityType: original.entityType,
        entityId: original.entityId,
        parentId: original.parentId,
        createdById: ctx.userId,
      },
      select: { id: true, title: true, content: true, excerpt: true, updatedAt: true, createdAt: true },
    });
    // Seed v1 immediately so the new doc has a non-empty version trail.
    await tx.docVersion.create({
      data: { docId: doc.id, version: 1, title: doc.title, content: clonedContent as object, authorId: ctx.userId },
    });
    if (carry) {
      await lockOrgSettings(tx, ctx.orgId);
      await writeDocSharingEntry(tx, ctx.orgId, doc.id, carry);
    }
    return doc;
  });

  return NextResponse.json({ doc: created, restricted: !!carry });
}

function remintBlockIds(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return content;
  const blocks = c.blocks.map((b) => {
    if (!b || typeof b !== "object") return b;
    const bb = b as { id?: string };
    return { ...bb, id: Math.random().toString(36).slice(2, 10) };
  });
  return { ...(c as object), blocks };
}
