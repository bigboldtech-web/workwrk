import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { OrgStatus, Plan, Prisma } from "@/generated/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import {
  applyCompanyPatch,
  statusRevokesSessions,
  validateCompanyPatch,
  VALID_PLANS,
  VALID_STATUSES,
} from "@/lib/admin/company-patch";

const LIST_REVOKE_REFUSAL =
  "Suspend or cancel a company from its company page, which asks you to type the company name first.";

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
import { requestIp, staffActorFromSession } from "@/lib/staff-audit";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const plan = url.searchParams.get("plan") || "";
  const status = url.searchParams.get("status") || "";
  // Bounded and NaN-safe: page=abc used to make skip NaN (a Prisma 500) and
  // limit had no ceiling.
  const page = boundedInt(url.searchParams.get("page"), 1, 1, 100_000);
  const limit = boundedInt(url.searchParams.get("limit"), 20, 1, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.OrganizationWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { domain: { contains: search, mode: "insensitive" } },
    ];
  }
  if ((VALID_PLANS as readonly string[]).includes(plan)) where.plan = plan as Plan;
  if ((VALID_STATUSES as readonly string[]).includes(status)) where.status = status as OrgStatus;

  const [companies, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      // Only what the list shows. Never the settings JSON: the console
      // shows counts, never a company's own content.
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        plan: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            tasks: true,
            sops: true,
            reviewCycles: true,
            kras: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.organization.count({ where }),
  ]);

  return jsonSuccess({
    companies,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

// Update a company (plan, Active or Trial) from the list's quick edit. Body: { id, plan?, status? }.
// The same validated, transactional, audited path as PATCH /api/admin/companies/[id]
// (src/lib/admin/company-patch.ts): this endpoint used to write whatever
// strings arrived with no audit row and no session revocation.
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return jsonError("Company ID required");

  const validated = validateCompanyPatch(body);
  if (!validated.ok) return jsonError(validated.error);
  // Suspending or cancelling signs everyone at the company out. It happens
  // only on the company page, behind its typed confirmation; the quick edit
  // must never be the way around that.
  if (validated.patch.status && statusRevokesSessions(validated.patch.status)) {
    return jsonError(LIST_REVOKE_REFUSAL);
  }

  const result = await applyCompanyPatch({
    id,
    patch: validated.patch,
    actor: staffActorFromSession(session),
    ip: requestIp(req),
  });
  if (!result.ok) return jsonError(result.error, result.status);

  return jsonSuccess({ ok: true, changed: result.changed, signedOut: result.signedOut, ...result.company });
}
