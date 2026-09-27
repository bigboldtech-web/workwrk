import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canManageProcess } from "@/lib/process-scope";
import { parseProcessSettings, renameListEntry } from "@/lib/process-settings";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

/**
 * POST /api/policies/rename-category { from, to } (spec-process section 2
 * `/sops/manage`, the Policy categories tab): one server call that renames
 * the category in `settings.process.policyCategories` AND re-files every
 * policy carrying the old name, so the list and the rows never disagree.
 * The `manage_process` rule: Owner, Admin, People team.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!canManageProcess(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!from || !to) return jsonError("Both names are required");
  if (from === to) return jsonSuccess({ moved: 0 });

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const settings = (org?.settings as SettingsBlob | null) || {};
  const process = parseProcessSettings(settings.process).value;
  const next = renameListEntry(process.policyCategories, from, to);
  // The rows and the `process` key in one transaction; only that key of the
  // shared settings column is written, so no other writer's key is lost.
  const moved = await prisma.$transaction(async (tx) => {
    const res = await tx.policy.updateMany({ where: { organizationId: orgId, category: from }, data: { category: to } });
    await writeOrgSettingsKeys(orgId, { process: { ...process, policyCategories: next } }, tx);
    return res;
  });
  return jsonSuccess({ moved: moved.count, policyCategories: next });
}
