// /spaces: every Space you are in, and the door to a new one.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/spaces`.
//
// This is the naming, tokens and create-door pass, not the full rebuild the
// spec describes. What it fixes:
//   * the copy said "Your team's grouping of Folders and Boards" and each card
//     counted "3 boards". The object is a List (naming canon);
//   * the glyph was a generic `Layers` for every Space, throwing away the icon
//     and colour the Space actually has, and the globe / lock vocabulary
//     (access section 6.1) was not used at all;
//   * there was no way to create a Space from the page that lists them
//     (audit Low #30). The one primary is here now, for the people the API
//     lets create one;
//   * the hover star is replaced by the row's "…", which is where Favorite
//     lives on every other container surface (the star's destination is the
//     menu's first row, so nothing is lost).
// Still to come per the spec: search, sort, filter, the Archived pill, the
// findable-Spaces section, the List view and the real AvatarStack.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listSpacesForUser } from "@/lib/space";
import Link from "next/link";
import { Globe } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { ContainerMenuTrigger } from "@/components/layout/os/container-menu";
import { NewSpaceButton } from "./new-space-button";
import { canAccessTier } from "@/components/layout/os/access-tiers";

export const dynamic = "force-dynamic";

export default async function SpacesIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const spaces = await listSpacesForUser(u.id, u.organizationId, {
    accessLevel: u.accessLevel,
    includeFolderContainers: true,
  });
  // The same gate `POST /api/spaces` applies (MANAGER_LEVELS), so the button
  // never renders for someone the route would 403.
  const canCreateSpace = canAccessTier("manager", u.accessLevel ?? null);

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Spaces</h1>
          <p className="text-base text-ink-2 mt-1">
            A Space is a team&rsquo;s room. It holds Folders, Lists, Docs and Canvases.
          </p>
        </div>
        {canCreateSpace ? <NewSpaceButton /> : null}
      </header>

      {spaces.length === 0 ? (
        <div className="border border-line rounded-xl px-8 py-16 text-center">
          <div className="text-base font-medium text-ink mb-1">No Spaces yet</div>
          <p className="text-base text-ink-2 max-w-[420px] mx-auto">
            {canCreateSpace
              ? "Create one and it appears in your sidebar."
              : "Ask an admin to add you to one."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {spaces.map((s) => (
            <li key={s.id}>
              <div className="relative rounded-lg border border-line bg-raised p-4 hover:bg-hover transition-colors group/space">
                <Link href={`/spaces/${s.slug}`} className="block">
                  <div className="flex items-center gap-2 mb-1 pe-8">
                    <EntityTile size="md" icon={s.icon} color={s.color} name={s.name} />
                    <span className="font-medium text-base text-ink truncate">{s.name}</span>
                    {/* access section 6.1's two glyphs and no third: a globe
                        means everyone at the org, a lock means Restricted. A
                        Space is never Restricted, so a Space the viewer can
                        open never carries the lock (spec section 1, Glyph
                        vocabulary): it used to, which made a third meaning. */}
                    {s.visibility === "ORG" ? (
                      <Globe className="w-3 h-3 text-ink-3 shrink-0" aria-label="Everyone at this organisation" />
                    ) : null}
                  </div>
                  {s.description ? (
                    <p className="text-base text-ink-2 line-clamp-2">{s.description}</p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3 text-xs text-ink-2">
                    <span>{s.boardCount} list{s.boardCount === 1 ? "" : "s"}</span>
                    <span>{s.folderCount} folder{s.folderCount === 1 ? "" : "s"}</span>
                    <span>{s.memberCount} member{s.memberCount === 1 ? "" : "s"}</span>
                  </div>
                </Link>
                <div className="absolute top-3 end-3 opacity-0 group-hover/space:opacity-100 focus-within:opacity-100 transition-opacity">
                  <ContainerMenuTrigger
                    container={{
                      kind: "space",
                      id: s.id,
                      slug: s.slug,
                      name: s.name,
                      icon: s.icon,
                      color: s.color,
                      visibility: s.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
                      description: s.description,
                      spaceId: s.id,
                      spaceSlug: s.slug,
                      spaceName: s.name,
                      contents: `${s.boardCount} lists · ${s.folderCount} folders · ${s.memberCount} members`,
                    }}
                    role={s.role}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
