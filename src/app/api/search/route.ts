import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";

/**
 * Unified entity search across the product. Powers the Cmd-K palette's
 * live-results section — typing a phrase searches every major entity
 * in parallel and surfaces a flat ranked list.
 *
 * Scope policy:
 *   · Every query is org-scoped (no cross-tenant leaks).
 *   · Per-kind cap so a long-prefix query that matches 200 SOPs and 0
 *     tasks still feels instant. Defaults to 5 per kind.
 *   · Empty / too-short queries return an empty array (cheap).
 *
 * Result shape is intentionally a flat array (not grouped) so the
 * palette can render with cmdk's native value-prefix matching.
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

  const [
    users,
    tasks,
    sops,
    departments,
    meetings,
    okrs,
    ideas,
    expenses,
    vendors,
    pos,
    jobs,
    candidates,
    policies,
    announcements,
    glAccounts,
    plans,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [
          { firstName: ci },
          { lastName: ci },
          { email: ci },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      take,
    }),
    prisma.task.findMany({
      where: { organizationId: orgId, title: ci },
      select: { id: true, title: true, status: true, date: true },
      orderBy: { date: "desc" },
      take,
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
      where: {
        organizationId: orgId,
        OR: [{ title: ci }, { description: ci }],
      },
      select: { id: true, title: true, level: true, status: true, quarter: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.idea.findMany({
      where: {
        organizationId: orgId,
        OR: [{ title: ci }, { description: ci }],
      },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.expense.findMany({
      where: { organizationId: orgId, description: ci },
      select: { id: true, description: true, amount: true, status: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.vendor.findMany({
      where: { organizationId: orgId, name: ci, archived: false },
      select: { id: true, name: true, email: true },
      take,
    }),
    prisma.purchaseOrder.findMany({
      where: {
        organizationId: orgId,
        OR: [{ description: ci }, { number: ci }],
      },
      select: { id: true, number: true, description: true, status: true, amount: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.job.findMany({
      where: {
        organizationId: orgId,
        OR: [{ title: ci }, { description: ci }],
      },
      select: { id: true, title: true, status: true, department: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        OR: [{ firstName: ci }, { lastName: ci }, { email: ci }],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.policy.findMany({
      where: {
        organizationId: orgId,
        OR: [{ title: ci }, { content: ci }],
      },
      select: { id: true, title: true, category: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.announcement.findMany({
      where: {
        organizationId: orgId,
        OR: [{ title: ci }, { content: ci }],
      },
      select: { id: true, title: true, type: true, priority: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.glAccount.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: [{ code: ci }, { name: ci }],
      },
      select: { id: true, code: true, name: true, type: true },
      take,
    }),
    prisma.budgetPlan.findMany({
      where: { organizationId: orgId, name: ci },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
  ]);

  const results = [
    ...users.map((u) => ({
      type: "person" as const,
      id: u.id,
      title: `${u.firstName} ${u.lastName}`,
      subtitle: u.email,
      href: `/people/${u.id}`,
    })),
    ...tasks.map((t) => ({
      type: "task" as const,
      id: t.id,
      title: t.title,
      subtitle: `${t.status.replace(/_/g, " ")} · ${t.date.toISOString().split("T")[0]}`,
      href: `/tasks#${t.id}`,
    })),
    ...sops.map((s) => ({
      type: "sop" as const,
      id: s.id,
      title: s.title,
      subtitle: `${s.category || "Uncategorized"} · ${s.status}`,
      href: `/sops/${s.id}`,
    })),
    ...departments.map((d) => ({
      type: "department" as const,
      id: d.id,
      title: d.name,
      subtitle: "Department",
      href: `/organization#${d.id}`,
    })),
    ...meetings.map((m) => ({
      type: "meeting" as const,
      id: m.id,
      title: m.title,
      subtitle: m.type.replace(/_/g, " "),
      href: `/meetings/${m.id}`,
    })),
    ...okrs.map((o) => ({
      type: "okr" as const,
      id: o.id,
      title: o.title,
      subtitle: `${o.level} · ${o.quarter ?? "—"} · ${o.status}`,
      href: `/okrs/${o.id}`,
    })),
    ...ideas.map((i) => ({
      type: "idea" as const,
      id: i.id,
      title: i.title,
      subtitle: i.status,
      href: `/ideas#${i.id}`,
    })),
    ...expenses.map((e) => ({
      type: "expense" as const,
      id: e.id,
      title: e.description || "Expense",
      subtitle: `${e.amount} · ${e.status}`,
      href: `/expenses/${e.id}`,
    })),
    ...vendors.map((v) => ({
      type: "vendor" as const,
      id: v.id,
      title: v.name,
      subtitle: v.email ?? "Vendor",
      href: `/procurement?tab=vendors#${v.id}`,
    })),
    ...pos.map((p) => ({
      type: "po" as const,
      id: p.id,
      title: `${p.number} — ${p.description}`.slice(0, 80),
      subtitle: `${p.status} · ${p.amount}`,
      href: `/procurement?tab=pos#${p.id}`,
    })),
    ...jobs.map((j) => ({
      type: "job" as const,
      id: j.id,
      title: j.title,
      subtitle: `${j.status}${j.department?.name ? ` · ${j.department.name}` : ""}`,
      href: `/recruiting?tab=jobs#${j.id}`,
    })),
    ...candidates.map((c) => ({
      type: "candidate" as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName}`,
      subtitle: c.email,
      href: `/recruiting?tab=candidates#${c.id}`,
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
    ...glAccounts.map((g) => ({
      type: "glAccount" as const,
      id: g.id,
      title: `${g.code} — ${g.name}`,
      subtitle: g.type,
      href: `/financials?tab=accounts#${g.id}`,
    })),
    ...plans.map((p) => ({
      type: "plan" as const,
      id: p.id,
      title: p.name,
      subtitle: `${p.type} · ${p.status}`,
      href: `/planning/${p.id}`,
    })),
  ];

  return jsonSuccess(results);
}
