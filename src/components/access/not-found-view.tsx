"use client";

// The in-shell 404 body (spec-shell 2.4): "We couldn't find that page", one
// text link "Search" that opens the palette, and a BackButton to the current
// hub's landing. It is also the denial view for "not discoverable"
// (access 5.5 rule 2), so it never names an object, an owner or a count and
// never hints that anything was here: a real 404 and a denied one are
// pixel-identical by design. The breadcrumb reads "Hub > Not found".

import { useContext } from "react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { BackButton } from "@/components/ui/back-button";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsShellContext } from "@/components/layout/os/shell-context";
import { useHubBack } from "@/components/layout/os/use-hub-back";

export function NotFoundView() {
  const shell = useContext(OsShellContext);
  const back = useHubBack();
  return (
    <>
      <Breadcrumb items={[{ label: "Not found" }]} />
      <OsEmptyView
        title="We couldn't find that page"
        action={shell ? { label: "Search", onClick: shell.openPalette } : undefined}
      >
        <BackButton fallbackHref={back.fallbackHref} label={back.label} />
      </OsEmptyView>
    </>
  );
}
