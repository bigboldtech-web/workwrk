// Materialize the "Tuesday: client onboarding" template
// (src/lib/templates/tuesday-template.ts) and apply it once at signup.
//
// WHAT IT MAKES. The Space and its Onboarding List (through
// applySpaceTemplate, the Template Center's own path), the playbook doc in
// the Space, and one sample task. With `governance` (the applier is a
// workspace admin: always true at signup, where the applier is the Owner)
// also the two job titles, the KRA on the Onboarding lead title, the KPI on
// the KRA, the published step-by-step SOP owned by the KRA whose steps carry
// their job titles (step 3 creates a task when the SOP is run, on the
// Onboarding List by default), and the Company goal linked to the KRA and to
// the List so its Effort card shows the work. A manager applying it from the
// Template Center gets the Space, the List, the doc and the sample task:
// job titles, KRAs, KPIs, SOPs and company goals are admin-owned objects
// with their own gates, and a gallery click must not mint them.
//
// FIND OR CREATE, EVERY PIECE. Each piece is looked up first (a job title by
// its unique title, the KRA by name on that title, the KPI by name on the
// KRA, the SOP by title on the KRA, the goal by title, the List, the doc and
// the sample task by name inside the Space), so a retry after a failure part
// way finishes the rest without doubling anything, and a second gallery
// apply reuses the workspace's existing job titles and governance rather
// than cloning them.
//
// ONCE AT SIGNUP. applySignupTemplate claims Organization.settings
// .signupTemplate with one conditional UPDATE before it writes anything, so
// two calls can never both apply it; it refuses a workspace that is not
// brand new (older than a day, or with more than its one Owner); POST
// /api/auth/register is its only caller (never /join, never a second org).
// A failure is recorded on the marker (status "failed", with the Space id
// when one was made) and the setup wizard offers Try again, which resumes
// through retrySignupTemplate.
//
// Server only: prisma.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { applyDocTemplate, applyListTemplate, applySpaceTemplate } from "@/lib/template-center";
import { createBoardItem } from "@/lib/board-items";
import { seedKraToRoleHolders } from "@/lib/alignment-assign";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { checkPlanLimit } from "@/lib/plan-limits";
import { TUESDAY_TEMPLATE_KEY, TUESDAY_TEMPLATE_ROW, tuesdayPayload, type TuesdayPayload } from "@/lib/templates/tuesday-template";
import { archiveRowId } from "@/lib/trash-view";

export interface TuesdayApplied {
  spaceId: string;
  spaceSlug: string;
  boardId: string;
  boardSlug: string;
  docId: string | null;
  sampleTaskId: string | null;
  sopId: string | null;
  kraId: string | null;
  kpiId: string | null;
  goalId: string | null;
  jobTitleIds: string[];
  governance: boolean;
  /** Pieces left out, each with the reason (a plan cap). Empty when everything was made. */
  skipped: string[];
}

export interface ApplyTuesdayCtx {
  organizationId: string;
  userId: string;
  /** The Space's name (the gallery lets a person rename it). */
  name: string;
  governance: boolean;
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  /** A Space this template already made (a retry): reuse it rather than make a second. */
  resumeSpaceId?: string | null;
  /**
   * The person chose to make a new List (or doc) beside the one in Trash: that
   * piece is left there and a new one is made. Only that piece: another in
   * Trash still stops to ask.
   */
  freshKind?: "list" | "doc" | null;
  /** Called once the Space exists, so a caller can record it before anything else can fail. */
  onSpace?: (space: { id: string; slug: string }) => Promise<void>;
}

/**
 * A piece a retry would finish in is in Trash: the Space, its Onboarding
 * List or its playbook doc. A retry used to pass it by and build a second
 * one; restoring the first later left two. The caller restores it or starts
 * fresh, never a silent second.
 */
export class SpaceInTrashError extends Error {
  constructor(readonly trashRowId: string, readonly spaceName: string, readonly kind: TrashedPieceKind = "space") {
    super(`${kind}_in_trash`);
  }
}

export type TrashedPieceKind = "space" | "list" | "doc";

/** The Trash row holding this Space (archived in place, or deleted to a snapshot), or null. */
export async function spaceInTrash(orgId: string, spaceId: string): Promise<{ rowId: string; name: string } | null> {
  const archived = await prisma.space.findFirst({ where: { id: spaceId, organizationId: orgId, archivedAt: { not: null } }, select: { name: true } });
  if (archived) return { rowId: archiveRowId("space", spaceId), name: archived.name };
  const snap = await prisma.trashItem.findFirst({
    where: { organizationId: orgId, entityType: "space", entityId: spaceId },
    orderBy: { deletedAt: "desc" },
    select: { id: true, label: true },
  });
  return snap ? { rowId: snap.id, name: snap.label } : null;
}

/**
 * The piece of an unfinished signup template that is in Trash, or null: its
 * Space first (archived or deleted), else the List or doc the last attempt
 * stopped on, read again (it may have been restored since).
 */
export async function trashedPieceOf(orgId: string, marker: SignupTemplateMarker | null): Promise<{ rowId: string; name: string; kind: TrashedPieceKind } | null> {
  if (!marker || marker.status === "applied" || !marker.spaceId) return null;
  const space = await spaceInTrash(orgId, marker.spaceId);
  if (space) return { ...space, kind: "space" };
  if (marker.status !== "failed" || !marker.trash) return null;
  const kind = marker.trash.kind ?? "space";
  const listDef = tuesdayPayload().lists[0];
  const piece = kind === "list" ? await listInTrash(orgId, marker.spaceId, listDef.name)
    : kind === "doc" ? await docInTrash(orgId, marker.spaceId, tuesdayPayload().bundle.doc.title)
    : null;
  return piece ? { ...piece, kind } : null;
}

/** This template's Onboarding List in Trash in this Space (archived in place, or deleted to a snapshot), or null. */
async function listInTrash(orgId: string, spaceId: string, name: string): Promise<{ rowId: string; name: string } | null> {
  const archived = await prisma.board.findFirst({ where: { organizationId: orgId, spaceId, name, archivedAt: { not: null } }, select: { id: true } });
  if (archived) return { rowId: archiveRowId("board", archived.id), name };
  const snap = await prisma.trashItem.findFirst({
    where: { organizationId: orgId, entityType: "board", label: name, snapshot: { path: ["row", "spaceId"], equals: spaceId } },
    orderBy: { deletedAt: "desc" },
    select: { id: true },
  });
  return snap ? { rowId: snap.id, name } : null;
}

/** This template's playbook doc in Trash in this Space, or null. */
async function docInTrash(orgId: string, spaceId: string, title: string): Promise<{ rowId: string; name: string } | null> {
  const archived = await prisma.doc.findFirst({ where: { organizationId: orgId, entityType: "SPACE", entityId: spaceId, title, archivedAt: { not: null } }, select: { id: true } });
  if (archived) return { rowId: archiveRowId("doc", archived.id), name: title };
  const snap = await prisma.trashItem.findFirst({
    where: { organizationId: orgId, entityType: "note", label: title, snapshot: { path: ["row", "entityId"], equals: spaceId } },
    orderBy: { deletedAt: "desc" },
    select: { id: true },
  });
  return snap ? { rowId: snap.id, name: title } : null;
}

/**
 * A reused SOP whose task-making steps point at a List that is no longer
 * there (gone, in Trash, or in a Space in Trash) points them at `boardId`.
 * One that points at a live List is left as it is: someone chose it.
 */
async function repointSopSpawn(orgId: string, sop: { id: string; content: unknown }, boardId: string): Promise<void> {
  const content = sop.content as { spawn?: { boardId?: unknown } } | null;
  const current = typeof content?.spawn?.boardId === "string" ? content.spawn.boardId : null;
  if (!content || !current || current === boardId) return;
  // Live: not in Trash, and neither its Space nor its Folder is (a List may
  // have neither).
  const live = await prisma.board.findFirst({
    where: {
      id: current, organizationId: orgId, archivedAt: null,
      AND: [
        { OR: [{ spaceId: null }, { space: { archivedAt: null } }] },
        { OR: [{ folderId: null }, { folder: { archivedAt: null } }] },
      ],
    },
    select: { id: true },
  });
  if (live) return;
  // Only the one key, and only while it still names the List read above: an
  // edit to the SOP made meanwhile is never written over.
  await prisma.$executeRaw`UPDATE "SOP" SET content = jsonb_set(content, '{spawn,boardId}', to_jsonb(${boardId}::text)) WHERE id = ${sop.id} AND "organizationId" = ${orgId} AND content->'spawn'->>'boardId' = ${current}`;
}

/** The doc's line when some pieces were not made: a non-admin apply, or the plan's SOP cap. Pure. */
export function tuesdayDocPartial(made: { sop: boolean; governance: boolean }): string {
  if (!made.governance) {
    return "This Space has the Onboarding List and a sample task. When a workspace admin applies this template, it also adds the Client onboarding SOP with its job titles, a KRA and KPI, and a company goal.";
  }
  return "The Client onboarding SOP was not added: the plan's SOP limit was reached. The job titles, the KRA and KPI and the goal are here.";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function quarterBounds(now: Date): { label: string; start: Date; end: Date } {
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59));
  return { label: `Q${q + 1} ${now.getUTCFullYear()}`, start, end };
}

async function link(orgId: string, userId: string, a: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationKind?: string; context?: string; position?: number }) {
  const relationKind = (a.relationKind ?? "LINKED") as Prisma.EntityLinkCreateInput["relationKind"];
  await prisma.entityLink.upsert({
    where: {
      sourceType_sourceId_targetType_targetId_relationKind: {
        sourceType: a.sourceType as never, sourceId: a.sourceId, targetType: a.targetType as never, targetId: a.targetId, relationKind: relationKind as never,
      },
    },
    create: {
      organizationId: orgId,
      sourceType: a.sourceType as never, sourceId: a.sourceId, targetType: a.targetType as never, targetId: a.targetId,
      relationKind: relationKind as never, position: a.position ?? 0, context: a.context ?? null, createdById: userId,
    },
    update: {},
  });
}

/** Apply the Tuesday bundle (see the header). Find or create, so a retry finishes rather than doubles. */
export async function applyTuesdayBundle(payload: TuesdayPayload, ctx: ApplyTuesdayCtx): Promise<TuesdayApplied> {
  const { organizationId: orgId, userId } = ctx;
  const b = payload.bundle;
  const listDef = payload.lists[0];

  // 1. The Space (reused on a retry) and its List.
  let space = ctx.resumeSpaceId
    ? await prisma.space.findFirst({ where: { id: ctx.resumeSpaceId, organizationId: orgId, archivedAt: null }, select: { id: true, slug: true } })
    : null;
  if (!space && ctx.resumeSpaceId) {
    const trashed = await spaceInTrash(orgId, ctx.resumeSpaceId);
    if (trashed) throw new SpaceInTrashError(trashed.rowId, trashed.name);
  }
  if (!space) {
    const made = await applySpaceTemplate({ ...payload, lists: [] }, { organizationId: orgId, userId, name: ctx.name, visibility: ctx.visibility });
    space = { id: made.spaceId, slug: made.slug };
  }
  if (ctx.onSpace) await ctx.onSpace(space);
  let board = await prisma.board.findFirst({ where: { organizationId: orgId, spaceId: space.id, name: listDef.name, archivedAt: null }, select: { id: true, slug: true } });
  if (!board && ctx.resumeSpaceId && ctx.freshKind !== "list") {
    const trashed = await listInTrash(orgId, space.id, listDef.name);
    if (trashed) throw new SpaceInTrashError(trashed.rowId, trashed.name, "list");
  }
  if (!board) {
    const made = await applyListTemplate({ ...listDef, items: [] }, { organizationId: orgId, userId, spaceId: space.id, name: listDef.name });
    board = { id: made.boardId, slug: made.slug };
  }

  // 2. The governance: job titles, KRA, KPI, SOP, goal (admins only).
  let kraId: string | null = null;
  let kpiId: string | null = null;
  let sopId: string | null = null;
  let goalId: string | null = null;
  const roleIdByTitle = new Map<string, string>();
  const skipped: string[] = [];
  if (ctx.governance) {
    const depts = await prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
    const deptId = (name: string | null) => (name ? depts.find((d) => d.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);
    for (const jt of b.jobTitles) {
      const found = await prisma.role.findFirst({ where: { organizationId: orgId, title: { equals: jt.title, mode: "insensitive" } }, select: { id: true } });
      const role = found ?? (await prisma.role.upsert({
        where: { title_organizationId: { title: jt.title, organizationId: orgId } },
        create: { title: jt.title, description: jt.description, organizationId: orgId, departmentId: deptId(jt.department) },
        update: {},
        select: { id: true },
      }));
      roleIdByTitle.set(jt.title, role.id);
    }
    const kraRoleId = roleIdByTitle.get(b.kra.jobTitle) ?? null;
    const kra = (await prisma.kRA.findFirst({ where: { organizationId: orgId, name: b.kra.name, roleId: kraRoleId }, select: { id: true } }))
      ?? (await prisma.kRA.create({ data: { name: b.kra.name, description: b.kra.description, category: b.kra.category, weight: b.kra.weight, roleId: kraRoleId, organizationId: orgId }, select: { id: true } }));
    kraId = kra.id;
    if (kraRoleId) await seedKraToRoleHolders({ kraId, roleId: kraRoleId, organizationId: orgId });
    const kpi = (await prisma.kPI.findFirst({ where: { organizationId: orgId, name: b.kpi.name, kraId }, select: { id: true } }))
      ?? (await prisma.kPI.create({
        data: {
          name: b.kpi.name, description: b.kpi.description, unit: b.kpi.unit, targetValue: b.kpi.targetValue,
          lowerIsBetter: b.kpi.lowerIsBetter, direction: b.kpi.lowerIsBetter ? "LOWER" : "HIGHER", frequency: "MONTHLY",
          kraId, organizationId: orgId,
        },
        select: { id: true },
      }));
    kpiId = kpi.id;

    const steps = b.sop.steps.map((s, i) => {
      const roleId = s.jobTitle ? roleIdByTitle.get(s.jobTitle) ?? null : null;
      return {
        id: `step_tuesday_${i + 1}`,
        title: s.title,
        description: s.description ? `<p>${esc(s.description)}</p>` : "",
        ...(roleId && s.jobTitle ? { jobTitle: { roleId, title: s.jobTitle } } : {}),
        ...(s.createsTask ? { createsTask: true } : {}),
      };
    });
    const content = { type: "steps", layout: "list", steps, flow: { type: "process_flow", steps: steps.map((s) => ({ ...s, type: "action" })) }, spawn: { boardId: board.id } };
    const existingSop = await prisma.sOP.findFirst({ where: { organizationId: orgId, title: b.sop.title, kraId }, select: { id: true, content: true } });
    // A reused SOP keeps whatever was made of it, except a task-making step
    // that points at a List no longer there (a Start fresh over a Space in
    // Trash): that one now makes its task on this List, never in Trash.
    if (existingSop) await repointSopSpawn(orgId, existingSop, board.id);
    const now = new Date();
    // The plan's SOP cap holds for a template exactly as for New SOP: at the
    // cap the SOP is left out and the result says so, never created past it.
    const sopAllowed = existingSop ? { allowed: true as const } : await checkPlanLimit(orgId, "sops");
    if (!sopAllowed.allowed) skipped.push(`The Client onboarding SOP was not added: ${sopAllowed.message}`);
    const sop = existingSop ?? (!sopAllowed.allowed ? null : await prisma.sOP.create({
      data: {
        title: b.sop.title, description: b.sop.description, sopType: "WRITTEN", content: content as Prisma.InputJsonValue,
        status: "PUBLISHED", publishedAt: now, publishedBy: userId, kraId, organizationId: orgId, createdById: userId,
        category: "Operations", tags: ["onboarding"],
      },
      select: { id: true },
    }));
    sopId = sop?.id ?? null;

    const q = quarterBounds(now);
    const goal = (await prisma.oKR.findFirst({ where: { organizationId: orgId, title: b.goal.title }, select: { id: true } }))
      ?? (await prisma.oKR.create({
        data: {
          title: b.goal.title, description: b.goal.description, level: "COMPANY", ownerId: userId, quarter: q.label,
          startDate: q.start, endDate: q.end, organizationId: orgId,
        },
        select: { id: true },
      }));
    goalId = goal.id;
    await link(orgId, userId, { sourceType: "OKR", sourceId: goalId, targetType: "KRA", targetId: kraId });
    await link(orgId, userId, { sourceType: "OKR", sourceId: goalId, targetType: "BOARD", targetId: board.id });
    await link(orgId, userId, { sourceType: "SPACE", sourceId: space.id, targetType: "KRA", targetId: kraId });
  }

  // 3. The playbook doc, in the Space (never one in Trash: that one stops to ask, as the List does).
  const existingDoc = await prisma.doc.findFirst({ where: { organizationId: orgId, entityType: "SPACE", entityId: space.id, title: b.doc.title, archivedAt: null }, select: { id: true } });
  if (!existingDoc && ctx.resumeSpaceId && ctx.freshKind !== "doc") {
    const trashed = await docInTrash(orgId, space.id, b.doc.title);
    if (trashed) throw new SpaceInTrashError(trashed.rowId, trashed.name, "doc");
  }
  // A block that describes a piece this apply did not make is left out, so
  // the doc never points at an SOP, KRA, KPI or goal that is not there.
  const pieces = { sop: !!sopId, governance: !!(kraId && goalId) };
  const kept = b.doc.blocks.filter((blk) => !blk.needs || pieces[blk.needs]);
  const docBlocks = kept.length < b.doc.blocks.length
    ? [...kept.slice(0, 2), { kind: "paragraph", text: tuesdayDocPartial(pieces) }, ...kept.slice(2)]
    : kept;
  const docId = existingDoc?.id ?? (await applyDocTemplate(
    { content: { blocks: docBlocks.map(({ needs: _n, ...blk }, i) => { void _n; return { ...blk, id: `tuesday.${i + 1}` }; }), meta: { icon: "📘" } } },
    { organizationId: orgId, userId, spaceId: space.id, name: b.doc.title },
  )).docId;

  // 4. The sample task, linked to the SOP step, the KRA, the KPI and the doc.
  const existingTask = await prisma.item.findFirst({ where: { organizationId: orgId, boardId: board.id, title: b.sampleTask.title }, select: { id: true } });
  let sampleTaskId = existingTask?.id ?? null;
  if (!sampleTaskId) {
    const metadata: Record<string, unknown> = {};
    if (kraId) metadata.kraId = kraId;
    if (kpiId) metadata.kpiId = kpiId;
    const item = await createBoardItem({ organizationId: orgId, boardId: board.id, title: b.sampleTask.title, metadata, actorId: userId });
    sampleTaskId = item.id;
  }
  if (sopId) {
    const step = b.sop.steps[b.sampleTask.stepN - 1];
    await link(orgId, userId, {
      sourceType: "BOARD_ITEM", sourceId: sampleTaskId, targetType: "SOP", targetId: sopId, relationKind: "REQUIRED_READING",
      position: b.sampleTask.stepN, context: step ? `Step ${b.sampleTask.stepN}: ${step.title}` : undefined,
    });
  }
  await link(orgId, userId, { sourceType: "BOARD_ITEM", sourceId: sampleTaskId, targetType: "DOC", targetId: docId });

  return {
    spaceId: space.id, spaceSlug: space.slug, boardId: board.id, boardSlug: board.slug, docId, sampleTaskId,
    sopId, kraId, kpiId, goalId, jobTitleIds: [...roleIdByTitle.values()], governance: ctx.governance, skipped,
  };
}

// ── once at signup ─────────────────────────────────────────────────

export type SignupTemplateMarker =
  | { key: string; status: "applying"; startedAt: string; spaceId?: string | null }
  | { key: string; status: "failed"; failedAt: string; error: string; spaceId?: string | null; trash?: { rowId: string; name: string; kind?: TrashedPieceKind } }
  | ({ key: string; status: "applied"; appliedAt: string } & Omit<TuesdayApplied, "governance" | "skipped"> & { skipped?: string[] });

/** The marker as stored, or null. Tolerates any JSON. */
export function readSignupMarker(settings: unknown): SignupTemplateMarker | null {
  const m = (settings as { signupTemplate?: unknown } | null)?.signupTemplate as Partial<SignupTemplateMarker> | null | undefined;
  if (!m || typeof m !== "object" || typeof m.key !== "string") return null;
  if (m.status !== "applying" && m.status !== "failed" && m.status !== "applied") return null;
  return m as SignupTemplateMarker;
}

/** Claim the marker with one conditional UPDATE. True when this caller won it. */
async function claimMarker(orgId: string, marker: SignupTemplateMarker, onlyFromStatus: "absent" | "failed" | "stale"): Promise<boolean> {
  const json = JSON.stringify({ signupTemplate: marker });
  const now = new Date();
  if (onlyFromStatus === "absent") {
    const n = await prisma.$executeRaw`
      UPDATE "Organization"
      SET "settings" = (CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END) || ${json}::jsonb, "updatedAt" = ${now}
      WHERE "id" = ${orgId} AND NOT (CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END) ? 'signupTemplate'`;
    return n > 0;
  }
  if (onlyFromStatus === "failed") {
    const n = await prisma.$executeRaw`
      UPDATE "Organization"
      SET "settings" = "settings" || ${json}::jsonb, "updatedAt" = ${now}
      WHERE "id" = ${orgId} AND jsonb_typeof("settings") = 'object' AND "settings" -> 'signupTemplate' ->> 'status' = 'failed'`;
    return n > 0;
  }
  // An "applying" marker older than ten minutes is a process that died mid-apply.
  const cutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const n = await prisma.$executeRaw`
    UPDATE "Organization"
    SET "settings" = "settings" || ${json}::jsonb, "updatedAt" = ${now}
    WHERE "id" = ${orgId} AND jsonb_typeof("settings") = 'object'
      AND "settings" -> 'signupTemplate' ->> 'status' = 'applying'
      AND ("settings" -> 'signupTemplate' ->> 'startedAt') < ${cutoff}`;
  return n > 0;
}

/** A workspace this template may be applied to at signup: brand new, its Owner its only person. */
async function isBrandNew(orgId: string, now: Date): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { createdAt: true } });
  if (!org || now.getTime() - org.createdAt.getTime() > 24 * 60 * 60 * 1000) return false;
  const people = await prisma.user.count({ where: { organizationId: orgId } });
  return people === 1;
}

async function runAndRecord(orgId: string, userId: string, key: string, resumeSpaceId: string | null, freshKind: "list" | "doc" | null = null): Promise<SignupTemplateMarker> {
  let spaceId: string | null = resumeSpaceId;
  try {
    const res = await applyTuesdayBundle(tuesdayPayload(), {
      organizationId: orgId, userId, name: "Operations", governance: true, visibility: "ORG", resumeSpaceId, freshKind,
      onSpace: async (s) => {
        if (s.id === spaceId) return;
        spaceId = s.id;
        await writeOrgSettingsKeys(orgId, { signupTemplate: { key, status: "applying", startedAt: new Date().toISOString(), spaceId } });
      },
    });
    // `skipped` is kept, so the wizard names only the pieces that were made
    // and says which were left out (a plan cap), never all of them.
    const { governance: _g, ...rest } = res;
    void _g;
    const marker: SignupTemplateMarker = { key, status: "applied", appliedAt: new Date().toISOString(), ...rest };
    await writeOrgSettingsKeys(orgId, { signupTemplate: marker });
    await prisma.template.updateMany({ where: { key, builtIn: true }, data: { usedCount: { increment: 1 } } }).catch(() => undefined);
    return marker;
  } catch (err) {
    if (err instanceof SpaceInTrashError) {
      // Not a fault: the person chooses (restore it, or start fresh).
      const marker: SignupTemplateMarker = { key, status: "failed", failedAt: new Date().toISOString(), error: `${err.kind}_in_trash`, spaceId, trash: { rowId: err.trashRowId, name: err.spaceName, kind: err.kind } };
      await writeOrgSettingsKeys(orgId, { signupTemplate: marker }).catch(() => undefined);
      return marker;
    }
    console.error("[signup-template] apply failed", err);
    const marker: SignupTemplateMarker = { key, status: "failed", failedAt: new Date().toISOString(), error: err instanceof Error ? err.message.slice(0, 200) : "Unknown error", spaceId };
    await writeOrgSettingsKeys(orgId, { signupTemplate: marker }).catch(() => undefined);
    return marker;
  }
}

/**
 * Apply a signup template once to a brand new workspace (POST
 * /api/auth/register, after the org defaults and the General Space). Null
 * when it was not applied: an unknown key, a workspace that is not new, or a
 * marker already there (it was applied, or is being applied, already).
 */
export async function applySignupTemplate(input: { organizationId: string; userId: string; key: string; now?: Date }): Promise<SignupTemplateMarker | null> {
  if (input.key !== TUESDAY_TEMPLATE_KEY) return null;
  const now = input.now ?? new Date();
  if (!(await isBrandNew(input.organizationId, now))) return null;
  const won = await claimMarker(input.organizationId, { key: input.key, status: "applying", startedAt: now.toISOString(), spaceId: null }, "absent");
  if (!won) return null;
  return runAndRecord(input.organizationId, input.userId, input.key, null);
}

/**
 * Finish a signup template that failed (or died) part way. Null when there is
 * nothing to retry. `fresh`: the piece in Trash stays there and a new one is
 * made (a new Space for the Space, a new List or doc beside the one in Trash).
 * Without it, a piece still in Trash is not passed by: null, and the wizard
 * asks. `kind` is the piece the person was shown: a choice made over another
 * piece than the one in Trash now (a stale tab) is not run: null, and the
 * wizard asks again.
 */
export async function retrySignupTemplate(input: { organizationId: string; userId: string; fresh?: boolean; kind?: TrashedPieceKind | null }): Promise<SignupTemplateMarker | null> {
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } });
  const marker = readSignupMarker(org?.settings);
  if (!marker || marker.status === "applied" || marker.key !== TUESDAY_TEMPLATE_KEY) return null;
  // Start fresh is a new Space only while the one it was building is still
  // in Trash; a Space restored meanwhile (another tab, the Trash page) is
  // resumed, never doubled. Over a List or doc in Trash it keeps the Space
  // and makes a new piece beside the one in Trash.
  const trashed = await trashedPieceOf(input.organizationId, marker);
  if (trashed && !input.fresh) return null;
  if (input.fresh && input.kind && trashed && trashed.kind !== input.kind) return null;
  const resumeSpaceId = trashed?.kind === "space" ? null : marker.spaceId ?? null;
  const freshKind = input.fresh && trashed && trashed.kind !== "space" ? trashed.kind : null;
  const startedAt = new Date().toISOString();
  const won = await claimMarker(input.organizationId, { key: marker.key, status: "applying", startedAt, spaceId: resumeSpaceId }, marker.status === "failed" ? "failed" : "stale");
  if (!won) return null;
  return runAndRecord(input.organizationId, input.userId, marker.key, resumeSpaceId, freshKind);
}

// ── the Template Center row ────────────────────────────────────────

let ensured: Promise<void> | null = null;

/**
 * The built-in Template Center row, created when missing (the built-in seed,
 * prisma/seed-templates.ts, is run by hand, so a workspace on a database it
 * has not been run against still finds the template). Never overwrites a
 * row; never touches a row a customer owns. Once per process.
 */
export function ensureTuesdayTemplateRow(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const existing = await prisma.template.findFirst({ where: { key: TUESDAY_TEMPLATE_KEY }, select: { id: true } });
      if (existing) return;
      await prisma.template.create({
        data: { ...TUESDAY_TEMPLATE_ROW, builtIn: true, organizationId: null, payload: tuesdayPayload() as unknown as Prisma.InputJsonValue },
      });
    })().catch((err) => {
      ensured = null;
      console.error("[template-center] could not ensure the Tuesday template", err);
    });
  }
  return ensured;
}
