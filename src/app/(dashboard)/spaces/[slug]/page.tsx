// Space detail — Phase 2 stub. Resolves a Space by slug, shows its
// header (name, description, member count) and a placeholder for
// Folders + Boards. Phase 3 fleshes this out with the view picker
// and the actual board grid.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Layers, Lock, Users as UsersIcon } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SpacePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const space = await prisma.space.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      _count: { select: { members: true, folders: true, boards: true } },
      folders: { where: { archivedAt: null, parentFolderId: null }, orderBy: { position: "asc" } },
      boards: { where: { archivedAt: null, folderId: null }, orderBy: { name: "asc" } },
    },
  });
  if (!space) notFound();

  // Visibility check (lightweight; Phase 6 will centralize this).
  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  if (!isAdmin && space.visibility !== "ORG") {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: space.id, userId: u.id } },
      select: { id: true },
    });
    if (!member) notFound();
  }

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-sm text-muted mb-2">
          <Link href="/spaces" className="hover:text-foreground">Spaces</Link>
          <span>/</span>
          <span>{space.name}</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-3">
          {space.visibility === "PRIVATE" ? (
            <Lock className="w-5 h-5 text-muted" />
          ) : (
            <Layers className="w-5 h-5 text-muted" />
          )}
          {space.name}
        </h1>
        {space.description ? (
          <p className="text-sm text-muted mt-2 max-w-[640px]">{space.description}</p>
        ) : null}
        <div className="mt-3 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <UsersIcon className="w-3.5 h-3.5" />
            {space._count.members} member{space._count.members === 1 ? "" : "s"}
          </span>
          <span>{space._count.folders} folder{space._count.folders === 1 ? "" : "s"}</span>
          <span>{space._count.boards} board{space._count.boards === 1 ? "" : "s"}</span>
        </div>
      </header>

      {space.folders.length === 0 && space.boards.length === 0 ? (
        <div className="border border-border rounded-xl px-8 py-16 text-center">
          <div className="text-base font-medium mb-1">This Space is empty</div>
          <p className="text-sm text-muted max-w-[420px] mx-auto">
            Add a Folder to group related work, or create your first Board to start tracking items.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {space.folders.length > 0 ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Folders</h2>
              <ul className="space-y-1">
                {space.folders.map((f) => (
                  <li key={f.id} className="px-3 py-2 rounded-md border border-border bg-surface text-sm">
                    {f.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {space.boards.length > 0 ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Boards</h2>
              <ul className="space-y-1">
                {space.boards.map((b) => (
                  <li key={b.id} className="px-3 py-2 rounded-md border border-border bg-surface text-sm">
                    {b.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
