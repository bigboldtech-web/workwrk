import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canManageProcess } from "@/lib/process-scope";
import { parseProcessSettings, renameListEntry } from "@/lib/process-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

/**
 * POST /api/agreements/rename-folder { from, to } (spec-process section 2
 * `/agreements`, the folder group's "…" › Rename folder): one server call
 * that renames the folder in `settings.process.contractFolders` AND moves
 * every contract and template filed under it, replacing the N sequential
 * PATCHes the page used to fire. `from` may be "" for the Unfiled group; a
 * blank `to` files the rows as Unfiled. The `manage_process` rule (Owner,
 * Admin, People team), the same one the settings section and the category
 * rename check.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!canManageProcess(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (from === to) return jsonSuccess({ moved: 0 });

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const settings = (org?.settings as SettingsBlob | null) || {};
  const process = parseProcessSettings(settings.process).value;
  const nextFolders = from ? renameListEntry(process.contractFolders, from, to) : to ? [...process.contractFolders.filter((f) => f !== to), to] : process.contractFolders;

  const [moved] = await prisma.$transaction([
    prisma.agreement.updateMany({ where: { organizationId: orgId, category: from ? from : null }, data: { category: to || null } }),
    prisma.organization.update({ where: { id: orgId }, data: { settings: { ...settings, process: { ...process, contractFolders: nextFolders } } } }),
  ]);
  return jsonSuccess({ moved: moved.count, contractFolders: nextFolders });
}
