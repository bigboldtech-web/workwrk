// GET    /api/forms/[id]   form + response count + settings + destination + what the viewer may do
// PATCH  /api/forms/[id]   update name / description / fields / destination / mappings / settings;
//                          isPublic only for its creator or an admin (the Share dialog's write);
//                          with expectRev (the builder), 409 form_changed when the
//                          builder's content changed elsewhere (lib/forms/content-rev)
//
// `settings` is the form's own bucket (FormDefinition.settings), validated by
// the ONE strict schema in lib/forms/settings: an unknown key is a 400 that
// names it. A patch is partial and merged over what is stored. The people on
// "Tell these people about each new response" must be in the form's org.
//
// Who may edit (interim, access engine inert): every Member of the org, as
// before; a Guest only a form they made. GET answers `canEdit` so the builder
// renders read-only for everyone else, and `canManage` (creator or admin) for
// the public link, delete and deleting responses.
// DELETE /api/forms/[id]   move to the one Trash WITH its responses; only its creator or an admin
//
// Phase 5 gates (spec-tables-forms section 3 ask 1, section 4 step 1, with the
// access engine still inert): DELETE and a change to isPublic need the form's
// creator or an Owner or Admin (lib/object-manage.ts), and a public link
// change writes an audit row. DELETE used to be a hard prisma delete that
// cascaded every response with no way back; it now goes through the one
// Trash (lib/trash.ts "form"), which snapshots the responses and restores
// them with the form.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageObject, MANAGE_REFUSAL } from "@/lib/object-manage";
import { logAuditEvent } from "@/lib/activity";
import { moveToTrash } from "@/lib/trash";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { describeSettingsError, formSettingsPatchSchema, mergeFormSettings, readFormSettings } from "@/lib/forms/settings";
import { canReadResponses } from "@/lib/forms/responses-server";
import { viewerCanRespondAsMember } from "@/lib/forms/responder-access";
import { validFieldMappingsInput, validFieldsInput } from "@/lib/forms/fields";
import { dailySummaryInstalled } from "@/lib/forms/daily-summary";
import type { Prisma } from "@/generated/prisma";
import { PRIVATE_DESTINATION_NAME, readableDestinationIds } from "@/lib/table-gate";
import { formContentRev, patchAllowed, type FormContentKey } from "@/lib/forms/content-rev";

type FormViewer = Awaited<ReturnType<typeof viewerFromSession>>;

/** Every Member may edit; a Guest only a form they made (and never an
 *  unknown viewer). */
function canEditForm(viewer: FormViewer | null, createdById: string): boolean {
  if (!viewer) return false;
  if (viewer.orgRole === "GUEST") return viewer.userId === createdById;
  return true;
}

/** Both destinations a form can feed (a List and a table, either or both).
 *  An id whose object is gone reads as no destination. */
async function destinationsOf(
  orgId: string, targetBoardId: string | null, targetTableId: string | null,
  userId: string,
  session: Parameters<typeof readableDestinationIds>[2],
) {
  const [b, t] = await Promise.all([
    targetBoardId ? prisma.board.findFirst({ where: { id: targetBoardId, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : null,
    targetTableId ? prisma.dataTable.findFirst({ where: { id: targetTableId, organizationId: orgId }, select: { id: true, name: true, spaceId: true } }) : null,
  ]);
  // One the viewer cannot open is named "A private List / table", with no
  // link (lib/forms/destination-reach); it is still where answers go.
  const reach = await readableDestinationIds({ boards: b ? [b] : [], tables: t ? [t] : [] }, userId, session);
  return {
    list: b
      ? reach.boards.has(b.id)
        ? { kind: "list" as const, id: b.id, name: b.name, href: `/boards/${b.slug}` as string | null }
        : { kind: "list" as const, id: b.id, name: PRIVATE_DESTINATION_NAME.list, href: null }
      : null,
    table: t
      ? reach.tables.has(t.id)
        ? { kind: "table" as const, id: t.id, name: t.name, href: `/tables/${t.id}` as string | null }
        : { kind: "table" as const, id: t.id, name: PRIVATE_DESTINATION_NAME.table, href: null }
      : null,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const form = await prisma.formDefinition.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { submissions: true } } },
  });
  if (!form) return jsonError("not found", 404);

  const [viewer, org, destinations, owner] = await Promise.all([
    viewerFromSession().catch(() => null),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
    destinationsOf(orgId, form.targetBoardId, form.targetTableId, getUserId(session), session),
    prisma.user.findUnique({ where: { id: form.createdById }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true } }),
  ]);
  // A Guest who did not make the form and cannot reach its anchor has no
  // business knowing it exists: the same 404 as a wrong id.
  if (viewer?.orgRole === "GUEST" && viewer.userId !== form.createdById) {
    const reach = await canReadResponses(form, { userId: viewer.userId, organizationId: viewer.organizationId, orgRole: viewer.orgRole, isAgent: viewer.isAgent });
    if (!reach) return jsonError("not found", 404);
  }
  const canEdit = canEditForm(viewer, form.createdById);
  const { _count, ...rest } = form;
  const settings = readFormSettings((form as { settings?: unknown }).settings);
  const responder = viewer ? { userId: viewer.userId, organizationId: viewer.organizationId, orgRole: viewer.orgRole, isAgent: viewer.isAgent } : null;
  const [notifyPeople, canRespond] = await Promise.all([
    settings.notifyUserIds.length
      ? prisma.user.findMany({ where: { id: { in: settings.notifyUserIds }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, email: true } })
      : Promise.resolve([] as Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null }>),
    // "Open the form to answer it" on the read-only builder: only for someone
    // the responder would actually let send it.
    responder ? viewerCanRespondAsMember(form, responder) : Promise.resolve(false),
  ]);
  return jsonSuccess({
    ...rest,
    settings,
    // The builder sends this back as expectRev (lib/forms/content-rev).
    contentRev: formContentRev(form as Partial<Record<FormContentKey, unknown>>),
    notifyPeople: Object.fromEntries(notifyPeople.map((u) => [u.id, u])),
    submissionCount: _count.submissions,
    // The primary destination (the List first) names the BackButton and the
    // Share dialog's anchor; both are listed for the Goes to card.
    destination: destinations.list ?? destinations.table,
    destinations,
    owner: owner ? { ...owner, name: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null } : null,
    canEdit,
    canRespond,
    canManage: canManageObject(viewer, form.createdById),
    // Reading responses is an editor's right; a Can view reader has no Responses tab.
    canReadResponses: canEdit,
    isAgent: !!viewer?.isAgent,
    // Whether "Send a daily summary instead" has its reader (the cron row):
    // the builder renders the switch only then.
    dailySummaryAvailable: dailySummaryInstalled(),
    // Toggle 10 (lib/public-links): whether the Share dialog's Public link row exists.
    publicLinksAllowed: orgPublicLinksAllowed(org?.settings),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("body required");

  const existing = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);
  const editor = await viewerFromSession().catch(() => null);
  if (!canEditForm(editor, existing.createdById)) return jsonError("You can view this form but not change it.", 403);

  const data: Record<string, unknown> = {};
  if ("settings" in body) {
    const parsed = formSettingsPatchSchema.safeParse(body.settings);
    if (!parsed.success) return jsonError(describeSettingsError(parsed.error), 400);
    const ids = parsed.data.notifyUserIds;
    if (ids && ids.length) {
      // A NEW id outside the org is refused. An id that was already on the
      // list and has since left the org is dropped quietly instead: the
      // builder saves the whole draft each time, and one departed person
      // must not make every autosave of this form fail.
      const wanted = [...new Set(ids)];
      const inOrg = new Set((await prisma.user.findMany({ where: { id: { in: wanted }, organizationId: orgId }, select: { id: true } })).map((u) => u.id));
      const stored = new Set(readFormSettings((existing as { settings?: unknown }).settings).notifyUserIds);
      if (wanted.some((u) => !inOrg.has(u) && !stored.has(u))) return jsonError("notifyUserIds: everyone told about a response must be in this workspace", 400);
      parsed.data.notifyUserIds = wanted.filter((u) => inOrg.has(u));
    }
    data.settings = mergeFormSettings((existing as { settings?: unknown }).settings, parsed.data) as unknown as Prisma.InputJsonValue;
  }
  if ("fields" in body && !Array.isArray(body.fields)) return jsonError("fields must be a list");
  if (Array.isArray(body.fields) && body.fields.length > 200) return jsonError("A form can have up to 200 fields");
  if (Array.isArray(body.fields) && !validFieldsInput(body.fields)) return jsonError("fields: every field needs an id and a type");
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 200);
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 2000) ?? null;
  if (Array.isArray(body.fields)) data.fields = body.fields;
  // The public link: only its creator or an admin may CHANGE it. The builder
  // sends the whole form on every save, so a PATCH that repeats the current
  // value is not a change and is never refused.
  let publicChange: boolean | null = null;
  if (typeof body.isPublic === "boolean" && body.isPublic !== existing.isPublic) {
    if (!canManageObject(editor, existing.createdById)) return jsonError(MANAGE_REFUSAL.publish, 403);
    data.isPublic = body.isPublic;
    publicChange = body.isPublic;
  }
  // A destination must be a List or a table in this org; a stale id from an
  // old tab is refused rather than stored as a dead link.
  if ("targetBoardId" in body) {
    const v = typeof body.targetBoardId === "string" && body.targetBoardId ? body.targetBoardId : null;
    if (v && v !== existing.targetBoardId && !(await prisma.board.findFirst({ where: { id: v, organizationId: orgId }, select: { id: true } }))) return jsonError("That List no longer exists", 400);
    data.targetBoardId = v;
  }
  if ("targetTableId" in body) {
    const v = typeof body.targetTableId === "string" && body.targetTableId ? body.targetTableId : null;
    if (v && v !== existing.targetTableId && !(await prisma.dataTable.findFirst({ where: { id: v, organizationId: orgId }, select: { id: true } }))) return jsonError("That table no longer exists", 400);
    data.targetTableId = v;
  }
  if ("fieldMappings" in body && body.fieldMappings !== null && body.fieldMappings !== undefined) {
    const fm = validFieldMappingsInput(body.fieldMappings);
    if (!fm) return jsonError("fieldMappings must be { board?: { fieldId: key }, table?: { fieldId: columnId } }");
    data.fieldMappings = fm;
  }

  // The builder's concurrency guard (lib/forms/content-rev): a save based on
  // an older copy of the builder's content (a second tab, a co-editor) is
  // refused and writes nothing, so neither side silently loses fields. The
  // check and the write are one compare and set on updatedAt, so a PATCH
  // that lands between them is caught too.
  const expectRev = typeof body.expectRev === "string" && body.expectRev ? body.expectRev : null;
  const storedRev = formContentRev(existing as Partial<Record<FormContentKey, unknown>>);
  const nextRev = formContentRev({ ...(existing as Partial<Record<FormContentKey, unknown>>), ...(data as Partial<Record<FormContentKey, unknown>>) });
  if (!patchAllowed({ expectRev, storedRev, nextRev })) {
    return jsonSuccess({ error: "form_changed", contentRev: storedRev }, 409);
  }
  let updated;
  if (expectRev) {
    const res = await prisma.formDefinition.updateMany({ where: { id, organizationId: orgId, updatedAt: existing.updatedAt }, data });
    const after = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId } });
    if (!after) return jsonError("not found", 404);
    if (res.count === 0) {
      const afterRev = formContentRev(after as Partial<Record<FormContentKey, unknown>>);
      if (afterRev !== nextRev) return jsonSuccess({ error: "form_changed", contentRev: afterRev }, 409);
    }
    updated = after;
  } else {
    updated = await prisma.formDefinition.update({ where: { id }, data });
  }
  if (publicChange !== null) {
    void logAuditEvent({
      type: publicChange ? "access.public_link.on" : "access.public_link.off",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `${publicChange ? "Turned on" : "Turned off"} the public link for form "${existing.name}"`,
      targetId: id,
      targetType: "FormDefinition",
      oldValue: { isPublic: existing.isPublic },
      newValue: { isPublic: publicChange },
    });
  }
  return jsonSuccess({
    ...updated,
    settings: readFormSettings((updated as { settings?: unknown }).settings),
    contentRev: formContentRev(updated as Partial<Record<FormContentKey, unknown>>),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);

  const viewer = await viewerFromSession().catch(() => null);
  if (!canManageObject(viewer, existing.createdById)) return jsonError(MANAGE_REFUSAL.delete, 403);

  await moveToTrash("form", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ deleted: true });
}
