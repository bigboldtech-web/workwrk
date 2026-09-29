"use client";

// The body of the Staff console's 404 ((admin)/admin/not-found.tsx): the
// product's in-shell sentence and a BackButton to Overview. No Search link:
// spec-admin-backoffice 2.8 gives Search exactly two entries, the top-bar
// field and Cmd+K, both on screen here. Breadcrumb: "Staff console > Not
// found" (consoleCrumbs).

import { OsEmptyView } from "@/components/layout/os/empty-view";
import { BackButton } from "@/components/ui/back-button";

export function ConsoleNotFoundView() {
  return (
    <div className="p-6">
      <OsEmptyView title="We couldn't find that page">
        <BackButton fallbackHref="/admin" label="Overview" />
      </OsEmptyView>
    </div>
  );
}
