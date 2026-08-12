// /api/okrs/[id]/assignees — incremental audience edits on one goal.
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
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canEditOkrOwner } from "@/lib/alignment-scope";
import {
  addGoalAssignees,
  canSeeGoal,
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

/** DELETE payload shape check — org membership is irrelevant for removal
 *  (rows are already scoped to this okr), so only the shape is enforced. */
function parseRemovalEntries(input: unknown): GoalAudienceRef[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: GoalAudienceRef[] = [];
  for (const raw of input) {
    const { type, id } = (raw ?? {}) as { type?: unknown; id?: unknown };
    if (type !== "USER" && type !== "DEPARTMENT" && type !== "ROLE") return null;
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
  if (!(await canEditOkrOwner(session, okr.ownerId))) {
    return jsonError("You can only edit your own goals or your reports' goals.", 403);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = await validateGoalAssignees(orgId, body?.assignees);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.entries.length === 0) return jsonError("No assignees to add", 400);

  const added = await addGoalAssignees(id, parsed.entries);
  return jsonSuccess({ added, ...(await audiencePayload(orgId, okr)) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await loadOkr(id, orgId);
  if (!okr) return jsonError("Not found", 404);
  if (!(await canEditOkrOwner(session, okr.ownerId))) {
    return jsonError("You can only edit your own goals or your reports' goals.", 403);
  }

  const body = await req.json().catch(() => ({}));
  const entries = parseRemovalEntries(body?.assignees);
  if (!entries) return jsonError("assignees must be a non-empty array of { type, id }", 400);

  const removed = await removeGoalAssignees(id, entries);
  return jsonSuccess({ removed, ...(await audiencePayload(orgId, okr)) });
}
