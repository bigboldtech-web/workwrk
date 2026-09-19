// GET  /api/boards/[id]/views — list views on a Board
// POST /api/boards/[id]/views — add a new View { name, type, config?, isPrivate? }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeBoard, canReadBoard, getBoardForReader } from "@/lib/board";
import { prisma } from "@/lib/prisma";

/** The refusal, as a sentence. The sibling route already writes one
 *  (SAVE_DENIED); this one answered the bare code "Forbidden", which the
 *  client printed verbatim. */
const CREATE_DENIED =
  "You can read this List but not add views to it. Ask a List or Space admin for access.";

const VIEW_TYPES = [
  "TABLE", "KANBAN", "GANTT", "CALENDAR", "TIMELINE", "CHART", "DOC", "FORM",
  "DASHBOARD", "MAP", "WORKLOAD", "WHITEBOARD", "FILE_GALLERY",
  "CARDS", "PIVOT", "HIERARCHY", "ACTIVITY",
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const canRead = await canReadBoard(id, c.userId, c.accessLevel);
  if (!canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // audit spaces-boards High #5: "Private view" was cosmetic. The create
  // popover has always written `isShared: !isPrivate` and every create sets
  // `ownerId`, but this read returned every row, so a private view was private
  // in the dialog and public on the page. The rule lives in
  // src/lib/work/view-visibility.ts and is applied here AND on the page, so
  // the two can never disagree. `ownerId: null` is the legacy row and reads as
  // shared: hiding those would take a List's tabs away from everyone.
  const rows = await prisma.view.findMany({
    where: {
      boardId: id,
      OR: [{ isShared: true }, { ownerId: null }, { ownerId: c.userId }],
    },
    orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ views: rows });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(VIEW_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // CONTRIBUTE, not manage. PATCH on the sibling route
  // (/views/[viewId]) has gated on canContributeBoard since the
  // "a Space member who may create every task still got a 403 when they
  // renamed a tab" fix, so a Board member could already rename a shared view
  // and rewrite its config, but not add one of their own. Allowing the edit
  // and refusing the create is backwards in risk terms. DELETE stays on the
  // management ladder (canManageView), because removing a shared view destroys
  // other people's saved work.
  const canCreate = await canContributeBoard(id, c.userId, c.accessLevel);
  if (!canCreate) return NextResponse.json({ error: CREATE_DENIED }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const last = await prisma.view.findFirst({
    where: { boardId: id },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const view = await prisma.view.create({
    data: {
      boardId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      config: (parsed.data.config ?? {}) as object,
      isShared: parsed.data.isShared ?? true,
      ownerId: c.userId,
      displayOrder: (last?.displayOrder ?? -1) + 1,
    },
  });
  return NextResponse.json({ view }, { status: 201 });
}
