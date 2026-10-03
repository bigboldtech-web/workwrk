// /api/automation/workflows/[id]
//
// GET    the builder's data: the DRAFT definition and trigger, what is live,
//        whether the draft has unpublished changes, the version history, the
//        last 10 runs, and what the viewer may do (`can`).
// PUT    Save draft (manager or above until the access engine flips): name,
//        description, alert level, trigger and definition (conditions,
//        actions, trigger options, where it runs). A published automation's
//        trigger change is kept in the draft and goes live on Republish, so
//        a save never changes what a live automation does.
// DELETE Archive (Owner or Admin). It stops running and its run history is
//        kept; POST [id]/unarchive brings it back. Nothing is hard deleted.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { refuseWorkflowWrite, requireAutomation, triggerProblem, workflowRights } from "@/lib/automation/gate";
import { definitionForSave, definitionSchema } from "@/lib/automation/definition-schema";
import { SCOPE_REFUSAL, draftDiffersFromLive, draftTrigger, readScope, restoreHiddenScope, splitScope } from "@/lib/automation/definition";
import { definitionForViewer } from "@/lib/automation/definition-view";
import { draftRevision } from "@/lib/automation/draft-revision";
import { listVersions } from "@/lib/automation/versions-server";
import { definitionWithScopeInOrg, scopeNamer, scopeReadable } from "@/lib/automation/places-server";

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  triggerEvent: z.string().trim().min(1).max(200).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).optional(),
  definition: definitionSchema.optional(),
  /**
   * The draft revision the editor's page was loaded at (draftRevision). When
   * given, a save over a draft someone else changed since is refused (409,
   * stale_draft) instead of silently replacing their work; left out (saving
   * over theirs, chosen in the builder, or an older client) it is not checked.
   */
  baseRevision: z.string().trim().min(1).max(64).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          severity: true,
          triggerEventKey: true,
          recordType: true,
          recordId: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          createdAt: true,
        },
      },
    },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  const [versions, live, creator] = await Promise.all([
    listVersions(ctx.orgId, workflow.id, workflow.publishedVersionId),
    workflow.publishedVersionId
      ? prisma.automationWorkflowVersion.findFirst({
          where: { id: workflow.publishedVersionId, organizationId: ctx.orgId },
          select: { definitionJson: true },
        })
      : null,
    workflow.createdById
      ? prisma.user.findFirst({ where: { id: workflow.createdById, organizationId: ctx.orgId }, select: { firstName: true, lastName: true } })
      : null,
  ]);
  const trigger = draftTrigger(workflow.definition, workflow.triggerEvent);
  const liveTrigger = workflow.publishedVersionId ? workflow.triggerEvent : null;
  const namer = await scopeNamer(ctx.viewer, ctx.orgId, [readScope(workflow.definition)]);
  const rights = workflowRights(ctx, workflow.createdById);
  // The places the viewer cannot open are kept, never listed, named or
  // counted: the builder gets the rest and one "some are kept" flag.
  const forViewer = await definitionForViewer(ctx.viewer, workflow.definition);

  return NextResponse.json(
    {
      workflow: {
        ...workflow,
        definition: forViewer.definition,
        scopeHidden: forViewer.scopeHidden,
        scopeKept: forViewer.scopeKept,
        revision: draftRevision(workflow),
        // The draft trigger the builder edits; `liveTrigger` is what runs.
        triggerEvent: trigger,
        liveTrigger,
        unpublishedChanges: live ? draftDiffersFromLive(workflow.definition, trigger, live.definitionJson, liveTrigger) : false,
        versions,
        where: namer(readScope(workflow.definition)),
        createdByName: creator ? `${creator.firstName} ${creator.lastName}`.trim() : null,
        can: workflow.status === "ARCHIVED" ? { edit: false, archive: rights.archive } : rights,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "edit");
  if (refused) return refused;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const existing = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, publishedVersionId: true, triggerEvent: true, definition: true, name: true, description: true, severity: true },
  });
  if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (parsed.data.baseRevision && draftRevision(existing) !== parsed.data.baseRevision) return staleDraft();
  if (existing.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be edited" }, { status: 400 });
  }

  // The draft trigger: the body's triggerEvent, else the definition's, else
  // what the draft already had.
  const bodyTrigger =
    parsed.data.triggerEvent !== undefined
      ? parsed.data.triggerEvent ?? null
      : parsed.data.definition?.trigger !== undefined
        ? parsed.data.definition.trigger ?? null
        : undefined;
  if (bodyTrigger) {
    // A trigger the draft already has is never refused (an older workflow stays editable).
    const problem = await triggerProblem(ctx, bodyTrigger, draftTrigger(existing.definition, existing.triggerEvent));
    if (problem) return NextResponse.json({ error: problem, section: "when", issues: { section: "when" } }, { status: 400 });
  }

  const data: Prisma.AutomationWorkflowUpdateInput = { updatedById: ctx.userId };
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description ?? null;
  if (parsed.data.severity !== undefined) data.severity = parsed.data.severity;

  const published = Boolean(existing.publishedVersionId);
  if (parsed.data.definition !== undefined || bodyTrigger !== undefined) {
    let next: Record<string, unknown>;
    if (parsed.data.definition !== undefined) {
      // The places the editor cannot open are kept from the STORED row, never
      // from the body (it never carried them), and the body may add only
      // places the editor can open (restoreHiddenScope). Then the scope is
      // pruned to this workspace: a junk or foreign id is never stored.
      const stored = readScope(existing.definition);
      const submitted = readScope({ scope: parsed.data.definition.scope });
      const readable = await scopeReadable(ctx.viewer, [stored, submitted]);
      const { hidden } = splitScope(stored, readable);
      const restored = restoreHiddenScope({ stored, submitted, hidden, readable, everywhere: parsed.data.definition.everywhere });
      if (!restored.ok) return NextResponse.json({ error: SCOPE_REFUSAL[restored.error], code: restored.error, section: "where", issues: { section: "where" } }, { status: 400 });
      next = await definitionWithScopeInOrg(ctx.orgId, definitionForSave({ ...parsed.data.definition, scope: restored.scope }));
    } else {
      next = { ...((existing.definition as Record<string, unknown> | null) ?? {}) };
    }
    const trigger = bodyTrigger !== undefined ? bodyTrigger : draftTrigger(existing.definition, existing.triggerEvent);
    next.trigger = trigger;
    data.definition = next as Prisma.InputJsonValue;
    // Before the first publish nothing runs, so the column follows the
    // draft. After it, the column is the LIVE trigger and waits for Republish.
    if (!published) data.triggerEvent = trigger;
  }

  // With a base revision the check is made again under a row lock, so two
  // saves from two tabs at the same moment cannot both pass it.
  const baseRevision = parsed.data.baseRevision;
  const workflow = baseRevision
    ? await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AutomationWorkflow" WHERE "id" = ${id} FOR UPDATE`;
        const now = await tx.automationWorkflow.findUnique({ where: { id }, select: { name: true, description: true, severity: true, definition: true } });
        if (!now || draftRevision(now) !== baseRevision) return null;
        return tx.automationWorkflow.update({ where: { id }, data });
      })
    : await prisma.automationWorkflow.update({ where: { id }, data });
  if (!workflow) return staleDraft();
  // Answered as the builder reads it, so the hidden places never reach the page.
  const forViewer = await definitionForViewer(ctx.viewer, workflow.definition);
  return NextResponse.json({ workflow: { ...workflow, definition: forViewer.definition, scopeHidden: forViewer.scopeHidden, scopeKept: forViewer.scopeKept, triggerEvent: draftTrigger(workflow.definition, workflow.triggerEvent), revision: draftRevision(workflow) } });
}

/** Someone else saved the draft after this editor loaded it: nothing is written. */
function staleDraft() {
  return NextResponse.json(
    { error: "Someone else saved this automation after you opened it. Your changes are not saved yet.", code: "stale_draft" },
    { status: 409 },
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "archive");
  if (refused) return refused;

  const existing = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (existing.status === "ARCHIVED") return NextResponse.json({ archived: true });

  // Archive, never delete: the definition, its versions and its run history
  // all stay, and Unarchive brings it back as a paused automation.
  await prisma.automationWorkflow.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date(), updatedById: ctx.userId },
  });
  return NextResponse.json({ deleted: false, archived: true });
}
