import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || query.length < 2) {
    return jsonSuccess([]);
  }

  const orgId = getOrgId(session);
  const searchTerm = query.toLowerCase();

  // Search across multiple entities in parallel
  const [users, tasks, sops, departments, meetings] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { firstName: { contains: searchTerm, mode: "insensitive" } },
          { lastName: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      take: 5,
    }),
    prisma.task.findMany({
      where: {
        organizationId: orgId,
        title: { contains: searchTerm, mode: "insensitive" },
      },
      select: { id: true, title: true, status: true, priority: true },
      take: 5,
    }),
    prisma.sOP.findMany({
      where: {
        organizationId: orgId,
        title: { contains: searchTerm, mode: "insensitive" },
      },
      select: { id: true, title: true, status: true, category: true },
      take: 5,
    }),
    prisma.department.findMany({
      where: {
        organizationId: orgId,
        name: { contains: searchTerm, mode: "insensitive" },
      },
      select: { id: true, name: true, color: true },
      take: 3,
    }),
    prisma.meeting.findMany({
      where: {
        organizationId: orgId,
        title: { contains: searchTerm, mode: "insensitive" },
      },
      select: { id: true, title: true, type: true, scheduledAt: true },
      take: 3,
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
      subtitle: `${t.priority} · ${t.status.replace(/_/g, " ")}`,
      href: `/tasks/${t.id}`,
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
      href: `/organization`,
    })),
    ...meetings.map((m) => ({
      type: "meeting" as const,
      id: m.id,
      title: m.title,
      subtitle: m.type.replace(/_/g, " "),
      href: `/meetings`,
    })),
  ];

  return jsonSuccess(results);
}
