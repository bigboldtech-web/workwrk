// A doc's anchor as a "Location" (the real Space / Folder / List / task name
// with its icon and page), resolved in one query per anchor type. Shared by
// GET /api/docs (the list) and GET /api/docs/[id] (the editor's BackButton
// and breadcrumb), so the two never disagree about where a doc lives.
//
// Server-only: prisma.

import { prisma } from "@/lib/prisma";

export type DocLocation = { type: string; id: string; name: string; icon: string | null; color: string | null; href: string | null };

export async function resolveDocLocations(docs: { entityType: string | null; entityId: string | null }[]): Promise<Map<string, DocLocation>> {
  const idsOf = (t: string) =>
    [...new Set(docs.filter((d) => d.entityType === t && d.entityId).map((d) => d.entityId as string))];
  const [locSpaces, locBoards, locFolders, locItems] = await Promise.all([
    idsOf("SPACE").length ? prisma.space.findMany({ where: { id: { in: idsOf("SPACE") } }, select: { id: true, name: true, icon: true, color: true, slug: true } }) : Promise.resolve([]),
    idsOf("BOARD").length ? prisma.board.findMany({ where: { id: { in: idsOf("BOARD") } }, select: { id: true, name: true, icon: true, color: true, slug: true } }) : Promise.resolve([]),
    idsOf("FOLDER").length ? prisma.folder.findMany({ where: { id: { in: idsOf("FOLDER") } }, select: { id: true, name: true, icon: true, color: true } }) : Promise.resolve([]),
    idsOf("BOARD_ITEM").length ? prisma.item.findMany({ where: { id: { in: idsOf("BOARD_ITEM") } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  const map = new Map<string, DocLocation>();
  for (const s of locSpaces) map.set(`SPACE:${s.id}`, { type: "SPACE", id: s.id, name: s.name, icon: s.icon, color: s.color, href: `/spaces/${s.slug}` });
  for (const b of locBoards) map.set(`BOARD:${b.id}`, { type: "BOARD", id: b.id, name: b.name, icon: b.icon, color: b.color, href: `/boards/${b.slug}` });
  for (const f of locFolders) map.set(`FOLDER:${f.id}`, { type: "FOLDER", id: f.id, name: f.name, icon: f.icon, color: f.color, href: `/folders/${f.id}` });
  for (const it of locItems) map.set(`BOARD_ITEM:${it.id}`, { type: "BOARD_ITEM", id: it.id, name: it.title, icon: null, color: null, href: `/item/${it.id}` });
  return map;
}

export async function resolveDocLocation(doc: { entityType: string | null; entityId: string | null }): Promise<DocLocation | null> {
  if (!doc.entityType || !doc.entityId) return null;
  const map = await resolveDocLocations([doc]);
  return map.get(`${doc.entityType}:${doc.entityId}`) ?? null;
}
