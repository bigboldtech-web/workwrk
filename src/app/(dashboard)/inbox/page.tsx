// /inbox: everything that needs your attention, with the thing itself open
// beside the list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox).
//
// The server half: the gate, the viewer's stored Inbox options, and the id so
// the pane can render a task without a second round trip for "who am I".

import { gatePage } from "@/lib/access/gate";
import { getEffectivePreferences } from "@/lib/preferences";
import { InboxClient, type InboxOptions } from "./inbox-client";

export const dynamic = "force-dynamic";

const DEFAULTS: InboxOptions = {
  groupByDate: true,
  showAll: false,
  sortNewest: true,
  autoClearDays: null,
  defaultTab: "primary",
};

export default async function InboxPage() {
  // Everyone signed in has an Inbox, Guests included, what differs is which
  // types reach them, and that is decided by the writers, not by this page.
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/inbox" });

  const prefs = await getEffectivePreferences(viewer.userId, viewer.organizationId).catch(() => null);
  const stored = (prefs?.home?.notifications?.inboxView ?? {}) as Partial<InboxOptions>;

  return (
    <InboxClient
      currentUserId={viewer.userId}
      isGuest={viewer.orgRole === "GUEST"}
      initialOptions={{
        groupByDate: stored.groupByDate ?? DEFAULTS.groupByDate,
        showAll: stored.showAll ?? DEFAULTS.showAll,
        sortNewest: stored.sortNewest ?? DEFAULTS.sortNewest,
        autoClearDays: stored.autoClearDays ?? DEFAULTS.autoClearDays,
        defaultTab: stored.defaultTab ?? DEFAULTS.defaultTab,
      }}
      locale={{
        timeZone: prefs?.home?.locale?.timezone ?? null,
        weekStart: prefs?.home?.locale?.weekStart ?? null,
      }}
      mutedUntil={prefs?.home?.notifications?.mutedUntil ?? null}
    />
  );
}
