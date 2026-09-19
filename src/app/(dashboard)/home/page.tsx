// /home: the Work hub's landing.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home). It replaces
// three pages at once:
//
//   /today      a server component that redirected you into your first Space.
//               Somebody else's project list is not a personal landing.
//   /dashboard  a redirect to /today over a dead 653-line tree.
//   /tasks      the "My Wrk" card grid: eleven cards, four of which fetched
//               anything and seven of which rendered hard-coded sentences,
//               with around fifteen buttons that did nothing at all.
//
// What survives from that grid is what was real: Assigned to me became the My
// work widget, Goals became My goals, and the KRAs and KPIs card's number
// became the Weekly review widget's second row. Nothing that had data lost its
// home; everything that had no data is gone.
//
// This file is the server half, and it is thin on purpose: the page needs the
// viewer and their stored widget choice before it can paint, and everything
// after that is one client fetch of `GET /api/me/home`.

import { gatePage } from "@/lib/access/gate";
import { getEffectivePreferences } from "@/lib/preferences";
import { readHomeWidgets, visibleHomeWidgets, type HomeWidgetKey } from "@/lib/home-prefs";
import { HomeClient } from "./home-client";

export const dynamic = "force-dynamic";

/**
 * The stored preferences, or null when we genuinely could not read them.
 *
 * Two attempts, because one transient failure should not decide somebody's
 * layout; null is then an honest "we do not know", which the client turns into
 * one more attempt of its own rather than a layout nobody picked.
 */
async function readPreferencesTwice(userId: string, organizationId: string) {
  const first = await getEffectivePreferences(userId, organizationId).catch(() => null);
  if (first) return first;
  return getEffectivePreferences(userId, organizationId).catch(() => null);
}

export default async function HomePage() {
  // Every Work-hub page gates on the ONE app key that exists for the hub
  // (access section 5.2.1 `home`), then applies its own scoping. Home never
  // denies: the row is granted to everyone signed in, Guests included, it is
  // WHICH widgets they get that their role decides.
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/home" });

  // A FAILED PREFERENCE READ IS NOT A CHOICE. `.catch(() => null)` alone made
  // an unreadable preference render the default six widgets, quietly
  // overriding a person's stored two. The read is retried once, and when it
  // still fails the client is told so and re-asks `/api/preferences` itself
  // rather than painting a layout nobody picked.
  const prefs = await readPreferencesTwice(viewer.userId, viewer.organizationId);
  const prefsFailed = prefs === null;
  const surface = (prefs?.home?.work as { surface?: Record<string, unknown> } | undefined)?.surface;
  const homeSurface = (surface?.home as { viewOptions?: { widgets?: unknown } } | undefined)?.viewOptions;

  // The one-time read of the retired key. `home.taskCardsHidden` was a HIDDEN
  // list over the old grid; three of its names map onto a widget that still
  // exists and the rest named stub cards. Inverting it once means a person who
  // hid the Goals card does not find it back on their first visit here.
  // `home.cards` is deliberately NOT read: that key belongs to the Work
  // sidebar (settings-architecture section 4.2), and one array that means both
  // "which sidebar rows" and "which Home widgets" can only ever be set wrong.
  const chosen = readHomeWidgets(homeSurface?.widgets, prefs?.home?.taskCardsHidden) as HomeWidgetKey[];
  const isGuest = viewer.orgRole === "GUEST";
  const widgets = visibleHomeWidgets(chosen, isGuest);

  return <HomeClient initialWidgets={widgets} isGuest={isGuest} widgetsUnknown={prefsFailed} />;
}
