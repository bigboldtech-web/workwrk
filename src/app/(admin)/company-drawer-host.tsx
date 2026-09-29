"use client";

// CompanyDrawerHost: one company in the design system's Drawer, at the
// company's own URL (/admin/companies/<id>), rendered by the
// @drawer/(.)admin/companies/[id] intercept (the product's person drawer
// pattern, components/people/person-drawer-host.tsx).
//
//   Close (the X, Esc, a click on the dimmed list, browser Back) goes back in
//   history when the drawer was opened from a page in this tab, which returns
//   the list with its URL state (view, filters, page) and its scroll intact
//   and never refetched; otherwise it lands on Companies.
//   Expand widens the drawer into the content area without navigating (the
//   URL is already the company's) and draws the record as the full page:
//   its title row with the back arrow, the Plan and Status chips and the
//   page's "..." menu (Refresh, Copy company ID, Copy slug, Staff activity,
//   About this page).
//   Width is remembered per staff member (consolePrefs companies.drawerWidth).
//
// The slot keeps its last state across soft navigations to routes it does not
// match (parallel routes), so the host renders only while the URL is this
// company's: a sidebar click elsewhere closes the drawer rather than leaving
// it floating over another page.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, Maximize2, Minimize2, X } from "lucide-react";
import { Drawer, clampDrawerWidth } from "@/components/ui/drawer";
import { goBackOr } from "@/components/ui/back-button";
import { useOsToast } from "@/components/layout/os/toast";
import { isInitialEntryPath } from "@/lib/nav/entry-path";
import { CompanyRecord } from "./admin/companies/[id]/company-record";
import { useConsole } from "./console-context";
import { knownCompanyName } from "./console-ui";

export function CompanyDrawerHost({ companyId }: { companyId: string }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { prefs, patchPrefs, recents } = useConsole();
  const { toast } = useOsToast();
  const path = `/admin/companies/${companyId}`;
  const here = pathname === path;
  const hardLoad = isInitialEntryPath(path);
  const [expanded, setExpanded] = useState(false);
  // Keyed by id: the slot stays mounted when a row swaps the company, and the
  // header must never name the previous one.
  const [named, setNamed] = useState<{ id: string; name: string } | null>(null);
  const onName = useCallback(
    (n: string) => setNamed((cur) => (cur?.id === companyId && cur.name === n ? cur : { id: companyId, name: n })),
    [companyId],
  );
  // The name the list (or Search's Recent) already had, until the record loads.
  const initialName = knownCompanyName(companyId) ?? recents.find((c) => c.id === companyId)?.name ?? null;
  const shownName = named?.id === companyId ? named.name : initialName;
  const width = clampDrawerWidth(prefs.companies.drawerWidth);

  // Once per opening: a double Esc (or Esc plus a click on the dimmed list)
  // must not step back twice and leave the console page the list was on.
  const closing = useRef<string | null>(null);
  const close = useCallback(() => {
    if (closing.current === pathname) return;
    closing.current = pathname;
    goBackOr(router, "/admin/companies");
  }, [router, pathname]);
  // The slot stays mounted between openings, so leaving the company's URL
  // re-arms Close for the next time a row opens it.
  useEffect(() => {
    if (!here) closing.current = null;
  }, [here]);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link", { tone: "danger" });
    }
  };

  // A click on the dimmed list closes the drawer (a click on another row
  // navigates, which swaps the company, and never reaches here).
  useEffect(() => {
    if (expanded || !here || hardLoad) return;
    const onDocClick = (e: MouseEvent) => {
      const main = document.getElementById("main");
      const target = e.target as Node | null;
      if (!main || !target || !main.contains(target)) return;
      if ((target as HTMLElement).closest?.("a,button,[role='button'],input,textarea,select,label")) return;
      close();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [close, expanded, here, hardLoad]);

  if (!here || hardLoad) return null;

  return (
    <Drawer
      open
      onClose={close}
      ariaLabel="Company"
      layerId="company-drawer"
      expanded={expanded}
      width={width}
      onWidthChange={(px) => patchPrefs({ companies: { drawerWidth: px } })}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            Companies › <span className="text-ink">{shownName ?? "Company"}</span>
          </span>
          <button type="button" aria-label={expanded ? "Collapse" : "Expand"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((v) => !v)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink max-lg:hidden">
            {expanded ? <Minimize2 className="h-4 w-4" strokeWidth={1.5} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          <button type="button" aria-label="Copy link" title="Copy link" onClick={() => void copyLink()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <Copy className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" aria-label="Close" title="Close" onClick={close} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
    >
      <CompanyRecord
        key={companyId}
        id={companyId}
        presentation={expanded ? "page" : "drawer"}
        onName={onName}
        initialName={initialName}
      />
    </Drawer>
  );
}
