// /api/automation/workflows
//
// GET  the workspace's automations for the Workflows list (spec-ai-automation
//      /automation/workflows). Query, every parameter optional:
//        ?status=  a view word (all, active, drafts, paused, errors) or a
//                  stored status (ACTIVE, DRAFT, INACTIVE, ERROR, ARCHIVED)
//        ?includeArchived=1   Show archived (the All view)
//        ?q=  ?createdBy=  ?trigger=  ?severity=  ?where=   (comma lists)
//        ?listId= | ?folderId= | ?spaceId=   the container a "..." menu
//                  arrived with: only automations scoped there
//        ?sort=  updated (default), name, lastRun, success
//        ?cursor=  ?take=   offset paging, default 40, at most 100
//      Returns { workflows, total, nextCursor, container, creators, paused,
//      rights }. Every row carries `can` (edit, archive) and `where` (the
//      readable names of the places it runs in; a place the viewer cannot
//      read is counted, never named).
// POST create a DRAFT (manager or above until the access engine flips).
//      Body { name, description?, triggerEvent?, severity?, definition? },
//      where definition may carry the scope a container prefilled.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { forbidden, requireAutomation, workflowRights } from "@/lib/automation/gate";
import { getTrigger } from "@/lib/automation/registry-triggers";
import { definitionForSave, definitionSchema } from "@/lib/automation/definition-schema";
import { readScope } from "@/lib/automation/definition";
import { readAutomationSettings } from "@/lib/automation/settings";
import { containerContents, scopeNamer } from "@/lib/automation/places-server";
import {
  VIEW_STATUS,
  WORKFLOW_VIEWS,
  filterWorkflows,
  pageOf,
  parseOffsetCursor,
  parseSort,
  parseTake,
  sortWorkflows,
  type ListFilters,
  type WorkflowView,
} from "@/lib/automation/workflow-list";

const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ERROR", "ARCHIVED"] as const;
/** A bounded read: a workspace with more automations than this pages the newest. */
const READ_CAP = 2000;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).nullish(),
  triggerEvent: z.string().trim().min(1).max(200).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).optional(),
  definition: definitionSchema.optional(),
});

function list(sp: URLSearchParams, key: string): string[] {
  return (sp.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

export async function GET(req: NextRequest) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;

  const sp = req.nextUrl.searchParams;
  const statusParam = sp.get("status");
  let view: WorkflowView = "all";
  let archivedOnly = false;
  if (statusParam) {
    const upper = statusParam.toUpperCase();
    const lower = statusParam.toLowerCase();
    if (upper === "ARCHIVED") archivedOnly = true;
    else if ((WORKFLOW_STATUSES as readonly string[]).includes(upper)) {
      view = (Object.entries(VIEW_STATUS).find(([, s]) => s === upper)?.[0] as WorkflowView) ?? "all";
    } else if ((WORKFLOW_VIEWS as readonly string[]).includes(lower)) {
      view = lower as WorkflowView;
    } else {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
  }

  // The container a Space, Folder or List "..." menu sent.
  const containerKind = sp.get("listId") ? "list" : sp.get("folderId") ? "folder" : sp.get("spaceId") ? "space" : null;
  const containerId = containerKind ? (sp.get(`${containerKind}Id`) ?? "").trim() : "";
  let container: ListFilters["container"] = null;
  let containerOut: { kind: string; id: string; name: string | null } | null = null;
  if (containerKind && containerId) {
    const contents = await containerContents(ctx.orgId, containerKind, containerId);
    if (!contents) return NextResponse.json({ error: "That place is not in this workspace" }, { status: 404 });
    // The name is shown only when the viewer can read the container.
    const own = readScope({ scope: { [`${containerKind}Ids`]: [containerId] } });
    const namer = await scopeNamer(ctx.viewer, ctx.orgId, [own]);
    container = { kind: containerKind, id: containerId, listIds: contents.listIds, folderIds: contents.folderIds };
    containerOut = { kind: containerKind, id: containerId, name: namer(own).names[0] ?? null };
  }

  const rows = await prisma.automationWorkflow.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    take: READ_CAP,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      severity: true,
      triggerEvent: true,
      definition: true,
      publishedVersionId: true,
      publishedAt: true,
      lastRunAt: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const ids = rows.map((w) => w.id);
  const creatorIds = [...new Set(rows.map((w) => w.createdById).filter((v): v is string => !!v))];
  const [runStats, creators, org] = await Promise.all([
    ids.length
      ? prisma.automationRun.groupBy({
          by: ["workflowId", "status"],
          where: { organizationId: ctx.orgId, workflowId: { in: ids } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    creatorIds.length
      ? prisma.user.findMany({
          where: { id: { in: creatorIds }, organizationId: ctx.orgId },
          select: { id: true, firstName: true, lastName: true, avatar: true },
        })
      : Promise.resolve([]),
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }),
  ]);

  const statsByWorkflow = new Map<string, Record<string, number>>();
  for (const row of runStats) {
    const bucket = statsByWorkflow.get(row.workflowId) ?? {};
    bucket[row.status] = row._count._all;
    statsByWorkflow.set(row.workflowId, bucket);
  }
  const creatorById = new Map(creators.map((u) => [u.id, { name: `${u.firstName} ${u.lastName}`.trim(), avatar: u.avatar ?? null }]));

  const enriched = rows.map((w) => {
    const counts = statsByWorkflow.get(w.id) ?? {};
    const success = counts.SUCCESS ?? 0;
    const terminal = success + (counts.FAILED ?? 0) + (counts.PARTIAL ?? 0);
    return {
      ...w,
      runCounts: counts,
      totalRuns: Object.values(counts).reduce((a, b) => a + b, 0),
      successRuns: success,
      terminalRuns: terminal,
      successRate: terminal > 0 ? Math.round((success / terminal) * 100) : null,
    };
  });

  const filters: ListFilters = {
    view,
    showArchived: sp.get("includeArchived") === "1",
    q: sp.get("q"),
    createdBy: list(sp, "createdBy"),
    triggers: list(sp, "trigger"),
    severities: list(sp, "severity").map((s) => s.toUpperCase()),
    where: list(sp, "where"),
    container,
  };
  const filtered = archivedOnly
    ? enriched.filter((w) => w.status === "ARCHIVED")
    : filterWorkflows(enriched, filters);
  const sorted = sortWorkflows(filtered, parseSort(sp.get("sort")));
  const take = parseTake(sp.get("take"));
  const { page, total, nextCursor, offset } = pageOf(sorted, parseOffsetCursor(sp.get("cursor")), take);

  const namer = await scopeNamer(ctx.viewer, ctx.orgId, page.map((w) => readScope(w.definition)));

  return NextResponse.json(
    {
      workflows: page.map((w) => {
        const { definition, ...rest } = w;
        const creator = w.createdById ? creatorById.get(w.createdById) : undefined;
        return {
          ...rest,
          createdByName: creator?.name ?? null,
          createdByAvatar: creator?.avatar ?? null,
          where: namer(readScope(definition)),
          can: ((r) => (w.status === "ARCHIVED" ? { edit: false, archive: r.archive } : r))(workflowRights(ctx, w.createdById)),
        };
      }),
      total,
      offset,
      nextCursor,
      container: containerOut,
      creators: creators.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })),
      paused: readAutomationSettings(org?.settings).paused,
      rights: { canCreate: ctx.canCreate, isAdmin: ctx.isAdmin },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.canCreate) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const definition = definitionForSave(parsed.data.definition ?? {});
  const triggerEvent = parsed.data.triggerEvent ?? (typeof definition.trigger === "string" ? definition.trigger : null);
  if (triggerEvent && !getTrigger(triggerEvent)) {
    return NextResponse.json({ error: `Unknown trigger event: ${triggerEvent}` }, { status: 400 });
  }
  if (triggerEvent) definition.trigger = triggerEvent;

  const workflow = await prisma.automationWorkflow.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: "DRAFT",
      severity: parsed.data.severity ?? "MINOR",
      // Never published, so the column and the draft agree until the first
      // publish; after that the column is the LIVE trigger.
      triggerEvent,
      definition: definition as Prisma.InputJsonValue,
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
  });

  return NextResponse.json({ workflow }, { status: 201 });
}
