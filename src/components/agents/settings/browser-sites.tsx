"use client";

// A teammate's Allowed sites (docs/plans/ai-teammates-phase4.md step 4,
// Decision 9), under its tools on the Tools and approvals tab, shown while
// it holds a browser tool and the computer is available here (tools-tab.tsx).
// Reads GET /api/teammate-browser/teammates/[slug]/sites.
//
//   its managers   a checkbox per site the workspace allows (the tool
//                  picker's own rows); each tick sends one PUT with `add` or
//                  `remove` (teammate-setup.ts siteChange), never the whole
//                  list, so a tab read before someone else's change changes
//                  only the site it ticked. A site the teammate still holds
//                  that the workspace no longer allows, or blocks, is listed
//                  ticked with its line (notInWorkspace, blocked), so it can
//                  be taken away; a blocked one it does not hold cannot be
//                  ticked.
//   everyone else  the teammate's sites as a list, and the readOnly line: no
//                  control they cannot use is drawn.
//
// Every change names the workspace the list was read in, and a session
// switched in another tab answers workspace_changed: the page reloads.

import { useCallback, useEffect, useState } from "react";
import { useOsToast } from "@/components/layout/os/toast";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { BROWSER_PANEL_COPY, BROWSER_SITES_COPY } from "@/lib/agents/teammate-copy";
import { browserSiteRows, siteChange, type BrowserSiteRow } from "@/lib/agents/teammate-setup";

const CHECKBOX = "h-[18px] w-[18px] shrink-0 rounded border-line-strong accent-[var(--os-brand)] disabled:opacity-50";
const LINK = "font-medium text-brand-deep hover:underline";

/** What GET and PUT .../sites answer. */
export interface TeammateSitesView {
  organizationId: string;
  workspaceSites: string[];
  blockSites: string[];
  sites: string[];
  canManage: boolean;
  available: boolean;
}

function noteOf(r: BrowserSiteRow): string | null {
  if (r.note === "blocked") return BROWSER_SITES_COPY.blocked(r.site);
  if (r.note === "not_in_workspace") return BROWSER_SITES_COPY.notInWorkspace(r.site);
  return null;
}

export function BrowserSites({
  slug,
  onChanged,
}: {
  slug: string;
  /** A site changed: the tools' rows read again (ready, or pick its sites). */
  onChanged?: () => void;
}) {
  const { toast } = useOsToast();
  const [view, setView] = useState<TeammateSitesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const url = `/api/teammate-browser/teammates/${encodeURIComponent(slug)}/sites`;

  const load = useCallback(async () => {
    const r = await apiFetch<TeammateSitesView>(url, { cache: "no-store" });
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(r.data);
  }, [url]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function tick(site: string, on: boolean) {
    if (!view) return;
    setBusy(site);
    // The workspace this list was read in: a session switched elsewhere changes nothing here.
    const r = await apiFetch<TeammateSitesView & { changed: boolean }>(url, { method: "PUT", json: { organizationId: view.organizationId, ...siteChange(site, on) } });
    setBusy(null);
    if (!r.ok) {
      toast(r.error || BROWSER_SITES_COPY.saveFailed, { tone: "danger" });
      if (r.code === "workspace_changed") {
        window.location.reload();
        return;
      }
      void load();
      return;
    }
    setView(r.data);
    if (r.data.changed) onChanged?.();
  }

  if (failed && !view) {
    return (
      <p className="m-0 flex min-h-9 items-center gap-2 text-sm text-ink-2">
        {BROWSER_SITES_COPY.loadFailed} ·
        <button type="button" className={LINK} onClick={() => void load()}>
          {BROWSER_PANEL_COPY.tryAgain}
        </button>
      </p>
    );
  }
  if (!view) return <SkeletonLines lines={2} />;
  // The computer was turned off since the tab was read: nothing to pick here.
  if (!view.available) return null;

  const rows = browserSiteRows(view);
  const manages = view.canManage;
  const shown = manages ? rows : rows.filter((r) => r.on);

  return (
    <section aria-label={BROWSER_SITES_COPY.heading}>
      <h4 className="mb-1 text-sm font-medium text-ink-2">{BROWSER_SITES_COPY.heading}</h4>
      <p className="m-0 mb-2 text-sm text-ink-2">{BROWSER_SITES_COPY.hint}</p>
      {view.workspaceSites.length === 0 && shown.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{BROWSER_SITES_COPY.none}</p>
      ) : shown.length > 0 ? (
        <ul className="flex flex-col rounded-md border border-line">
          {shown.map((r) => {
            const note = noteOf(r);
            return (
              <li key={r.site} className="flex flex-col gap-1 border-t border-line-soft px-3 py-2 first:border-t-0">
                {manages ? (
                  <label className="flex min-h-8 w-fit cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={r.on}
                      // Taking a site away always works; adding only a site the workspace allows and does not block.
                      disabled={busy !== null || (!r.on && !r.canAdd)}
                      onChange={(e) => void tick(r.site, e.target.checked)}
                      className={CHECKBOX}
                    />
                    <span className="break-all text-base text-ink">{r.site}</span>
                  </label>
                ) : (
                  <span className="flex min-h-8 items-center break-all text-base text-ink">{r.site}</span>
                )}
                {note ? <span className={manages ? "ps-[30px] text-sm text-ink-2" : "text-sm text-ink-2"}>{note}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!manages ? <p className="m-0 mt-2 text-sm text-ink-2">{BROWSER_SITES_COPY.readOnly}</p> : null}
    </section>
  );
}
