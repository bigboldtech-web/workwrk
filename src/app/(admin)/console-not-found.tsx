"use client";

// The body of the Staff console's 404 ((admin)/admin/not-found.tsx): the
// product's in-shell sentence, one text link that opens the console's
// Search, and a BackButton to Overview. Breadcrumb: "Staff console > Not
// found" (consoleCrumbs).

import { OsEmptyView } from "@/components/layout/os/empty-view";
import { BackButton } from "@/components/ui/back-button";
import { useConsole } from "./console-context";

export function ConsoleNotFoundView() {
  const { setSearchOpen } = useConsole();
  return (
    <div className="p-6">
      <OsEmptyView title="We couldn't find that page" action={{ label: "Search", onClick: () => setSearchOpen(true) }}>
        <BackButton fallbackHref="/admin" label="Overview" />
      </OsEmptyView>
    </div>
  );
}
