import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonSuccess } from "@/lib/api-helpers";
import { isOrgAdminAccessLevel } from "@/lib/space";
import { isModuleActive } from "@/lib/entitlements";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { refKey, roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import { addressHref } from "@/lib/nav/object-href";
import { getUserTagIds } from "@/lib/user-tags";
import { announcementInFeed } from "@/lib/announcement-view";
import { sopVisibilityWhere } from "@/lib/sop-access";
import { goalVisibilityOr } from "@/lib/goal-audience";
import {
  parseAnnouncementAudience,
  viewerInAnnouncementAudience,
  viewerSpaceIds as announcementViewerSpaceIds,
} from "@/lib/announcement-audience";

/**
 * Unified entity search across the product. Powers the Cmd-K palette's
 * live-results section — typing a phrase searches the real work graph in
 * parallel and surfaces a flat ranked list.
 *
 * Scope policy:
 *   · Every query is org-scoped (no cross-tenant leaks).
 *   · Every Space, Folder, List, task, doc, canvas, table and form is gated
 *     through ONE node-access world (src/lib/access/node-access.ts), the
 *     same answer each object's own page gives: a task by its List's role or
 *     by being assigned to it, everything else by its own role. Nothing the
 *     viewer cannot open is ever named here (admins see everything).
 *   · Doc, canvas, table, form and SOP results link the Work door
 *     (/work/<kind>/<id>), which places each one under the viewer's own
 *     access (its Space when they can see its path).
 *   · Per-kind cap so a long-prefix query that matches 200 items and 0
 *     boards still feels instant. Defaults to 5 per kind.
 *   · Empty / too-short queries return an empty array (cheap).
 *
 * This searches the ACTUAL work graph — Item (tasks), Board (lists),
 * Space, Folder, Doc (notes), Whiteboard, and people — plus the alignment
 * + org surfaces that still have live routes (SOP, OKR, meeting,
 * department, idea, policy, announcement), and, while the Tables module is
 * on, tables (DataTable) and forms (FormDefinition), which the palette shows
 * as its Tables and Forms groups (spec-tables-forms section 2). It
 * deliberately does NOT search
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

  // Tables ride the Tables module (workwrk-tables): with it off they are not
  // searched, like every /api/tables* route. Forms are CORE (founder decision
  // D15: forms-gate.tsx and /api/forms* carry no module check), so they are
  // searched whether the module is on or off. A Guest finds only the forms
  // and tables they made or were given: the resolver's answer below.
  const tablesOn = await isModuleActive(orgId, "workwrk-tables").catch(() => false);

  // SOPs, goals, meetings and policies carry their own read rules, so a title
  // the viewer could not open on its own page is never named here: the SOP
  // list's (sopVisibilityWhere), the Goals list's (goalVisibilityOr), the
  // meeting page's (meetingRole: its creator, an attendee or an org admin,
  // and never a deleted meeting) and the policy page's (a manager, else a
  // PUBLISHED policy or one assigned to the viewer). Before, search matched
  // every one of them in the workspace, drafts and one to ones included.
  const [sopVisible, goalVisible] = await Promise.all([sopVisibilityWhere(session), goalVisibilityOr(session)]);

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
    dataTables,
    forms,
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
        id: true, title: true, status: true, dueAt: true, boardId: true, ownerId: true, assigneeIds: true,
      },
      orderBy: { updatedAt: "desc" },
      take: take * 4,
    }),
    prisma.board.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, slug: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.space.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, slug: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.folder.findMany({
      where: { organizationId: orgId, archivedAt: null, name: ci },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.whiteboard.findMany({
      where: { organizationId: orgId, archivedAt: null, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, name: true },
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
      select: { id: true, title: true, excerpt: true, content: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
    prisma.sOP.findMany({
      where: { AND: [{ organizationId: orgId, title: ci }, sopVisible] },
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
      where: { organizationId: orgId, title: ci, deletedAt: null, ...(admin ? {} : { OR: [{ createdById: me }, { attendees: { some: { userId: me } } }] }) },
      select: { id: true, title: true, type: true, scheduledAt: true },
      take: 3,
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { description: ci }], ...(goalVisible ? { AND: [{ OR: goalVisible }] } : {}) },
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
      where: { organizationId: orgId, OR: [{ title: ci }, { content: ci }], ...(isManager(session) ? {} : { AND: [{ OR: [{ status: "PUBLISHED" }, { assignments: { some: { userId: me } } }] }] }) },
      select: { id: true, title: true, category: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    // The select carries the four fields the audience and lifecycle gate
    // below needs. Without them this query returned every announcement in
    // the org, and the gate could not have been written.
    prisma.announcement.findMany({
      where: { organizationId: orgId, OR: [{ title: ci }, { content: ci }] },
      select: {
        id: true, title: true, type: true, priority: true,
        authorId: true, targetAudience: true, publishedAt: true, expiresAt: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    tablesOn
      ? prisma.dataTable.findMany({
          where: { organizationId: orgId, OR: [{ name: ci }, { description: ci }] },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
          take: take * 3,
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    prisma.formDefinition.findMany({
      where: { organizationId: orgId, OR: [{ name: ci }, { description: ci }] },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: take * 3,
    }),
  ]);

  // ── Visibility gating ─────────────────────────────────────────────
  // ONE world for every candidate of every kind (never a gate call per row):
  // the task's List, and each object itself.
  const nodeCtx = nodeCtxFromLevel(me, orgId, myAccess);
  const refs: NodeRef[] = [
    ...items.map((it) => ({ kind: "list" as const, id: it.boardId })),
    ...boards.map((b) => ({ kind: "list" as const, id: b.id })),
    ...spaces.map((sp) => ({ kind: "space" as const, id: sp.id })),
    ...folders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...whiteboards.map((w) => ({ kind: "canvas" as const, id: w.id })),
    ...docs.map((d) => ({ kind: "doc" as const, id: d.id })),
    ...dataTables.map((t) => ({ kind: "table" as const, id: t.id })),
    ...forms.map((f) => ({ kind: "form" as const, id: f.id })),
  ];
  const decisions = await nodeRoles(nodeCtx, refs);
  const opens = (ref: NodeRef) => roleAtLeast(decisions.get(refKey(ref))?.role ?? "none", "VIEW");

  // ── Announcements: audience and lifecycle ─────────────────────────
  //
  // This kind was NOT gated. The query above asked only for
  // `organizationId`, so search returned the TITLE of every announcement in
  // the workspace to any signed-in member: posts scheduled for a future
  // date, and posts addressed to a department, office, tag, Space or named
  // user list the reader is not in. A title is often the whole of the
  // sensitive part ("Redundancies in Support", "Q3 pay review outcome").
  //
  // The rule itself lives in announcementInFeed (src/lib/announcement-view.ts)
  // and the list route reads the same function, so the two surfaces cannot
  // drift apart again. All this route does is resolve the audience, which
  // needs the database, and hand it over.
  const annAudienceTypes = announcements.map((a) => parseAnnouncementAudience(a.targetAudience).type);
  const [annViewer, annTagIds, annSpaceIds] = await Promise.all([
    announcements.length > 0
      ? prisma.user.findUnique({ where: { id: me }, select: { id: true, departmentId: true, officeId: true } })
      : Promise.resolve(null),
    annAudienceTypes.includes("TAGS") ? getUserTagIds(orgId, me) : Promise.resolve<string[]>([]),
    annAudienceTypes.includes("SPACE") ? announcementViewerSpaceIds(orgId, me) : Promise.resolve<string[]>([]),
  ]);
  const annNow = Date.now();
  const readableAnnouncements = announcements.filter((a) =>
    announcementInFeed(a, {
      viewerId: me,
      oversight: admin,
      inAudience:
        Boolean(annViewer) &&
        viewerInAnnouncementAudience(parseAnnouncementAudience(a.targetAudience), annViewer!, annTagIds, annSpaceIds),
      now: annNow,
    }),
  );
  // A task opens for a reader of its List, and for the person it is
  // assigned to or owned by (the assignment grant), exactly as its page does.
  const visibleItems = items
    .filter((it) => opens({ kind: "list", id: it.boardId }) || it.ownerId === me || it.assigneeIds.includes(me))
    .slice(0, take);
  const visibleBoards = boards.filter((b) => opens({ kind: "list", id: b.id })).slice(0, take);
  const visibleSpacesList = spaces.filter((sp) => opens({ kind: "space", id: sp.id })).slice(0, take);
  const visibleFolders = folders.filter((f) => opens({ kind: "folder", id: f.id })).slice(0, take);
  const visibleWhiteboards = whiteboards.filter((w) => opens({ kind: "canvas", id: w.id })).slice(0, take);
  const visibleDocs = docs.filter((d) => opens({ kind: "doc", id: d.id })).slice(0, take);
  const visibleTables = dataTables.filter((t) => opens({ kind: "table", id: t.id })).slice(0, take);
  const visibleForms = forms.filter((f) => opens({ kind: "form", id: f.id })).slice(0, take);
  const door = (kind: "doc" | "canvas" | "table" | "form" | "sop", id: string) => addressHref(kind, id, { scope: "work" });

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
        href: door("doc", d.id),
      };
    }),
    ...visibleWhiteboards.map((w) => ({
      type: "whiteboard" as const,
      id: w.id,
      title: w.name,
      subtitle: "Canvas",
      href: door("canvas", w.id),
    })),
    ...visibleTables.map((t) => ({
      type: "table" as const,
      id: t.id,
      title: t.name || "Untitled table",
      subtitle: "Table",
      href: door("table", t.id),
    })),
    ...visibleForms.map((f) => ({
      type: "form" as const,
      id: f.id,
      title: f.name || "Untitled form",
      subtitle: "Form",
      href: door("form", f.id),
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
      href: door("sop", s.id),
    })),
    ...okrs.map((o) => ({
      type: "okr" as const,
      id: o.id,
      title: o.title,
      subtitle: [o.level, o.quarter, o.status].filter(Boolean).join(" · "),
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
      subtitle: [p.category, p.status].filter(Boolean).join(" · "),
      href: `/policies#${p.id}`,
    })),
    ...readableAnnouncements.map((a) => ({
      type: "announcement" as const,
      id: a.id,
      title: a.title,
      subtitle: `${a.type} · ${a.priority}`,
      href: `/announcements#${a.id}`,
    })),
  ];

  return jsonSuccess(results);
}
