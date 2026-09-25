// PATCH  /api/boards/[id]/fields/[key] — rename / re-options / reposition
// DELETE /api/boards/[id]/fields/[key] — remove a field (resequences)
//
// Phase 5b. Both run through mutateBoardSchema (the schema read FOR UPDATE and
// written in the same transaction). A RELATIONSHIP's MODE never changes: a
// doc-link field cannot gain targets and a connect field cannot lose them,
// so no stored value ever changes shape under a reader. An editor who cannot
// read every target of a connect or mirror field never silently drops the
// ones they cannot see (mergeHiddenTargets). A connect field a mirror on this
// List reads through cannot be deleted out from under it.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { removeBoardField, SchemaRefusal, updateBoardField } from "@/lib/board-fields";
import { getSpaceForReader } from "@/lib/space";
import { canEditBoard } from "@/lib/board";
import { prisma } from "@/lib/prisma";
import { parseBoardSchema, type FieldDef, type FieldOptions } from "@/lib/field-catalog";
import {
  connectTargets,
  isConnectField,
  isMirrorField,
  mergeHiddenTargets,
  mirrorOptionsOf,
  validateConnectOptionsShape,
  validateMirrorOptions,
} from "@/lib/list-connect";
import { checkConnectTargets, targetFieldMap } from "@/lib/list-connect-server";
import { listReader } from "@/lib/list-links-server";

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

async function gate(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== c.organizationId || !board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  // Editing a field (rename / re-option / reposition / delete) must use the
  // SAME gate as creating one (canEditBoard) — canEditSpace is looser: on a
  // private board it also passes space admins who aren't board members, who
  // could otherwise delete columns of a board they can't even open.
  const canEdit = await canEditBoard(boardId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true as const };
}

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, key } = await params;
  const g = await gate(id, c);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const submitted = parsed.data.options;
  try {
    // What the edit may need to know about other Lists is read BEFORE the
    // lock: which targets the editor can read, and their fields.
    const reader = listReader(c);
    const stored = parseBoardSchema((await prisma.board.findUnique({ where: { id }, select: { schema: true } }))?.schema).fields.find((f) => f.key === key);
    const readable = new Set<string>();
    let targetFields = new Map<string, FieldDef[]>();
    if (stored && submitted && (isConnectField(stored) || isMirrorField(stored) || stored.type === "RELATIONSHIP")) {
      const mentioned = new Set<string>([
        ...connectTargets(stored),
        ...Object.keys(mirrorOptionsOf(stored)?.lookupFieldKeys ?? {}),
        ...(Array.isArray(submitted.targetBoardIds) ? (submitted.targetBoardIds as unknown[]).filter((v): v is string => typeof v === "string") : []),
        ...Object.keys((submitted.lookupFieldKeys as Record<string, unknown> | undefined) ?? {}),
      ]);
      for (const t of mentioned) if (await reader.row(t)) readable.add(t);
      if (isConnectField(stored) && Array.isArray(submitted.targetBoardIds)) {
        const shape = validateConnectOptionsShape({ targetBoardIds: [...new Set([...(submitted.targetBoardIds as string[]), ...connectTargets(stored).filter((t) => !readable.has(t))])] });
        if (!shape.ok) return NextResponse.json({ error: "invalid_options", issue: shape.issue }, { status: 400 });
        const fresh = (submitted.targetBoardIds as string[]).filter((t) => !connectTargets(stored).includes(t));
        if (!(await checkConnectTargets(id, fresh, reader))) {
          return NextResponse.json({ error: "invalid_options", issue: "unknown_target_list" }, { status: 400 });
        }
      }
      if (isMirrorField(stored)) {
        const link = parseBoardSchema((await prisma.board.findUnique({ where: { id }, select: { schema: true } }))?.schema).fields
          .find((f) => f.key === (typeof submitted.linkFieldKey === "string" ? submitted.linkFieldKey : mirrorOptionsOf(stored)?.linkFieldKey));
        targetFields = await targetFieldMap(link ? connectTargets(link) : [], reader);
      }
    }

    const field = await updateBoardField(id, key, {
      label: parsed.data.label,
      options: submitted as never,
      position: parsed.data.position,
    }, {
      optionsFor: submitted
        ? (current, schema) => {
            if (current.type === "RELATIONSHIP") {
              const wasConnect = isConnectField(current);
              const nowConnect = Array.isArray(submitted.targetBoardIds);
              if (wasConnect !== nowConnect) throw new SchemaRefusal(400, { error: "connect_mode_immutable" });
              if (!wasConnect) return submitted as FieldOptions;
              return mergeHiddenTargets(current, submitted, readable) as FieldOptions;
            }
            if (isMirrorField(current)) {
              const mine: Record<string, unknown> = {};
              for (const [list, k] of Object.entries((submitted.lookupFieldKeys as Record<string, unknown> | undefined) ?? {})) {
                if (readable.has(list)) mine[list] = k;
              }
              const hidden = Object.keys(mirrorOptionsOf(current)?.lookupFieldKeys ?? {}).filter((l) => !readable.has(l));
              const candidate: Record<string, unknown> = { ...submitted, lookupFieldKeys: mine };
              if (Object.keys(mine).length > 0 || hidden.length === 0) {
                const v = validateMirrorOptions(candidate, { fields: schema.fields, targetFields, readableTargets: readable });
                if (!v.ok) throw new SchemaRefusal(400, { error: "invalid_options", issue: v.issue });
                return mergeHiddenTargets(current, v.options as unknown as Record<string, unknown>, readable) as FieldOptions;
              }
              // Only hidden lookups remain: the link cannot move under them.
              if (candidate.linkFieldKey !== undefined && candidate.linkFieldKey !== mirrorOptionsOf(current)?.linkFieldKey) {
                throw new SchemaRefusal(400, { error: "invalid_options", issue: "link_field_not_connect" });
              }
              return mergeHiddenTargets(current, { ...current.options, ...candidate } as Record<string, unknown>, readable) as FieldOptions;
            }
            return submitted as FieldOptions;
          }
        : undefined,
    });
    return NextResponse.json({ field });
  } catch (err) {
    if (err instanceof SchemaRefusal) return NextResponse.json(err.body, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update field" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, key } = await params;
  const g = await gate(id, c);
  if ("error" in g) return g.error;
  try {
    await removeBoardField(id, key, {
      // Inside the lock: a mirror on THIS List reading through the field would
      // be left pointing at nothing. Stored values stay in Item.metadata, as
      // for any removed field.
      check: (schema) => {
        const usedBy = schema.fields
          .filter((f) => mirrorOptionsOf(f)?.linkFieldKey === key)
          .map((f) => f.key);
        if (usedBy.length > 0) throw new SchemaRefusal(409, { error: "field_in_use", usedBy });
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SchemaRefusal) return NextResponse.json(err.body, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove field" },
      { status: 400 },
    );
  }
}
