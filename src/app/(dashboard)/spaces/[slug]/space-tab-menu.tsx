"use client";

// The right-click menu of ONE Space view tab: "Pin as default view", or
// "Unpin" on the pinned tab. It is the Space tabs' own small menu; the List
// tabs' menu (src/components/board-view/view-tab-menu.tsx) carries rows a
// Space tab has no use for (rename, share, duplicate, delete).
//
// Three doors open it, through the shared trigger (review #26): right-click,
// a long-press on a phone or tablet (where there is no right button and iOS
// never fires contextmenu on a link), and the keyboard (Shift+F10 or the Menu
// key on the focused tab), which opens it under the tab rather than in the
// page's corner.
//
// After a pin or an unpin the person stays exactly where they are: the bare
// /spaces/<slug> now resolves to a different view, so a bare URL is first
// given its view explicitly, and any other URL is re-rendered in place.

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { useOsToast } from "@/components/layout/os/toast";
import { useContextMenuTrigger } from "@/components/ui/use-context-menu-trigger";
import { accessMessage } from "@/lib/access-message";
import { cn } from "@/lib/utils";
import type { SpaceViewKey } from "@/lib/work/space-default-view";

export function SpaceTabMenu({
  spaceId,
  spaceSlug,
  viewKey,
  row,
  pinnedKey,
  pinnedLabel,
  activeView,
  children,
}: {
  spaceId: string;
  spaceSlug: string;
  viewKey: SpaceViewKey;
  row: "pin" | "unpin" | "unpin-hidden";
  /** The view stored as the pin: what an unpin names, so a stale tab cannot clear a newer pin. */
  pinnedKey?: SpaceViewKey | null;
  /** The pinned view's label, for "Unpin <label>" on Overview when that view is switched off. */
  pinnedLabel?: string;
  /** The tab the page is showing, so a bare URL keeps showing it after the change. */
  activeView: SpaceViewKey;
  children: ReactNode;
}) {
  const trigger = useContextMenuTrigger();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useOsToast();

  const apply = async () => {
    if (busy) return;
    const pin = row === "pin";
    const failed = pin ? "Couldn't pin the view." : "Couldn't unpin the view.";
    setBusy(true);
    try {
      const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/default-view`, pin
        ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ view: viewKey }) }
        : {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ view: row === "unpin" ? viewKey : (pinnedKey ?? viewKey) }),
          });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(accessMessage(body, failed), { tone: "danger" });
        // 409: someone pinned another view since. The tabs re-render so they
        // show the pin that is really there.
        if (res.status === 409) {
          trigger.close();
          router.refresh();
        }
        return;
      }
      trigger.close();
      toast(pin ? "Pinned as the default view" : "Unpinned", { tone: "success" });
      if (!new URLSearchParams(window.location.search).get("view")) {
        router.replace(`/spaces/${encodeURIComponent(spaceSlug)}?view=${activeView}`, { scroll: false });
      } else {
        router.refresh();
      }
    } catch {
      toast(failed, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const { className: bindClass, ...handlers } = trigger.bind;

  // The portal is a SIBLING of the trigger, not its child: React events
  // bubble through portals along the component tree, and a click or a press
  // inside the menu must not reach the tab's own press and click handlers.
  return (
    <>
      <span ref={anchorRef} className={cn("inline-flex shrink-0", bindClass)} {...handlers}>
        {children}
      </span>
      <MorePortal
        anchorRef={anchorRef}
        width={300}
        open={!!trigger.point}
        point={trigger.point}
        onClose={trigger.close}
      >
        <MenuList aria-label="View options">
          {row === "pin" ? (
            <MenuItem
              icon={Pin}
              label="Pin as default view"
              description="Opens first for everyone in this Space"
              busy={busy}
              onClick={() => void apply()}
            />
          ) : row === "unpin" ? (
            <MenuItem icon={PinOff} label="Unpin" busy={busy} onClick={() => void apply()} />
          ) : (
            <MenuItem
              icon={PinOff}
              label={`Unpin ${pinnedLabel ?? "the pinned view"}`}
              description={`${pinnedLabel ?? "The pinned view"} is switched off in this Space`}
              busy={busy}
              onClick={() => void apply()}
            />
          )}
        </MenuList>
      </MorePortal>
    </>
  );
}
