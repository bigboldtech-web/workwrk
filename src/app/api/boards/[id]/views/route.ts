// GET  /api/boards/[id]/views: the views this viewer sees, the List's
//      resolved default first, plus { defaultViewId, defaultPinned }
// POST /api/boards/[id]/views: add a View { name, type, config?, isShared?,
//      isDefault? }; isDefault pins it as the List's default on create

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeBoard, canReadBoard, getBoardForReader } from "@/lib/board";
import {
  listViewsForViewer,
  withPinnedDefault,
  withoutPinnedDefault,
  PIN_PRIVATE_DENIED,
} from "@/lib/work/default-view";
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
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  // The same resolver the List page runs (decision 8), so this answer and the
  // page agree: views[0] is the view the bare List URL opens for this viewer.
  // It used to order by the raw isDefault flag, which put the auto List view
  // first on almost every List while the page now opens Board.
  const { views, defaultView, pinned } = listViewsForViewer(rows, c.userId);
  return NextResponse.json({ views, defaultViewId: defaultView?.id ?? null, defaultPinned: pinned });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(VIEW_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
  /** "Pin as default view" in the + View panel: pin the new view on create. */
  isDefault: z.boolean().optional(),
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
  // A pin is only ever written as a pin. Duplicate copies a view's config
  // verbatim (view-tab-menu.tsx), mark included, so a copy of the pinned
  // view would otherwise arrive carrying somebody's pin.
  const config = withoutPinnedDefault(parsed.data.config ?? {});

  if (!parsed.data.isDefault) {
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
        config: config as object,
        isShared: parsed.data.isShared ?? true,
        ownerId: c.userId,
        displayOrder: (last?.displayOrder ?? -1) + 1,
      },
    });
    return NextResponse.json({ view }, { status: 201 });
  }

  // PIN ON CREATE. The gate above is the contribute ladder, the same one a
  // pin from the tab menu asks for. A private view cannot be a Space List's
  // default (the rest of the List cannot see it); the Personal list has one
  // reader and is exempt. One transaction under the same List lock the pin
  // route takes, so a pin here and a pin there cannot both win.
  if (board.spaceId && parsed.data.isShared === false) {
    return NextResponse.json({ error: PIN_PRIVATE_DENIED }, { status: 409 });
  }
  const view = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`view-default:${id}`}))`;
    await tx.$executeRaw`
      UPDATE "View" SET "isDefault" = false,
        "config" = CASE WHEN jsonb_typeof("config") = 'object' THEN "config" - 'pinned' ELSE "config" END,
        "updatedAt" = NOW()
      WHERE "boardId" = ${id}
        AND ("isDefault" = true OR ("config" -> 'pinned') IS NOT NULL)`;
    const last = await tx.view.findFirst({
      where: { boardId: id },
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });
    return tx.view.create({
      data: {
        boardId: id,
        name: parsed.data.name,
        type: parsed.data.type,
        config: withPinnedDefault(config, { byId: c.userId, at: new Date().toISOString() }) as object,
        isShared: parsed.data.isShared ?? true,
        isDefault: true,
        ownerId: c.userId,
        displayOrder: (last?.displayOrder ?? -1) + 1,
      },
    });
  });
  return NextResponse.json({ view }, { status: 201 });
}
