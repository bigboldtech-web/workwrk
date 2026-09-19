// /favorites: everything you have starred, in one list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/favorites).
//
// WHAT THIS REPLACES. The route existed but held somebody else's content: a
// pinboard of pinned Sidekick chats, under a page title that said "Favorites".
// So the Work sidebar's FAVORITES section could read "FAVORITES 1" while the
// page its own "See all favorites" row led to said "No favorites yet. Star a
// chat or a board item" and offered a blue "Open Sidekick" link, in the AI hub,
// with the Work sidebar gone.
//
// NOTHING DISAPPEARS. The pinned and recent Sidekick chats this page used to
// list are every session `GET /api/sidekick/sessions` returns, and /sidekick
// renders that same list in its own history sidebar with a pin glyph on the
// pinned ones. So both halves keep a door; this page stops being their door
// and becomes the one the seven star buttons across the product point at.
//
// The server half is the gate and nothing else: one client fetch of
// `GET /api/me/favorites` (built in this phase and, until now, called by
// nobody) answers all seven kinds at once.

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";
import { getEffectivePreferences } from "@/lib/preferences";
import { FavoritesClient } from "./favorites-client";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  // The one Work-hub app key (access section 5.2.1 `home`), then the page's
  // own rule: a Guest's `home` row grants My work and Inbox only, so this is
  // the shell's in-frame 404 for them and the FAVORITES section does not
  // render in their sidebar either. No row leads anywhere that 404s.
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/favorites" });
  if (viewer.orgRole === "GUEST") notFound();

  const prefs = await getEffectivePreferences(viewer.userId, viewer.organizationId).catch(() => null);
  const work = (prefs?.home?.work ?? {}) as { surface?: Record<string, unknown> };
  const view = (work.surface?.favorites ?? {}) as { viewOptions?: { location?: unknown; starred?: unknown } };

  return (
    <FavoritesClient
      initialShowLocation={view.viewOptions?.location !== false}
      initialShowStarred={view.viewOptions?.starred !== false}
    />
  );
}
