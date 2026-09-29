import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { companyPeople } from "@/lib/admin/company-detail";

/**
 * GET /api/admin/companies/[id]/people?role=member,admin&q=
 *
 * The Set workspace Owner picker (spec-admin-backoffice 2.3 card 5): the
 * live Members and Admins of ONE workspace, with name, email and role, and
 * nobody else. Owners are left out (there is nothing to do to them), as are
 * deactivated and deleted people (promoting one hands ownership to somebody
 * who cannot sign in). Platform staff only. Returns at most 50 people; `q`
 * narrows by name or email.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!org) return jsonError("Company not found", 404);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const roles = new Set((url.searchParams.get("role") ?? "member,admin").split(",").map((r) => r.trim().toUpperCase()));
  const people = (await companyPeople(id, { q: q || undefined, take: 200 }))
    .filter((p) => p.role !== "OWNER" && roles.has(p.role))
    .sort((a, b) => a.name.localeCompare(b.name));
  return jsonSuccess({ people: people.slice(0, 50), total: people.length });
}
