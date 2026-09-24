// GET  /api/boards/[id]/fields — list fields on a Board
// POST /api/boards/[id]/fields — append a new field { label, type, options? }
//
// Phase 5b, connected and mirror columns (monday.com's model, as field config).
// A RELATIONSHIP whose options carry `targetBoardIds` is a CONNECT column; a
// MIRROR reads one of this List's connect columns. Both are validated here,
// target by target, and every List a caller cannot read is refused with ONE
// answer that names no List. A RELATIONSHIP without targetBoardIds keeps
// today's single doc-link mode and today's unvalidated options.
//
// GET answers each field as the caller may see it (redactFieldForViewer):
// target Lists they cannot read are left out, and nothing says how many.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { addBoardField, getBoardFields, SchemaRefusal } from "@/lib/board-fields";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { parseBoardSchema, type FieldOptions } from "@/lib/field-catalog";
import { isConnectField, validateConnectOptionsShape, validateMirrorOptions } from "@/lib/list-connect";
import { listReader } from "@/lib/list-links-server";
import { checkConnectTargets, targetFieldMap } from "@/lib/list-connect-server";
import { prisma } from "@/lib/prisma";
import { redactFieldsForViewer } from "@/lib/board-items-view";

const FIELD_TYPES = [
  "TEXT", "LONG_TEXT", "NUMBER", "DATE", "DATETIME",
  "DROPDOWN", "MULTI_SELECT", "CHECKBOX", "LABELS", "TSHIRT_SIZE",
  "URL", "EMAIL", "PHONE", "MONEY", "PERCENT", "RATING",
  "PROGRESS_AUTO", "PROGRESS_MANUAL", "USER", "PEOPLE", "FILES",
  "RELATIONSHIP", "ROLLUP", "FORMULA", "LOCATION", "BUTTON",
  "SIGNATURE", "VOTING", "ACTION_ITEMS", "SUMMARY", "SENTIMENT",
  "CATEGORIZE", "TRANSLATION", "CUSTOM_TEXT", "CUSTOM_DROPDOWN",
  "KRA",
  // connection-as-field — link a Doc / SOP / Canvas to the row (see field-catalog)
  "LINKED_DOC", "LINKED_SOP", "LINKED_CANVAS",
  // Phase 5b: a read-time column over one of this List's connect columns.
  "MIRROR",
] as const;

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

async function loadBoard(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  // Phase 23b — compose Space + Board gates. Cross-org check folded in.
  const board = await getBoardForReader(boardId, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { board };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadBoard(id, c);
  if ("error" in gate) return gate.error;
  const fields = await redactFieldsForViewer(await getBoardFields(id), listReader(c));
  return NextResponse.json({ fields });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadBoard(id, c);
  if ("error" in gate) return gate.error;
  const canEdit = await canEditBoard(id, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const reader = listReader(c);
  const { type } = parsed.data;
  const options = parsed.data.options;
  try {
    // ── Connect mode: the targets are checked before the lock, one by one.
    if (type === "RELATIONSHIP" && options && "targetBoardIds" in options) {
      const shape = validateConnectOptionsShape(options);
      if (!shape.ok) return NextResponse.json({ error: "invalid_options", issue: shape.issue }, { status: 400 });
      if (!(await checkConnectTargets(id, shape.targetBoardIds, reader))) {
        return NextResponse.json({ error: "invalid_options", issue: "unknown_target_list" }, { status: 400 });
      }
      const field = await addBoardField({
        boardId: id,
        label: parsed.data.label,
        type,
        options: { ...(options as FieldOptions), targetBoardIds: shape.targetBoardIds },
      });
      return NextResponse.json({ field }, { status: 201 });
    }

    // ── Mirror: the target Lists' schemas are read before the lock; every
    // check against THIS List's schema runs on the locked row, so a
    // concurrent delete of the connect field can never leave a mirror
    // pointing at nothing.
    if (type === "MIRROR") {
      const current = parseBoardSchema((await prisma.board.findUnique({ where: { id }, select: { schema: true } }))?.schema).fields;
      const linkKey = typeof options?.linkFieldKey === "string" ? options.linkFieldKey : "";
      const link = current.find((f) => f.key === linkKey);
      const targetIds = link && isConnectField(link) ? ((link.options?.targetBoardIds ?? []) as string[]) : [];
      const targetFields = await targetFieldMap(targetIds, reader);
      const readableTargets = new Set(targetFields.keys());
      const field = await addBoardField({
        boardId: id,
        label: parsed.data.label,
        type,
        optionsFor: (schema) => {
          const v = validateMirrorOptions(options ?? {}, { fields: schema.fields, targetFields, readableTargets });
          if (!v.ok) throw new SchemaRefusal(400, { error: "invalid_options", issue: v.issue });
          return v.options as FieldOptions;
        },
      });
      return NextResponse.json({ field }, { status: 201 });
    }

    const field = await addBoardField({
      boardId: id,
      label: parsed.data.label,
      type,
      options: options as never,
    });
    return NextResponse.json({ field }, { status: 201 });
  } catch (err) {
    if (err instanceof SchemaRefusal) return NextResponse.json(err.body, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add field" },
      { status: 400 },
    );
  }
}
