// GET /api/custom-fields/values?entityType=TASK&entityId=<id>
//   → returns { definitions, values } joined for the given entity.
//
// PUT /api/custom-fields/values
//   Body: { entityType, entityId, values: { fieldKey: value, ... } }
//   Upserts each value. Pass null/empty string to clear a field.
//
// Reads are open to any authed user; writes require the user to be
// in the same org as the definitions (no cross-org leakage).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const INTERNAL_TASK_FIELDS = {
  notes: { label: "Notes", fieldType: "TEXTAREA" as const, position: 9000 },
  relatedItems: { label: "Related items", fieldType: "TEXTAREA" as const, position: 9001 },
  taskLinks: { label: "Task links", fieldType: "TEXTAREA" as const, position: 9002 },
  checklist: { label: "Checklist", fieldType: "TEXTAREA" as const, position: 9003 },
};

async function ensureInternalTaskFields(orgId: string, entityType: string, keys: string[]) {
  if (entityType !== "TASK") return;

  const internalKeys = Array.from(
    new Set(keys.filter((key): key is keyof typeof INTERNAL_TASK_FIELDS => key in INTERNAL_TASK_FIELDS)),
  );
  if (internalKeys.length === 0) return;

  const existing = await prisma.customFieldDefinition.findMany({
    where: { organizationId: orgId, targetType: entityType, key: { in: internalKeys } },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((field) => field.key));
  const missing = internalKeys.filter((key) => !existingKeys.has(key));
  if (missing.length === 0) return;

  await prisma.customFieldDefinition.createMany({
    data: missing.map((key) => ({
      organizationId: orgId,
      targetType: entityType,
      key,
      label: INTERNAL_TASK_FIELDS[key].label,
      fieldType: INTERNAL_TASK_FIELDS[key].fieldType,
      position: INTERNAL_TASK_FIELDS[key].position,
      active: true,
    })),
    skipDuplicates: true,
  });
}

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId };
}

export async function GET(req: NextRequest) {
  const c = await ctx();
  if ("error" in c) return c.error;

  const sp = new URL(req.url).searchParams;
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");
  if (!entityType) return NextResponse.json({ error: "entityType required" }, { status: 400 });

  const definitions = await prisma.customFieldDefinition.findMany({
    where: { organizationId: c.orgId, targetType: entityType, active: true },
    orderBy: [{ position: "asc" }, { label: "asc" }],
  });

  let values: { definitionId: string; valueText: string | null; valueNumber: { toString: () => string } | null; valueDate: Date | null; valueJson: unknown }[] = [];
  if (entityId) {
    values = await prisma.customFieldValue.findMany({
      where: {
        organizationId: c.orgId,
        entityType,
        entityId,
        definitionId: { in: definitions.map((d) => d.id) },
      },
      select: { definitionId: true, valueText: true, valueNumber: true, valueDate: true, valueJson: true },
    });
  }

  // Materialize values into one map keyed by definitionId — easier for
  // the client to render.
  const byDef = new Map(values.map((v) => [v.definitionId, v]));

  const merged = definitions.map((d) => {
    const v = byDef.get(d.id);
    const raw =
      d.fieldType === "NUMBER" ? (v?.valueNumber ? Number(v.valueNumber) : null)
      : d.fieldType === "DATE" ? (v?.valueDate ? v.valueDate.toISOString() : null)
      : d.fieldType === "MULTI_SELECT" ? (v?.valueJson ?? null)
      : d.fieldType === "CHECKBOX" ? (v?.valueText === "true")
      : (v?.valueText ?? null);
    return {
      definitionId: d.id,
      key: d.key,
      label: d.label,
      fieldType: d.fieldType,
      required: d.required,
      options: d.options,
      value: raw,
    };
  });

  return NextResponse.json({ fields: merged });
}

const putSchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
});

export async function PUT(req: NextRequest) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await ensureInternalTaskFields(c.orgId, parsed.data.entityType, Object.keys(parsed.data.values));

  const definitions = await prisma.customFieldDefinition.findMany({
    where: {
      organizationId: c.orgId,
      targetType: parsed.data.entityType,
      key: { in: Object.keys(parsed.data.values) },
    },
  });

  // Upsert one row per (def, entity). For "clear" semantics: if the
  // incoming value is null / empty string / empty array, delete the
  // existing row instead of writing an empty one.
  let written = 0;
  let cleared = 0;
  for (const def of definitions) {
    const raw = parsed.data.values[def.key];
    const isClear =
      raw === null ||
      raw === undefined ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0);

    if (isClear) {
      const r = await prisma.customFieldValue.deleteMany({
        where: { definitionId: def.id, entityType: parsed.data.entityType, entityId: parsed.data.entityId },
      });
      cleared += r.count;
      continue;
    }

    // Map raw → typed columns based on field type
    const valueText =
      def.fieldType === "NUMBER" || def.fieldType === "DATE" || def.fieldType === "MULTI_SELECT"
        ? null
        : def.fieldType === "CHECKBOX"
          ? (raw === true || raw === "true" ? "true" : "false")
          : String(raw ?? "");
    const valueNumber =
      def.fieldType === "NUMBER" && (typeof raw === "number" || typeof raw === "string")
        ? Number(raw)
        : null;
    const valueDate =
      def.fieldType === "DATE" && typeof raw === "string" && raw.length > 0
        ? new Date(raw)
        : null;
    const valueJson =
      def.fieldType === "MULTI_SELECT" && Array.isArray(raw)
        ? (raw as object)
        : undefined;

    // No @@unique index on (definitionId, entityType, entityId) in the
    // existing schema, so we can't use prisma.upsert. Find-then-update/
    // create is the safe path.
    const existing = await prisma.customFieldValue.findFirst({
      where: { definitionId: def.id, entityType: parsed.data.entityType, entityId: parsed.data.entityId },
      select: { id: true },
    });
    if (existing) {
      await prisma.customFieldValue.update({
        where: { id: existing.id },
        data: {
          valueText,
          valueNumber,
          valueDate,
          ...(valueJson !== undefined ? { valueJson: valueJson as object } : {}),
        },
      });
    } else {
      await prisma.customFieldValue.create({
        data: {
          organizationId: c.orgId,
          definitionId: def.id,
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          valueText,
          valueNumber,
          valueDate,
          ...(valueJson !== undefined ? { valueJson: valueJson as object } : {}),
        },
      });
    }
    written++;
  }

  return NextResponse.json({ ok: true, written, cleared });
}
