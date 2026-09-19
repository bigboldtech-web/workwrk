// GET  /api/boards?spaceId=... | /api/boards?folderId=...  — list
// POST /api/boards — create a Board with a default View

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeBoard, createBoard, listBoardsInFolder, listBoardsInSpace } from "@/lib/board";
import { canEditSpace, getSpaceForReader, listSpacesForUser } from "@/lib/space";
import { canRead, type ViewerContext } from "@/lib/access";
import { prisma } from "@/lib/prisma";

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

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId");
  const folderId = url.searchParams.get("folderId");
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  // ?editable=1: every List the viewer may WRITE to, grouped by Space.
  //
  // This is the source for the create-task modal's location picker and for
  // "Move to list…" (spec-task-detail section 4 step 1). It exists because
  // ?all=1 answers "what can I read", and offering a person a destination they
  // cannot write to produces a picker row that 403s on click. The Personal
  // list rides along: it is space-less, so it comes back under a null spaceId
  // and the picker renders it first, as "My work › Personal list".
  //
  // `productSlug` rides along too, because the two callers do NOT want the same
  // set: creating a task in your own Personal list is valid, moving another
  // List's task into it is refused by PATCH /api/items/[id] with 403. The route
  // stays the superset and answers enough for a caller to filter, rather than
  // narrowing for one caller and breaking the other.
  if (url.searchParams.get("editable") === "1") {
    const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel });
    const spaceIds = spaces.map((s) => s.id);
    const candidates = await prisma.board.findMany({
      where: {
        organizationId: c.organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
        OR: [
          ...(spaceIds.length ? [{ spaceId: { in: spaceIds } }] : []),
          // Space-less boards the viewer owns: the Personal list.
          { spaceId: null, ownerId: c.userId },
          // A direct List grant, which does not need Space membership.
          { members: { some: { userId: c.userId } } },
        ],
      },
      select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true, folderId: true, productSlug: true },
      orderBy: { name: "asc" },
    });
    // One write check per candidate. The list is per-viewer and small (a
    // person is on tens of Lists, not thousands), and offering a row that
    // 403s would be worse than the checks.
    const allowed = await Promise.all(
      candidates.map(async (b) => ((await canContributeBoard(b.id, c.userId, c.accessLevel)) ? b : null)),
    );
    const boards = allowed.filter((b): b is NonNullable<typeof b> => b !== null);
    // Only the Spaces that still have a List under them after the write check.
    // `spaces` is everything the viewer can READ, so a Space they can open but
    // write to nowhere inside came back with no boards beneath it, and the
    // picker drew an empty Space header. This route exists precisely so a
    // picker never offers a row that leads nowhere; a header with nothing under
    // it is the same broken promise one level up.
    const usedSpaceIds = new Set(boards.map((b) => b.spaceId).filter((id): id is string => !!id));
    const spaceById = new Map(
      spaces
        .filter((s) => usedSpaceIds.has(s.id))
        .map((s) => [s.id, { id: s.id, name: s.name, icon: s.icon ?? null }] as const),
    );
    return NextResponse.json({
      boards,
      spaces: [...spaceById.values()],
    });
  }

  // Flat org-wide listing across every Space the viewer can read. Used
  // by cross-entity pickers (e.g. linking Boards to an OKR) where the
  // caller has no single Space context. Backwards-compatible: only
  // triggers on ?all=1.
  if (url.searchParams.get("all") === "1") {
    const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel });
    const spaceIds = spaces.map((s) => s.id);
    const boards = spaceIds.length
      ? await prisma.board.findMany({
          where: {
            organizationId: c.organizationId,
            spaceId: { in: spaceIds },
            ...(includeArchived ? {} : { archivedAt: null }),
          },
          select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true },
          orderBy: { name: "asc" },
        })
      : [];
    return NextResponse.json({ boards });
  }

  if (folderId) {
    // Gate on folder READ (the resolver also enforces org scope + PRIVATE +
    // folder grants). Previously this branch was unauthenticated and cross-org.
    const viewer: ViewerContext = { userId: c.userId, organizationId: c.organizationId, accessLevel: c.accessLevel };
    if (!(await canRead(viewer, { type: "folder", id: folderId }))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const boards = await listBoardsInFolder(folderId, { includeArchived, organizationId: c.organizationId });
    return NextResponse.json({ boards });
  }
  if (spaceId) {
    const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
    if (!space || space.organizationId !== c.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const boards = await listBoardsInSpace(spaceId, { includeArchived });
    return NextResponse.json({ boards });
  }
  return NextResponse.json({ error: "spaceId or folderId required" }, { status: 400 });
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z
  .object({
    spaceId: z.string().min(1),
    folderId: z.string().min(1).nullable().optional(),
    // Optional ONLY for sprint creates (server derives "Sprint N (M/D - M/D)");
    // the refine below keeps name required for every non-sprint create.
    name: z.string().max(80).optional(),
    description: z.string().max(280).optional(),
    icon: z.string().max(40).optional(),
    color: z.string().max(20).optional(),
    itemType: z.string().max(40).optional(),
    defaultViewType: z.enum(VIEW_TYPES).optional(),
    visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
    // Sprints (migration-free): mark the new List a Sprint with these dates.
    sprint: z
      .object({ startDate: isoDate, endDate: isoDate })
      .refine((s) => s.endDate >= s.startDate, { message: "endDate must be on/after startDate" })
      .optional(),
  })
  .refine((v) => Boolean(v.sprint) || Boolean(v.name && v.name.trim()), {
    message: "name is required",
    path: ["name"],
  });

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const space = await getSpaceForReader(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const board = await createBoard({
      organizationId: c.organizationId,
      userId: c.userId,
      spaceId: parsed.data.spaceId,
      folderId: parsed.data.folderId ?? null,
      name: parsed.data.name ?? "",
      description: parsed.data.description,
      icon: parsed.data.icon,
      color: parsed.data.color,
      itemType: parsed.data.itemType,
      defaultViewType: parsed.data.defaultViewType,
      visibility: parsed.data.visibility,
      sprint: parsed.data.sprint,
    });
    return NextResponse.json({ board }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create board" },
      { status: 400 },
    );
  }
}
