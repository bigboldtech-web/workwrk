// GET  /api/boards?spaceId=... | /api/boards?folderId=...  — list
// GET  /api/boards?readable=1&q=&ids=&spaceId=&targets=1&writable=1&limit=
//      every task List the viewer can read (or write, with writable=1), for
//      pickers: { boards, spaces, truncated }. See readableLists below.
// POST /api/boards — create a Board with a default View

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createBoard, listBoardsInFolder, listBoardsInSpace } from "@/lib/board";
import { getSpaceForReader, listSpacesForUser } from "@/lib/space";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRole, nodeRoleMap } from "@/lib/access/node-access";
import { resolveCreate } from "@/lib/access/node-placement";
import { roleAtLeast } from "@/lib/access/node-rules";

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

  // ?readable=1: every task List the viewer can READ, for pickers (Phase 5b).
  // It is answered before ?editable=1; the two older branches below are
  // untouched.
  if (url.searchParams.get("readable") === "1") {
    return readableLists(url, c);
  }

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
  const nodeCtx = nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel);

  if (url.searchParams.get("editable") === "1") {
    // Path Spaces are candidates too: a Folder grantee writes to the Lists in
    // their Folder without holding a role on its Space, and the picker groups
    // rows under the Space's name. The write check below decides every row.
    const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel, paths: true });
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
    // ONE world for every candidate (never a gate call per row): only the
    // Lists the viewer can edit, so a picker row never 403s on click.
    const roles = await nodeRoleMap(nodeCtx, "list", candidates.map((b) => b.id));
    const boards = candidates.filter((b) => roleAtLeast(roles.get(b.id) ?? "none", "EDIT"));
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
    // Path Spaces too: a person granted one Folder or List of a Space picks
    // those Lists here like any other, and the role filter below keeps
    // everything else in that Space out.
    const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel, paths: true });
    const spaceIds = spaces.map((s) => s.id);
    const rows = spaceIds.length
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
    // Every row through one world: a PRIVATE List in a readable Space is not
    // listed to someone it does not name.
    const roles = await nodeRoleMap(nodeCtx, "list", rows.map((b) => b.id));
    const boards = rows.filter((b) => roleAtLeast(roles.get(b.id) ?? "none", "VIEW"));
    return NextResponse.json({ boards });
  }

  if (folderId) {
    // Can view on the Folder (org scope, the Private cut and Folder grants,
    // from the one resolver), then only the Lists in it the viewer can open:
    // the same answer the Work tree gives.
    const folder = await nodeRole(nodeCtx, { kind: "folder", id: folderId });
    if (!roleAtLeast(folder.role, "VIEW")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rows = await listBoardsInFolder(folderId, { includeArchived, organizationId: c.organizationId });
    const roles = await nodeRoleMap(nodeCtx, "list", rows.map((b) => b.id));
    const boards = rows.filter((b) => roleAtLeast(roles.get(b.id) ?? "none", "VIEW"));
    return NextResponse.json({ boards });
  }
  if (spaceId) {
    const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
    if (!space || space.organizationId !== c.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rows = await listBoardsInSpace(spaceId, { includeArchived });
    const roles = await nodeRoleMap(nodeCtx, "list", rows.map((b) => b.id));
    const boards = rows.filter((b) => roleAtLeast(roles.get(b.id) ?? "none", "VIEW"));
    return NextResponse.json({ boards });
  }
  return NextResponse.json({ error: "spaceId or folderId required" }, { status: 400 });
}

// GET /api/boards?readable=1&q=&ids=&spaceId=&targets=1&writable=1&limit=
//
// The one source every List and Space picker in Phase 5b reads (dashboard card
// sources, Add to another List, the link Move, connect column targets),
// through readableListsUrl in src/lib/readable-lists.ts.
//
// Why not ?all=1: it answers "every List in a Space I can read", which leaves
// out a List shared with me directly and an ORG-visible List in someone else's
// Space, and it names a PRIVATE List inside a readable Space that I cannot
// open. Here the candidates come through five doors (a Space read in full, a
// Space the viewer only passes through on the way to a Folder or List they
// were given, an ORG-visible List, a direct List grant, my own Personal List)
// and every candidate is then decided by the one resolver over ONE world
// (nodeRoleMap, never a gate call per row), so no row names a List the viewer
// cannot open. writable=1 asks Can edit of the same answer, never a second
// predicate.
//
// The path door is what lets a Folder grantee pick the Lists of their Folder:
// their Space is not read in full, the Lists are not ORG-visible and they hold
// no List row, so without it their pickers came back empty.
//
// Spaces come from the full-read rows only: a Space reached through a Folder
// or List grant is a container the viewer passes through, not something they
// read in full, so it is never offered as a card's "A Space" source.
//
// Search-driven: at most READABLE_TAKE search rows are considered and
// `truncated` says more existed, so a person with thousands of Lists types to
// narrow instead of the server deciding every one. `ids` names Lists a host
// already holds, decided and returned first in the given order, so a chip is
// always nameable whatever page of results is loaded.
const READABLE_TAKE = 300;

async function readableLists(
  url: URL,
  c: { userId: string; accessLevel: string; organizationId: string },
) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const ids = [
    ...new Set(
      (url.searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
  const spaceParam = url.searchParams.get("spaceId")?.trim() || null;
  const targets = url.searchParams.get("targets") === "1";
  const writable = url.searchParams.get("writable") === "1";
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(100, Math.floor(rawLimit)) : 50;

  const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel, paths: true });
  const candidateSpaceIds = spaces.map((s) => s.id);
  const readSpaces = spaces.filter((s) => s.access !== "path");

  const baseWhere = {
    organizationId: c.organizationId,
    archivedAt: null,
    itemType: "studio-item",
    ...(spaceParam ? { spaceId: spaceParam } : {}),
    OR: [
      ...(candidateSpaceIds.length ? [{ spaceId: { in: candidateSpaceIds } }] : []),
      { visibility: "ORG" as const },
      { members: { some: { userId: c.userId } } },
      { spaceId: null, ownerId: c.userId },
    ],
  };
  const select = {
    id: true,
    slug: true,
    name: true,
    icon: true,
    color: true,
    spaceId: true,
    folderId: true,
    productSlug: true,
    settings: true,
  } as const;

  const [searchRows, idRows] = await Promise.all([
    prisma.board.findMany({
      where: q ? { ...baseWhere, name: { contains: q, mode: "insensitive" as const } } : baseWhere,
      select,
      orderBy: { name: "asc" },
      take: READABLE_TAKE,
    }),
    ids.length ? prisma.board.findMany({ where: { ...baseWhere, id: { in: ids } }, select }) : Promise.resolve([]),
  ]);

  type Row = (typeof searchRows)[number];
  const eligible = (b: Row) => {
    const settings =
      b.settings && typeof b.settings === "object" && !Array.isArray(b.settings)
        ? (b.settings as Record<string, unknown>)
        : {};
    if (settings.system === true) return false;
    if (targets && b.productSlug === "personal-list") return false;
    return true;
  };
  // `settings` is read for the system check only and never leaves the server.
  const toRow = (b: Row) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    icon: b.icon ?? null,
    color: b.color ?? null,
    spaceId: b.spaceId ?? null,
    folderId: b.folderId ?? null,
    productSlug: b.productSlug ?? null,
  });

  const idById = new Map(idRows.map((b) => [b.id, b] as const));
  const idCandidates = ids.map((id) => idById.get(id)).filter((b): b is Row => !!b && eligible(b));
  const taken = new Set(idCandidates.map((b) => b.id));
  const searchCandidates = searchRows.filter((b) => !taken.has(b.id) && eligible(b));

  // ONE world for every candidate: the resolver's role on each List (its own
  // grant, its owner, its Folder chain, its Space, the PRIVATE cut), and the
  // rung the caller asked for read off it.
  const roles = await nodeRoleMap(
    nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel),
    "list",
    [...idCandidates, ...searchCandidates].map((b) => b.id),
  );
  const allowed = (b: Row): boolean => roleAtLeast(roles.get(b.id) ?? "none", writable ? "EDIT" : "VIEW");

  const idResults = idCandidates.filter(allowed);
  const found: Row[] = [];
  let overflow = false;
  for (const b of searchCandidates) {
    if (!allowed(b)) continue;
    if (found.length < limit) found.push(b);
    else {
      overflow = true;
      break;
    }
  }
  const truncated = overflow || searchRows.length >= READABLE_TAKE;

  return NextResponse.json(
    {
      boards: [...idResults, ...found].map(toRow),
      spaces: readSpaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? null, color: s.color ?? null })),
      truncated,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
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
  // Where it lands (the placement rule, node-rules P3: its Folder settles the
  // Space, and a Folder in another Space, another org or Trash is refused)
  // and whether the viewer may make a List there (P1: Can edit or higher on
  // the Folder, or on the Space at its root; in a Folder under the legacy
  // Private rule, today's canEditSpace on its Space, P7). A Folder grant
  // never needs, and never gives, anything on the Space.
  const placed = await resolveCreate(
    nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel),
    { spaceId: parsed.data.spaceId, folderId: parsed.data.folderId ?? null },
    "list",
  );
  if (!placed.ok) return NextResponse.json({ error: placed.error }, { status: placed.status });

  try {
    const board = await createBoard({
      organizationId: c.organizationId,
      userId: c.userId,
      spaceId: placed.spaceId as string,
      folderId: placed.folderId,
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
