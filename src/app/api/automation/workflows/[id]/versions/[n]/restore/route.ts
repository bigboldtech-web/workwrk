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
//   2. The draft becomes version n's definition, trigger included. Where it
//      runs follows the save rule: the places the restorer cannot open stay
//      exactly as the draft has them now (version n's own hidden places are
//      not brought back, the draft's are not dropped), and the places they
//      can open come from version n. A version that ran Everywhere restores
//      as Everywhere, unless the draft keeps places the restorer cannot
//      open: that would drop them unseen, so it is refused and they can
//      choose Everywhere in Where it runs themselves.
//
// Both writes happen in one transaction, reading the draft under the row
// lock. Body {}. Returns { ok: true, draftUpdated: true, keptVersion: number | null }.

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { refuseWorkflowWrite, requireAutomation } from "@/lib/automation/gate";
import { SCOPE_REFUSAL, definitionWithScope, draftTrigger, isEverywhere, readScope, restoreHiddenScope, splitScope, stableJson, withoutSnapshotNote } from "@/lib/automation/definition";
import { scopeReadable } from "@/lib/automation/places-server";

const EVERYWHERE_OVER_HIDDEN = "That version runs everywhere, and this draft also runs in places you can't open. Restoring it would drop them, so choose Everywhere in Where it runs yourself, or ask someone who can open them to restore it.";
const HIDDEN_VERSION = "That version runs only in places you can't open, so it can't be restored here without making it run everywhere. Someone who can open them can restore it.";

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

  // The workflow row is locked for the transaction (as publish does), so a
  // restore and a publish at the same moment number their versions in turn.
  let result: { notFound: true } | { refused: { error: string; code: string } } | { notFound: false; keptVersion: number | null };
  try {
    result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AutomationWorkflow" WHERE "id" = ${wf.id} FOR UPDATE`;
    // The draft as it is now, under the lock: a save that landed after the
    // read above is the draft that is kept, never lost.
    const current = await tx.automationWorkflow.findUnique({ where: { id: wf.id }, select: { definition: true, triggerEvent: true } });
    if (current) { wf.definition = current.definition; wf.triggerEvent = current.triggerEvent; }
    const versions = await tx.automationWorkflowVersion.findMany({
      where: { workflowId: wf.id, organizationId: ctx.orgId },
      select: { versionNumber: true, definitionJson: true },
      orderBy: { versionNumber: "desc" },
    });
    const target = versions.find((v) => v.versionNumber === number);
    if (!target) return { notFound: true as const };

    // Where it runs, by the save rule (see the header).
    const stored = readScope(wf.definition);
    const fromVersion = readScope(target.definitionJson);
    const readable = await scopeReadable(ctx.viewer, [stored, fromVersion]);
    const { hidden } = splitScope(stored, readable);
    if (isEverywhere(fromVersion) && !isEverywhere(hidden)) return { refused: { error: EVERYWHERE_OVER_HIDDEN, code: "scope_everywhere_over_hidden" } };
    const { shown } = splitScope(fromVersion, readable);
    const scope = restoreHiddenScope({ stored, submitted: shown, hidden, readable, everywhere: isEverywhere(fromVersion) });
    if (!scope.ok) return { refused: { error: SCOPE_REFUSAL[scope.error], code: scope.error } };
    // A version that ran in chosen places never comes back as Everywhere: when
    // every one of its places is out of the restorer's sight and the draft
    // keeps none, nothing would be left to name.
    if (!isEverywhere(fromVersion) && isEverywhere(scope.scope)) return { refused: { error: HIDDEN_VERSION, code: "scope_hidden_version" } };

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
        definition: definitionWithScope({ ...restored, trigger: restoredTrigger }, scope.scope) as Prisma.InputJsonValue,
        // Before any publish nothing runs, so the column follows the draft.
        ...(wf.publishedVersionId ? {} : { triggerEvent: restoredTrigger }),
        updatedById: ctx.userId,
      },
    });
    return { notFound: false as const, keptVersion };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Somebody changed this automation's versions at the same moment. Reload and try again." }, { status: 409 });
    }
    throw err;
  }

  if ("refused" in result) return NextResponse.json({ ...result.refused, section: "where", issues: { section: "where" } }, { status: 400 });
  if (result.notFound) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ ok: true, draftUpdated: true, keptVersion: result.keptVersion });
}
