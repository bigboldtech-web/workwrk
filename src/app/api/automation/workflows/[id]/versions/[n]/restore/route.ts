// POST /api/automation/workflows/[id]/versions/[n]/restore
//
// Copies version n's definition into the DRAFT. The live automation is not
// touched: it keeps running its published version until somebody
// republishes. Reversible by construction:
//
//   1. When the current draft has changes that no version holds (it differs
//      from every existing version), that draft is first kept as a NEW
//      AutomationWorkflowVersion row, marked kept-before-restore, so the
//      work is never lost and can itself be restored.
//   2. The draft becomes version n's definition, trigger included.
//
// Both writes happen in one transaction. Body {}. Returns
// { ok: true, draftUpdated: true, keptVersion: number | null }.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { refuseWorkflowWrite, requireAutomation } from "@/lib/automation/gate";
import { draftTrigger, stableJson, withoutSnapshotNote } from "@/lib/automation/definition";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id, n } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "edit");
  if (refused) return refused;
  const number = Number.parseInt(n, 10);
  if (!Number.isFinite(number) || number < 1) return NextResponse.json({ error: "Invalid version number" }, { status: 400 });

  const wf = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, publishedVersionId: true, triggerEvent: true, definition: true },
  });
  if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (wf.status === "ARCHIVED") return NextResponse.json({ error: "Archived workflows cannot be edited" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const versions = await tx.automationWorkflowVersion.findMany({
      where: { workflowId: wf.id, organizationId: ctx.orgId },
      select: { versionNumber: true, definitionJson: true },
      orderBy: { versionNumber: "desc" },
    });
    const target = versions.find((v) => v.versionNumber === number);
    if (!target) return { notFound: true as const };

    const trigger = draftTrigger(wf.definition, wf.triggerEvent);
    const draftNow = stableJson({ ...withoutSnapshotNote(wf.definition), trigger });
    // A version written before drafts carried their trigger ran the column's.
    const heldSomewhere = versions.some(
      (v) => stableJson({ ...withoutSnapshotNote(v.definitionJson), trigger: draftTrigger(v.definitionJson, wf.triggerEvent) }) === draftNow,
    );

    let keptVersion: number | null = null;
    if (!heldSomewhere) {
      keptVersion = (versions[0]?.versionNumber ?? 0) + 1;
      await tx.automationWorkflowVersion.create({
        data: {
          organizationId: ctx.orgId,
          workflowId: wf.id,
          versionNumber: keptVersion,
          definitionJson: {
            ...withoutSnapshotNote(wf.definition),
            trigger,
            __snapshot: { reason: "kept-before-restore", restoredFrom: number },
          } as Prisma.InputJsonValue,
          isPublished: false,
          createdById: ctx.userId,
        },
      });
    }

    const restored = withoutSnapshotNote(target.definitionJson);
    const restoredTrigger = draftTrigger(restored, wf.triggerEvent);
    await tx.automationWorkflow.update({
      where: { id: wf.id },
      data: {
        definition: { ...restored, trigger: restoredTrigger } as Prisma.InputJsonValue,
        // Before any publish nothing runs, so the column follows the draft.
        ...(wf.publishedVersionId ? {} : { triggerEvent: restoredTrigger }),
        updatedById: ctx.userId,
      },
    });
    return { notFound: false as const, keptVersion };
  });

  if (result.notFound) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ ok: true, draftUpdated: true, keptVersion: result.keptVersion });
}
