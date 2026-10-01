// /api/okrs/[id]/assignees, incremental audience edits on one goal.
//
//   GET     the goal's audience: labeled entries (for pickers) + the
//           resolved member summary (avatars + overflow count).
//   POST    add entries    { assignees: [{ type, id }] }
//   DELETE  remove entries { assignees: [{ type, id }] }
//
// A goal stays ONE record with ONE owner (the DRI) and one shared
// scoreboard; these rows are contributors. Department/role entries are
// stored as refs and resolve to people at read time.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { resolveRequestsFor } from "@/lib/access/access-requests";
import {
  addGoalAssignees,
  canSeeGoal,
  goalEditDenial,
  listGoalAssigneeEntries,
  removeGoalAssignees,
  summarizeGoalAudiences,
  validateGoalAssignees,
  type GoalAudienceRef,
} from "@/lib/goal-audience";

async function loadOkr(id: string, orgId: string) {
  return prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, level: true, ownerId: true, departmentId: true },
  });
}

async function audiencePayload(orgId: string, okr: { id: string; ownerId: string | null }) {
  const [entries, summaries] = await Promise.all([
    listGoalAssigneeEntries(okr.id),
    summarizeGoalAudiences(orgId, [okr]),
  ]);
  return { entries, audience: summaries.get(okr.id) };
}

/** DELETE payload shape check, org membership is irrelevant for removal
 *  (rows are already scoped to this okr), so only the shape is enforced. */
function parseRemovalEntries(input: unknown): GoalAudienceRef[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: GoalAudienceRef[] = [];
  for (const raw of input) {
    const { type, id } = (raw ?? {}) as { type?: unknown; id?: unknown };
    if (type !== "USER" && type !== "DEPARTMENT" && type !== "ROLE" && type !== "TAG") return null;
    if (typeof id !== "string" || id.trim().length === 0) return null;
    out.push({ type, id: id.trim() });
  }
  return out;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await loadOkr(id, orgId);
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);
  return jsonSuccess(await audiencePayload(orgId, okr));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await loadOkr(id, orgId);
  if (!okr) return jsonError("Not found", 404);
  const denied = await goalEditDenial(session, okr);
  if (denied) return jsonError(denied.error, denied.status);

  const body = await req.json().catch(() => ({}));
  const parsed = await validateGoalAssignees(orgId, body?.assignees);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.entries.length === 0) return jsonError("No assignees to add", 400);

  // The people this POST adds by name (not already on the goal), read before
  // the write so a re-add of an existing contributor answers nothing.
  const namedIds = parsed.entries.filter((e) => e.type === "USER").map((e) => e.id);
  const already = namedIds.length > 0
    ? new Set((await prisma.goalAssignee.findMany({ where: { okrId: id, userId: { in: namedIds } }, select: { userId: true } })).map((r) => r.userId))
    : new Set<string>();
  const added = await addGoalAssignees(id, parsed.entries);
  // Adding someone to the goal by name is how its owner shares it (the
  // Access requests card's Open to share lands here), so it answers that
  // person's open Request on this goal. Before this the request stayed open
  // and the only way to clear it was Decline, which told the person "declined"
  // after they had been added. Only a person newly added by name: a
  // contributor who already was one and asks for edit keeps their request.
  const deciderId = getUserId(session);
  for (const userId of namedIds) {
    if (already.has(userId) || userId === deciderId) continue;
    await resolveRequestsFor({ organizationId: orgId, objectTypes: ["goal"], objectId: id, requesterId: userId, roles: null, deciderId });
  }
  return jsonSuccess({ added, ...(await audiencePayload(orgId, okr)) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await loadOkr(id, orgId);
  if (!okr) return jsonError("Not found", 404);
  const denied = await goalEditDenial(session, okr);
  if (denied) return jsonError(denied.error, denied.status);

  const body = await req.json().catch(() => ({}));
  const entries = parseRemovalEntries(body?.assignees);
  if (!entries) return jsonError("assignees must be a non-empty array of { type, id }", 400);

  const removed = await removeGoalAssignees(id, entries);
  return jsonSuccess({ removed, ...(await audiencePayload(orgId, okr)) });
}
