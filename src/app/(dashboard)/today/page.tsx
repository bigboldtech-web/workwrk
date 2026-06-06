// Home — server redirect to the viewer's first Space (Overview tab).
//
// ClickUp-parity (Phase A, slice 1a, 2026-06-05). The previous workspace-
// shell-with-tabs UI was off-spec and removed. "First Space" = the
// readable Space with the earliest createdAt.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrgAdminAccessLevel } from "@/lib/space";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const isAdmin = isOrgAdminAccessLevel(u.accessLevel);
  const where = isAdmin
    ? { organizationId: u.organizationId, archivedAt: null }
    : {
        organizationId: u.organizationId,
        archivedAt: null,
        OR: [
          { visibility: "ORG" as const },
          { members: { some: { userId: u.id } } },
        ],
      };

  const first = await prisma.space.findFirst({
    where,
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });

  if (first?.slug) redirect(`/spaces/${first.slug}`);
  redirect("/spaces");
}
