// Dimensional tag management. Server-renders the initial list
// grouped by type; the client component handles create/rename/
// archive/delete. Page is admin-only (see layout.tsx).

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TagsManager, type TagRow } from "./tags-manager";

export const dynamic = "force-dynamic";

export default async function SettingsTagsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const orgId = (session.user as { organizationId: string }).organizationId;

  const rows = await prisma.tag.findMany({
    where: { organizationId: orgId },
    orderBy: [{ archived: "asc" }, { type: "asc" }, { name: "asc" }],
    take: 1000,
    select: {
      id: true,
      name: true,
      type: true,
      color: true,
      description: true,
      archived: true,
      _count: { select: { assignments: true } },
    },
  });

  const initial: TagRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    color: r.color,
    description: r.description,
    archived: r.archived,
    assignmentCount: r._count.assignments,
  }));

  return <TagsManager initial={initial} />;
}
