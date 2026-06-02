// Spaces index — Phase 2 stub. Lists all Spaces the viewer can see.
// Phase 2/3 will fold this into a richer "all spaces" gallery view.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listSpacesForUser } from "@/lib/space";
import Link from "next/link";
import { Layers, Lock, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SpacesIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const spaces = await listSpacesForUser(u.id, u.organizationId, { accessLevel: u.accessLevel });

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spaces</h1>
          <p className="text-sm text-muted mt-1">Your team's grouping of Folders and Boards.</p>
        </div>
      </header>

      {spaces.length === 0 ? (
        <div className="border border-border rounded-xl px-8 py-16 text-center">
          <div className="text-base font-medium mb-1">No Spaces yet</div>
          <p className="text-sm text-muted max-w-[420px] mx-auto mb-4">
            Spaces hold Folders and Boards for a team. Create one from the sidebar's "+" button next to Spaces.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {spaces.map((s) => (
            <li key={s.id}>
              <Link
                href={`/spaces/${s.slug}`}
                className="block px-4 py-3 rounded-lg border border-border bg-surface hover:bg-surface-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  {s.visibility === "PRIVATE" ? (
                    <Lock className="w-4 h-4 text-muted" />
                  ) : (
                    <Layers className="w-4 h-4 text-muted" />
                  )}
                  <span className="font-medium text-sm">{s.name}</span>
                </div>
                {s.description ? (
                  <p className="text-xs text-muted line-clamp-2">{s.description}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                  <span>{s.memberCount} member{s.memberCount === 1 ? "" : "s"}</span>
                  <span>{s.folderCount} folder{s.folderCount === 1 ? "" : "s"}</span>
                  <span>{s.boardCount} board{s.boardCount === 1 ? "" : "s"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
