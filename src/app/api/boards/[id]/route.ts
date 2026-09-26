// PATCH  /api/boards/[id]: rename, re-color, re-folder (a move), re-visibility
// DELETE /api/boards/[id]: archive (soft); ?hard=1 moves it to Trash

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveBoard, boardRoleOf, updateBoard } from "@/lib/board";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { moveList } from "@/lib/access/node-placement";
import { roleAtLeast } from "@/lib/access/node-rules";
import { recordGeneralAccessChange } from "@/lib/access/grants";
import { moveToTrash } from "@/lib/trash";
import { prisma } from "@/lib/prisma";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { parseBoardSchema } from "@/lib/field-catalog";
import {
  listDefaultsSchema,
  parseRowColorRules,
  rowColorRuleSchema,
  userIdsInDefaults,
  validateListDefaults,
  MAX_ROW_COLOR_RULES,
} from "@/lib/list-comfort";
import { recipientProblems } from "@/lib/reports/schedule";
import { listReader } from "@/lib/list-links-server";
import { redactFieldsForViewer } from "@/lib/board-items-view";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string; name?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId, userName: u.name ?? null };
}

async function loadAndGate(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  // Cross-tenant safety + the one resolver's role on the List: no role is the
  // same 404 as a board in another org; below Full access is 403. Full access
  // on a List (its own OWNER or ADMIN row, its owner, a Full holder of its
  // Folder or Space) manages it (W3).
  const { board, role } = await boardRoleOf(boardId, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId || role === "none") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!roleAtLeast(role, "FULL")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { board };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
  folderId: z.string().min(1).nullable().optional(),
  // Per-List statuses (backbone #1). null resets to the default trio.
  // Values must be unique — they're the stored Item.status keys.
  statuses: z
    .array(
      z.object({
        value: z.string().min(1).max(60),
        label: z.string().min(1).max(60),
        color: z.string().min(1).max(20),
        group: z.enum(["ACTIVE", "DONE", "CLOSED"]),
      }),
    )
    .min(1)
    .max(30)
    .refine((arr) => new Set(arr.map((s) => s.value)).size === arr.length, {
      message: "status values must be unique",
    })
    .nullable()
    .optional(),
  // Sprint date edit — only valid on boards already carrying settings.sprint
  // (updateBoard rejects the rest with "Not a sprint List").
  sprint: z
    .object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine((s) => s.endDate >= s.startDate, { message: "endDate must be on/after startDate" })
    .optional(),
  // The List's default task type, written by the "…" menu's submenu (spec
  // spaces-lists section 1, List row 10). Merged into settings, never a
  // wholesale settings replace.
  defaultItemTypeId: z.string().min(1).max(64).nullable().optional(),
  // Phase 5b, List comfort (gap 14). Default values a NEW task gets for the
  // keys its creator did not send; null clears them. The task type default
  // stays on defaultItemTypeId above, its one home.
  defaults: listDefaultsSchema.nullable().optional(),
  // Conditional row colouring: field, operator, value and a palette colour.
  rowColorRules: z.array(rowColorRuleSchema).max(MAX_ROW_COLOR_RULES).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // Defaults are checked against THIS List: its statuses and fields, then the
  // people and tags they name, which must exist and be live in this org.
  if (parsed.data.defaults) {
    const row = await prisma.board.findUnique({ where: { id }, select: { statuses: true, schema: true } });
    const fields = parseBoardSchema(row?.schema).fields;
    const issues = validateListDefaults(parsed.data.defaults, { statuses: getBoardStatuses(row), fields });
    const userIds = userIdsInDefaults(parsed.data.defaults, fields);
    if (userIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, organizationId: true, deletedAt: true, status: true },
      });
      if (recipientProblems(userIds, users, c.organizationId).length) issues.push("unknown_person");
    }
    const tagIds = parsed.data.defaults.tagIds ?? [];
    if (tagIds.length) {
      const tags = await prisma.tag.findMany({ where: { id: { in: tagIds }, organizationId: c.organizationId, archived: false }, select: { id: true } });
      if (tags.length !== new Set(tagIds).size) issues.push("unknown_tag");
    }
    if (issues.length) return NextResponse.json({ error: "invalid_defaults", issues }, { status: 400 });
  }
  // A rule list must survive its own reader unchanged: no duplicate ids, no
  // entry the reader would drop.
  if (parsed.data.rowColorRules) {
    const round = parseRowColorRules(parsed.data.rowColorRules);
    if (JSON.stringify(round) !== JSON.stringify(parsed.data.rowColorRules)) {
      return NextResponse.json({ error: "invalid_row_color_rules" }, { status: 400 });
    }
  }
  // Re-foldering through PATCH is a move (the placement rule, node-rules P2
  // and P3), through the one helper: Full access on the List and where it is
  // now, Can edit where it goes, and the Space taken from the Folder it goes
  // into. It used to write folderId alone, which left a List in one Space
  // inside a Folder of another. The move runs before anything else is
  // written, so a refused move writes nothing at all.
  const { folderId: nextFolderId, ...edits } = parsed.data;
  if (nextFolderId !== undefined && nextFolderId !== gate.board.folderId) {
    const moved = await moveList(nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel), id, { folderId: nextFolderId });
    if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: moved.status });
  }
  try {
    // A visibility change is an access change: the List's visibility and its
    // activity row are one transaction (general access sends no notification,
    // by decision). The rest of the patch goes through updateBoard as before.
    const { visibility, ...rest } = edits;
    if (visibility !== undefined && visibility !== gate.board.visibility) {
      await prisma.$transaction(async (tx) => {
        await tx.board.update({ where: { id }, data: { visibility } });
        await recordGeneralAccessChange(tx, { userId: c.userId, organizationId: c.organizationId }, { kind: "list", id }, { visibility: { from: gate.board.visibility, to: visibility } });
      });
    }
    const updated = Object.keys(rest).length > 0 ? await updateBoard(id, rest) : await updateBoard(id, {});
    // The schema goes back as this caller may see it: connect targets they
    // cannot read are not named.
    const fields = await redactFieldsForViewer(parseBoardSchema(updated.schema).fields, listReader(c));
    const schema = updated.schema && typeof updated.schema === "object" && !Array.isArray(updated.schema)
      ? { ...(updated.schema as Record<string, unknown>), fields }
      : updated.schema;
    return NextResponse.json({ board: { ...updated, schema } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update board" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  if (hard) {
    // Recoverable delete — snapshot the list (+ items/views/members) to Trash.
    await moveToTrash("board", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveBoard(id, c.userId);
  return NextResponse.json({ board: archived });
}
