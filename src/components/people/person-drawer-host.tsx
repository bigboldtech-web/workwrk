"use client";

// PersonDrawerHost: the person record in the Drawer, at its own URL
// (/people/<id>), rendered by the @drawer/(.)people/[id] intercept.
//
// Close (the X, Esc, a click on the dimmed list, browser Back) goes back in
// history when the drawer was opened from a page in this tab, which returns
// the list with its URL state (filters, page) intact and never refetched;
// otherwise it lands on the Directory. Expand widens the drawer into the
// content area without navigating (the URL is already the record's).
//
// The static siblings /people/me, /people/departments, /people/roles and
// /people/skills are real pages, never ids (the proxy keeps them out of the
// intercept); if one ever arrives here anyway, this host hands the URL over
// as a full load instead of drawing a record for an id that is a page name.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Maximize2, Minimize2, X } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { Drawer, DRAWER_DEFAULT_W, clampDrawerWidth } from "@/components/ui/drawer";
import { goBackOr } from "@/components/ui/back-button";
import { isInitialEntryPath } from "@/lib/nav/entry-path";
import { useBoot } from "@/components/layout/os/boot-context";
import { PersonRecord } from "./person-record";

const STATIC_SEGMENTS = new Set(["me", "departments", "roles", "skills"]);

export function PersonDrawerHost({ personId }: { personId: string }) {
  const router = useRouter();
  const { boot } = useBoot();
  // A Guest never sees the Teams hub (access 2.3): the full page answers them
  // with the in-shell 404, so the drawer hands the URL over as a full load.
  const reserved = STATIC_SEGMENTS.has(personId) || boot.viewer.orgRole === "GUEST";
  const hardLoad = isInitialEntryPath(`/people/${personId}`);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => clampDrawerWidth(DRAWER_DEFAULT_W));
  const [meta, setMeta] = useState<{ name: string; self: boolean } | null>(null);
  const { toast } = useOsToast();
  const onMeta = useCallback((m: { name: string; self: boolean }) => setMeta(m), []);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/people/${personId}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  };

  useEffect(() => {
    if (reserved && typeof window !== "undefined") window.location.assign(`/people/${personId}${window.location.search}`);
  }, [reserved, personId]);

  const close = useCallback(() => { goBackOr(router, "/people"); }, [router]);

  // A click on the dimmed list closes the drawer (a click on another row
  // navigates, which swaps the record, and never reaches here).
  useEffect(() => {
    if (expanded || reserved || hardLoad) return;
    const onDocClick = (e: MouseEvent) => {
      const main = document.getElementById("main");
      const target = e.target as Node | null;
      if (!main || !target || !main.contains(target)) return;
      if ((target as HTMLElement).closest?.("a,button,[role='button'],input,textarea,select,label")) return;
      close();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [close, expanded, reserved, hardLoad]);

  if (reserved || hardLoad) return null;

  return (
    <Drawer
      open
      onClose={close}
      ariaLabel="Person"
      layerId="person-drawer"
      expanded={expanded}
      width={width}
      onWidthChange={setWidth}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            {meta?.self ? "My profile" : <>Directory › <span className="text-ink">{meta?.name ?? ""}</span></>}
          </span>
          <button type="button" aria-label={expanded ? "Collapse" : "Expand"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((v) => !v)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="Copy link" title="Copy link" onClick={() => void copyLink()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Close" onClick={close} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      <Suspense>
        <PersonRecord id={personId} presentation="drawer" expanded={expanded} onMeta={onMeta} />
      </Suspense>
    </Drawer>
  );
}
