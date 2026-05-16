// GL accounts (chart of accounts) — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

const VALID_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type")?.toUpperCase();
  const includeInactive = sp.get("includeInactive") === "1";

  const where: Record<string, unknown> = { organizationId: orgId };
  if (type && VALID_TYPES.has(type)) where.type = type;
  if (!includeInactive) where.active = true;

  const accounts = await prisma.glAccount.findMany({
    where,
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true, code: true, name: true, type: true, parentId: true,
      currency: true, description: true, active: true,
    },
  });
  return jsonSuccess(accounts);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return jsonError("code is required");
  if (code.length > 32) return jsonError("code too long");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 200) return jsonError("name too long");

  const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
  if (!VALID_TYPES.has(type)) return jsonError("invalid type");

  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "USD";
  if (currency.length !== 3) return jsonError("currency must be a 3-letter code");

  const orgId = getOrgId(session);

  // If parentId is provided, ensure it exists in the same org and
  // has a compatible type (Workday rule — child accounts inherit
  // their parent's type to keep reports consistent).
  let parentId: string | null = null;
  if (typeof body.parentId === "string" && body.parentId) {
    const parent = await prisma.glAccount.findFirst({
      where: { id: body.parentId, organizationId: orgId },
      select: { id: true, type: true },
    });
    if (!parent) return jsonError("parent account not found", 404);
    if (parent.type !== type) return jsonError("child account type must match parent", 400);
    parentId = parent.id;
  }

  try {
    const account = await prisma.glAccount.create({
      data: {
        organizationId: orgId,
        code,
        name,
        type: type as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
        parentId,
        currency,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
      },
    });
    // Audit-log chart-of-accounts changes at warning severity — they're
    // structurally load-bearing for every downstream financial report.
    logAuditEvent({
      type: "gl_account.create",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Created GL account ${code} — ${name}`,
      targetId: account.id,
      targetType: "GlAccount",
      metadata: { code, name, type, currency, parentId },
    });
    return jsonSuccess(account, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("Account code already exists", 409);
    }
    throw e;
  }
}
