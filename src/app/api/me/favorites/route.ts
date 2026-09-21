// GET /api/me/favorites: every starred object, in one call.
//
// spec-work-home.md section 2 (/favorites) and section 4 W0: "new aggregate
// over the seven `favorite*Ids` preference keys, hydrated and filtered by
// `accessibleIds` per kind; unreadable ids are pruned from the preference on
// read".
//
// WHY IT EXISTS. The seven per-kind routes
// (/api/me/favorites/{boards,spaces,docs,folders,tables,whiteboards,files})
// stay exactly as they are: the Work sidebar's FAVORITES section fires all
// seven in parallel and nothing about that changes here. What did not exist
// was a single call that answers "what have I starred", which is what the
// /favorites PAGE needs, and seven round trips for one table is the wrong
// shape for a page.
//
// PRUNING, stated carefully because it writes to a preference. An id whose
// object is GONE: the row no longer exists at all, is dropped from the stored
// list, so a star does not accumulate tombstones forever.
//
// ARCHIVED IS NOT GONE. Archiving a List, a Folder, a Space or a Doc is a
// reversible menu action with a Restore on the other side of it, and un-
// archiving cannot bring back a star this route already deleted. So archived
// objects still count as ALIVE for pruning, are simply hidden from the
// response, and keep their star. An id whose object exists but which the VIEWER
// cannot currently read is likewise hidden and LEFT IN THE PREFERENCE: access
// comes back, and silently un-starring someone's work because they were briefly
// off a Space would be a data loss they never asked for. `?prune=0` skips the
// write entirely.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserPreference } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";
import { getBoardForReader } from "@/lib/board";
import { getSpaceForReader } from "@/lib/space";
import { docAccessible } from "@/lib/doc-access";

/** The seven kinds, and the preference key each one is stored under. */
export const FAVORITE_KINDS = [
  { kind: "space", key: "favoriteSpaceIds" },
  { kind: "folder", key: "favoriteFolderIds" },
  { kind: "list", key: "favoriteBoardIds" },
  { kind: "doc", key: "favoriteDocIds" },
  { kind: "table", key: "favoriteTableIds" },
  { kind: "canvas", key: "favoriteWhiteboardIds" },
  { kind: "file", key: "favoriteFileIds" },
] as const;

export type FavoriteKind = (typeof FAVORITE_KINDS)[number]["kind"];

interface FavoriteRow {
  kind: FavoriteKind;
  id: string;
  name: string;
  href: string;
  icon: string | null;
  color: string | null;
  /** The Space (and Folder) the object sits in, for the Location column. */
  spaceId: string | null;
  /** Position in the stored list, which is the "recently starred" order. */
  order: number;
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = u.id;
  const organizationId = u.organizationId;
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const prune = new URL(req.url).searchParams.get("prune") !== "0";

  const effective = await getEffectivePreferences(userId, organizationId);
  const home = (effective?.home ?? {}) as unknown as Record<string, unknown>;
  const stored: Record<string, string[]> = {};
  for (const { key } of FAVORITE_KINDS) stored[key] = idsOf(home[key]);

  const [spaces, folders, boards, docs, tables, canvases, files] = await Promise.all([
    stored.favoriteSpaceIds.length
      ? prisma.space.findMany({
          where: { organizationId, id: { in: stored.favoriteSpaceIds } },
          select: { id: true, slug: true, name: true, icon: true, color: true, archivedAt: true },
        })
      : Promise.resolve([]),
    stored.favoriteFolderIds.length
      ? prisma.folder.findMany({
          where: { organizationId, id: { in: stored.favoriteFolderIds } },
          select: { id: true, name: true, icon: true, color: true, spaceId: true, archivedAt: true },
        })
      : Promise.resolve([]),
    stored.favoriteBoardIds.length
      ? prisma.board.findMany({
          where: { organizationId, id: { in: stored.favoriteBoardIds } },
          select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true, archivedAt: true },
        })
      : Promise.resolve([]),
    stored.favoriteDocIds.length
      ? prisma.doc.findMany({
          where: { organizationId, id: { in: stored.favoriteDocIds } },
          // `content` for the icon only: a doc's emoji lives at
          // content.meta.icon (there is no column), and without it the
          // FAVORITES row drew a generic FileText for a doc whose own emoji
          // was on screen twelve rows below in the DOCS tree.
          select: { id: true, title: true, entityType: true, entityId: true, archivedAt: true, content: true },
        })
      : Promise.resolve([]),
    stored.favoriteTableIds.length
      ? prisma.dataTable.findMany({
          where: { organizationId, id: { in: stored.favoriteTableIds } },
          select: { id: true, name: true, spaceId: true },
        })
      : Promise.resolve([]),
    stored.favoriteWhiteboardIds.length
      ? prisma.whiteboard.findMany({
          where: { organizationId, id: { in: stored.favoriteWhiteboardIds } },
          select: { id: true, name: true, spaceId: true },
        })
      : Promise.resolve([]),
    stored.favoriteFileIds.length
      ? prisma.fileEntry.findMany({
          where: { organizationId, id: { in: stored.favoriteFileIds } },
          select: { id: true, name: true, spaceId: true },
        })
      : Promise.resolve([]),
  ]);

  // Every id that still resolves to a row, whether or not the viewer can read
  // it and whether or not it is archived. This is what pruning is measured
  // against, so neither a temporary loss of access nor a reversible archive can
  // un-star anything.
  const alive: Record<string, Set<string>> = {
    favoriteSpaceIds: new Set(spaces.map((r) => r.id)),
    favoriteFolderIds: new Set(folders.map((r) => r.id)),
    favoriteBoardIds: new Set(boards.map((r) => r.id)),
    favoriteDocIds: new Set(docs.map((r) => r.id)),
    favoriteTableIds: new Set(tables.map((r) => r.id)),
    favoriteWhiteboardIds: new Set(canvases.map((r) => r.id)),
    favoriteFileIds: new Set(files.map((r) => r.id)),
  };

  const orderOf = (key: string, id: string) => {
    const i = stored[key].indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  const readableSpace = async (spaceId: string | null) =>
    spaceId ? Boolean(await getSpaceForReader(spaceId, userId, accessLevel)) : true;

  const rows: FavoriteRow[] = [];
  // Starred objects that are archived: still alive, still starred, not listed.
  const archivedCount =
    spaces.filter((r) => r.archivedAt).length +
    folders.filter((r) => r.archivedAt).length +
    boards.filter((r) => r.archivedAt).length +
    docs.filter((r) => r.archivedAt).length;

  for (const s of spaces) {
    if (s.archivedAt) continue;
    if (!(await getSpaceForReader(s.id, userId, accessLevel))) continue;
    rows.push({
      kind: "space",
      id: s.id,
      name: s.name,
      href: `/spaces/${s.slug}`,
      icon: s.icon,
      color: s.color,
      spaceId: s.id,
      order: orderOf("favoriteSpaceIds", s.id),
    });
  }
  for (const f of folders) {
    if (f.archivedAt) continue;
    if (!(await readableSpace(f.spaceId))) continue;
    rows.push({
      kind: "folder",
      id: f.id,
      name: f.name,
      href: `/folders/${f.id}`,
      icon: f.icon,
      color: f.color,
      spaceId: f.spaceId,
      order: orderOf("favoriteFolderIds", f.id),
    });
  }
  for (const b of boards) {
    if (b.archivedAt) continue;
    // A List is gated on the List, not on its Space: a direct grant reaches a
    // List inside a Space the viewer is not on.
    if (!(await getBoardForReader(b.id, userId, accessLevel))) continue;
    rows.push({
      kind: "list",
      id: b.id,
      name: b.name,
      href: `/boards/${b.slug}`,
      icon: b.icon,
      color: b.color,
      spaceId: b.spaceId,
      order: orderOf("favoriteBoardIds", b.id),
    });
  }
  for (const d of docs) {
    if (d.archivedAt) continue;
    if (!(await docAccessible(d, userId, accessLevel))) continue;
    const docMeta = (d.content as { meta?: { icon?: unknown } } | null)?.meta;
    rows.push({
      kind: "doc",
      id: d.id,
      name: d.title,
      href: `/docs/${d.id}`,
      icon: typeof docMeta?.icon === "string" && docMeta.icon ? docMeta.icon : null,
      color: null,
      spaceId: null,
      order: orderOf("favoriteDocIds", d.id),
    });
  }
  for (const t of tables) {
    if (!(await readableSpace(t.spaceId))) continue;
    rows.push({
      kind: "table",
      id: t.id,
      name: t.name,
      href: `/tables/${t.id}`,
      icon: null,
      color: null,
      spaceId: t.spaceId,
      order: orderOf("favoriteTableIds", t.id),
    });
  }
  for (const w of canvases) {
    if (!(await readableSpace(w.spaceId))) continue;
    rows.push({
      kind: "canvas",
      id: w.id,
      name: w.name,
      href: `/canvas/${w.id}`,
      icon: null,
      color: null,
      spaceId: w.spaceId,
      order: orderOf("favoriteWhiteboardIds", w.id),
    });
  }
  for (const f of files) {
    if (!(await readableSpace(f.spaceId))) continue;
    rows.push({
      kind: "file",
      id: f.id,
      name: f.name,
      href: `/files?file=${f.id}`,
      icon: null,
      color: null,
      spaceId: f.spaceId,
      order: orderOf("favoriteFileIds", f.id),
    });
  }

  rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  // Space names for the Location column, in one query rather than per row.
  const spaceIds = [...new Set(rows.map((r) => r.spaceId).filter((id): id is string => !!id))];
  const spaceRows = spaceIds.length
    ? await prisma.space.findMany({
        where: { organizationId, id: { in: spaceIds } },
        select: { id: true, slug: true, name: true },
      })
    : [];
  const spaceById = Object.fromEntries(spaceRows.map((s) => [s.id, s] as const));

  // Prune dead ids only. See the note at the top of this file.
  let pruned: Record<string, string[]> | null = null;
  if (prune) {
    const next: Record<string, string[]> = {};
    let changed = false;
    for (const { key } of FAVORITE_KINDS) {
      const kept = stored[key].filter((id) => alive[key].has(id));
      next[key] = kept;
      if (kept.length !== stored[key].length) changed = true;
    }
    if (changed) {
      pruned = next;
      // `{ home: next }`, never `{ home: { ...effective.home, ...next } }`:
      // `effective.home` is DEFAULT_HOME + the org's home defaults + the user's
      // own row, so spreading it stamped every product and org default onto
      // this user permanently, freezing them against later changes.
      // setUserPreference already deep-merges, so the patch is the delta.
      await setUserPreference(userId, { home: next }).catch(() => {});
    }
  }

  return NextResponse.json({
    favorites: rows,
    spaces: spaceById,
    total: rows.length,
    // Named so a caller can tell "you starred nothing" apart from "everything
    // you starred is currently unreadable", which are very different states.
    // Archived objects keep their star and are counted separately, because
    // "hidden until someone restores it" is not "hidden until you get access".
    hiddenByAccess:
      Object.values(alive).reduce((n, set) => n + set.size, 0) - rows.length - archivedCount,
    hiddenByArchive: archivedCount,
    ...(pruned ? { pruned: true } : {}),
  });
}
