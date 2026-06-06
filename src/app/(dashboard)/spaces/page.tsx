// Spaces index — Phase 2 stub. Lists all Spaces the viewer can see.
// Phase 2/3 will fold this into a richer "all spaces" gallery view.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listSpacesForUser } from "@/lib/space";
import { getEffectivePreferences } from "@/lib/preferences";
import Link from "next/link";
import { Layers, Lock, Plus } from "lucide-react";
import { SpaceFavoriteButton } from "@/components/layout/os/space-favorite-button";

export const dynamic = "force-dynamic";

export default async function SpacesIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const [spaces, prefs] = await Promise.all([
    listSpacesForUser(u.id, u.organizationId, { accessLevel: u.accessLevel }),
    getEffectivePreferences(u.id, u.organizationId),
  ]);
  const starredIds = new Set(prefs?.home?.favoriteSpaceIds ?? []);

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spaces</h1>
          <p className="text-sm text-zinc-500 mt-1">Your team's grouping of Folders and Boards.</p>
        </div>
      </header>

      {spaces.length === 0 ? (
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center">
          <div className="text-base font-medium mb-1">No Spaces yet</div>
          <p className="text-sm text-zinc-500 max-w-[420px] mx-auto mb-4">
            Spaces hold Folders and Boards for a team. Create one from the sidebar's "+" button next to Spaces.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {spaces.map((s) => (
            <li key={s.id}>
              <div className="relative px-4 py-3 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 group/space">
                <Link href={`/spaces/${s.slug}`} className="block">
                  <div className="flex items-center gap-2 mb-1 pr-7">
                    {s.visibility === "PRIVATE" ? (
                      <Lock className="w-4 h-4 text-zinc-500" />
                    ) : (
                      <Layers className="w-4 h-4 text-zinc-500" />
                    )}
                    <span className="font-medium text-sm truncate">{s.name}</span>
                  </div>
                  {s.description ? (
                    <p className="text-xs text-zinc-500 line-clamp-2">{s.description}</p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                    <span>{s.memberCount} member{s.memberCount === 1 ? "" : "s"}</span>
                    <span>{s.folderCount} folder{s.folderCount === 1 ? "" : "s"}</span>
                    <span>{s.boardCount} board{s.boardCount === 1 ? "" : "s"}</span>
                  </div>
                </Link>
                <div className="absolute top-2 right-2 opacity-0 group-hover/space:opacity-100 transition-opacity">
                  <SpaceFavoriteButton spaceId={s.id} initiallyStarred={starredIds.has(s.id)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
