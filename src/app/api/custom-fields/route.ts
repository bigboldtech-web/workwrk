// Custom field definitions — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const VALID_TYPES = new Set([
  "TEXT", "TEXTAREA", "NUMBER", "DATE",
  "CHECKBOX", "SELECT", "MULTI_SELECT",
  "URL", "EMAIL",
]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const targetType = sp.get("targetType");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (targetType) where.targetType = targetType;

  const defs = await prisma.customFieldDefinition.findMany({
    where,
    orderBy: [{ targetType: "asc" }, { position: "asc" }, { label: "asc" }],
  });
  return jsonSuccess(defs);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
  if (!targetType) return jsonError("targetType required");

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return jsonError("key required");
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return jsonError("key must be snake_case (lowercase letters, digits, underscores; start with letter)");

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return jsonError("label required");
  if (label.length > 80) return jsonError("label too long");

  const fieldType = typeof body.fieldType === "string" ? body.fieldType.toUpperCase() : "TEXT";
  if (!VALID_TYPES.has(fieldType)) return jsonError("invalid fieldType");

  // Options blob — for SELECT/MULTI_SELECT we expect { choices: [{value,label}] }.
  // Reject obviously malformed payloads but don't enforce shape per type — the
  // adapter on read tolerates missing keys.
  const options = body.options && typeof body.options === "object" && !Array.isArray(body.options)
    ? body.options
    : {};

  const orgId = getOrgId(session);
  try {
    const def = await prisma.customFieldDefinition.create({
      data: {
        organizationId: orgId,
        targetType,
        key,
        label,
        fieldType: fieldType as "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL",
        required: body.required === true,
        options,
        position: typeof body.position === "number" ? body.position : 0,
      },
    });
    return jsonSuccess(def, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("Field key already exists for this targetType", 409);
    }
    throw e;
  }
}
