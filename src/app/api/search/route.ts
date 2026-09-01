import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import { docAccessible } from "@/lib/doc-access";
import { visibleSpaceIds, isOrgAdminAccessLevel } from "@/lib/space";
import { accessibleFolderIds } from "@/lib/folder";

/**
 * Unified entity search across the product. Powers the Cmd-K palette's
 * live-results section — typing a phrase searches the real work graph in
 * parallel and surfaces a flat ranked list.
 *
 * Scope policy:
 *   · Every query is org-scoped (no cross-tenant leaks).
 *   · Space / Board visibility is enforced so private work never bleeds
 *     into another viewer's palette (admins see everything).
 *   · Per-kind cap so a long-prefix query that matches 200 items and 0
 *     boards still feels instant. Defaults to 5 per kind.
 *   · Empty / too-short queries return an empty array (cheap).
 *
 * This searches the ACTUAL work graph — Item (tasks), Board (lists),
 * Space, Folder, Doc (notes), Whiteboard, and people — plus the alignment
 * + org surfaces that still have live routes (SOP, OKR, meeting,
 * department, idea, policy, announcement). It deliberately does NOT search
 * the legacy `Task` table, nor the amputated procurement / financials /
 * planning modules whose pages 404.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return jsonSuccess([]);
  }

  const orgId = getOrgId(session);
  // Defensive cap — bring back nothing if someone pastes a novel.
  const needle = query.trim().slice(0, 80);
  const ci = { contains: needle, mode: "insensitive" as const };
  const take = 5;

  const session2 = session as { user: { id: string; accessLevel: string } };
  const me = session2.user.id;
  const myAccess = session2.user.accessLevel;
  const admin = isOrgAdminAccessLevel(myAccess);

  const [
    users,
    items,
    boards,
    spaces,
    folders,
    whiteboards,
    docs,
    sops,
    departments,
    meetings,
    okrs,
    ideas,
    policies,
    announcements,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [{ firstName: ci }, { lastName: ci }, { email: ci }],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      take,
    }),
    // Items (tasks) — over-fetch then gate by their board's read access.
    prisma.item.findMany({
      where: { organizationId: orgId, archivedAt: null, title: ci },
      select: {
        id: true, title: true, status: true, dueAt: true,
        board: { select: { id: true, slug: true, name: true, spaceId: true, folderId: true, visibility: true, ownerId: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: take * 4,
    }),
    prisma.board.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, slug: true, name: true, spaceId: true, folderId: true, visibility: true, ownerId: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.space.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, slug: true, name: true, visibility: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.folder.findMany({
      where: { organizationId: orgId, archivedAt: null, name: ci },
      select: {
        id: true, name: true, spaceId: true, visibility: true, ownerId: true,
        space: { select: { slug: true, visibility: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.whiteboard.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, name: true, spaceId: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    // Notes (Doc model). Over-fetch then access-gate so private notes
    // never bleed into another viewer's palette.
    prisma.doc.findMany({
      where: {
        organizationId: orgId,
        archivedAt: null,
        OR: [{ title: ci }, { excerpt: ci }],
      },
      select: {
        id: true, title: true, excerpt: true, content: true,
        entityType: true, entityId: true, updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.sOP.findMany({
      where: { organizationId: orgId, title: ci },
      select: { id: true, title: true, status: true, category: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.department.findMany({
      where: { organizationId: orgId, name: ci },
      select: { id: true, name: true, color: true },
      take: 3,
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId, title: ci },
      select: { id: true, title: true, type: true, scheduledAt: true },
      take: 3,
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { description: ci }] },
      select: { id: true, title: true, level: true, status: true, quarter: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.idea.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { description: ci }] },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.policy.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { content: ci }] },
      select: { id: true, title: true, category: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.announcement.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { content: ci }] },
      select: { id: true, title: true, type: true, priority: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  // ── Visibility gating ─────────────────────────────────────────────
  // Compute the viewer's readable Space set once, then reuse it to gate
  // every space-scoped kind. Admins read everything (visible = null,
  // never dereferenced because the readable() helpers short-circuit).
  const spaceIdSet = new Set<string>();
  for (const s of spaces) spaceIdSet.add(s.id);
  for (const b of boards) if (b.spaceId) spaceIdSet.add(b.spaceId);
  for (const f of folders) if (f.spaceId) spaceIdSet.add(f.spaceId);
  for (const it of items) if (it.board?.spaceId) spaceIdSet.add(it.board.spaceId);
  for (const w of whiteboards) if (w.spaceId) spaceIdSet.add(w.spaceId);

  const visible = admin ? null : await visibleSpaceIds([...spaceIdSet], me, myAccess);
  // Folders the viewer reaches via a folder grant (granted + descendants). This
  // admits their OWN folder's boards/subfolders WITHOUT treating them as a full
  // space reader — the leak the security review flagged on visibleSpaceIds.
  const accessibleFolders = admin ? new Set<string>() : await accessibleFolderIds(me);

  // PRIVATE boards additionally require a BoardMember row (or ownership).
  const privateBoardIds = new Set<string>();
  for (const b of boards) if (b.visibility === "PRIVATE") privateBoardIds.add(b.id);
  for (const it of items) if (it.board?.visibility === "PRIVATE") privateBoardIds.add(it.board.id);
  const privMemberIds = new Set<string>();
  if (!admin && privateBoardIds.size > 0) {
    const rows = await prisma.boardMember.findMany({
      where: { userId: me, boardId: { in: [...privateBoardIds] } },
      select: { boardId: true },
    });
    for (const r of rows) privMemberIds.add(r.boardId);
  }

  type BoardGate = { id: string; spaceId: string | null; folderId: string | null; visibility: string; ownerId: string | null };
  const boardReadable = (b: BoardGate | null | undefined): boolean => {
    if (!b) return false;
    if (admin) return true;
    if (b.visibility === "ORG") return true;
    if (b.visibility === "PRIVATE") return b.ownerId === me || privMemberIds.has(b.id);
    // WORKSPACE — unscoped boards are org-wide; scoped defer to Space access,
    // or to a folder grant when the board lives in a granted folder's subtree.
    if (!b.spaceId) return true;
    if (!!visible && visible.has(b.spaceId)) return true;
    return !!b.folderId && accessibleFolders.has(b.folderId);
  };
  const spaceVisibleById = (spaceId: string | null | undefined, vis?: string): boolean => {
    if (admin) return true;
    if (vis === "ORG") return true;
    return !!spaceId && !!visible && visible.has(spaceId);
  };

  // Drop notes the viewer can't read, then slice down to the per-kind cap.
  const docFlags = await Promise.all(docs.map((d) => docAccessible(d, me, myAccess)));
  const visibleDocs = docs.filter((_, i) => docFlags[i]).slice(0, take);

  const folderReadable = (f: (typeof folders)[number]): boolean => {
    if (admin) return true;
    // A direct grant (or one inherited from an ancestor) wins over visibility.
    if (accessibleFolders.has(f.id)) return true;
    if (f.visibility === "ORG") return true;
    if (f.visibility === "PRIVATE") return f.ownerId === me;
    // WORKSPACE — inherit the Space's access.
    return spaceVisibleById(f.spaceId, f.space?.visibility);
  };

  const visibleItems = items.filter((it) => boardReadable(it.board)).slice(0, take);
  const visibleBoards = boards.filter((b) => boardReadable(b)).slice(0, take);
  const visibleSpacesList = spaces.filter((s) => spaceVisibleById(s.id, s.visibility)).slice(0, take);
  const visibleFolders = folders.filter(folderReadable).slice(0, take);
  const visibleWhiteboards = whiteboards
    .filter((w) => admin || !w.spaceId || (!!visible && visible.has(w.spaceId)))
    .slice(0, take);

  const results = [
    ...visibleItems.map((it) => {
      const status = (it.status ?? "").replace(/_/g, " ").trim();
      const due = it.dueAt ? it.dueAt.toISOString().split("T")[0] : "";
      const subtitle = [status || "Task", due ? `due ${due}` : ""].filter(Boolean).join(" · ");
      return { type: "item" as const, id: it.id, title: it.title, subtitle, href: `/item/${it.id}` };
    }),
    ...visibleBoards.map((b) => ({
      type: "board" as const,
      id: b.id,
      title: b.name,
      subtitle: "List",
      href: `/boards/${b.slug}`,
    })),
    ...visibleSpacesList.map((s) => ({
      type: "space" as const,
      id: s.id,
      title: s.name,
      subtitle: "Space",
      href: `/spaces/${s.slug}`,
    })),
    ...visibleFolders.map((f) => ({
      type: "folder" as const,
      id: f.id,
      title: f.name,
      subtitle: "Folder",
      href: `/folders/${f.id}`,
    })),
    ...visibleDocs.map((d) => {
      const meta = (d.content as { meta?: { icon?: string } } | null)?.meta;
      return {
        type: "note" as const,
        id: d.id,
        title: d.title || "Untitled note",
        subtitle: d.excerpt ? d.excerpt.slice(0, 80) : (meta?.icon ? `${meta.icon} note` : "note"),
        href: `/docs/${d.id}`,
      };
    }),
    ...visibleWhiteboards.map((w) => ({
      type: "whiteboard" as const,
      id: w.id,
      title: w.name,
      subtitle: "Whiteboard",
      href: `/whiteboards/${w.id}`,
    })),
    ...users.map((u) => ({
      type: "person" as const,
      id: u.id,
      title: `${u.firstName} ${u.lastName}`.trim(),
      subtitle: u.email,
      href: `/people/${u.id}`,
    })),
    ...sops.map((s) => ({
      type: "sop" as const,
      id: s.id,
      title: s.title,
      subtitle: `${s.category || "Uncategorized"} · ${s.status}`,
      href: `/sops/${s.id}`,
    })),
    ...okrs.map((o) => ({
      type: "okr" as const,
      id: o.id,
      title: o.title,
      subtitle: `${o.level} · ${o.quarter ?? "—"} · ${o.status}`,
      href: `/okrs/${o.id}`,
    })),
    ...meetings.map((m) => ({
      type: "meeting" as const,
      id: m.id,
      title: m.title,
      subtitle: m.type.replace(/_/g, " "),
      href: `/meetings/${m.id}`,
    })),
    ...departments.map((d) => ({
      type: "department" as const,
      id: d.id,
      title: d.name,
      subtitle: "Department",
      href: `/organization#${d.id}`,
    })),
    ...ideas.map((i) => ({
      type: "idea" as const,
      id: i.id,
      title: i.title,
      subtitle: i.status,
      href: `/ideas#${i.id}`,
    })),
    ...policies.map((p) => ({
      type: "policy" as const,
      id: p.id,
      title: p.title,
      subtitle: `${p.category ?? "—"} · ${p.status}`,
      href: `/policies#${p.id}`,
    })),
    ...announcements.map((a) => ({
      type: "announcement" as const,
      id: a.id,
      title: a.title,
      subtitle: `${a.type} · ${a.priority}`,
      href: `/announcements#${a.id}`,
    })),
  ];

  return jsonSuccess(results);
}
