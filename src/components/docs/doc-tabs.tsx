"use client";

/*
 * DocTabsBar: the strip of open docs across the top of the /docs area.
 *
 * This is a capability the product already had and keeps. It was a Notion
 * style tab strip on the pre refresh Docs area; it is now drawn on the
 * refresh tokens (36px rows, --os-surface ground, --os-line rule, the same
 * hover and active grammar as the rest of the chrome) instead of the deleted
 * .doctabs CSS family. Behaviour is unchanged:
 *
 *   - Docs self register: BlockDocEditor dispatches "workwrk:doc-tab:open"
 *     (and the same event on rename or icon change) so no props are threaded
 *     through the router.
 *   - Mounted from (dashboard)/docs/layout.tsx, so the strip survives
 *     navigation between /docs/<a> and /docs/<b>.
 *   - Alt (Option on a Mac) + 1 to 9 jumps to the Nth tab, Alt + ] and
 *     Alt + [ step through them. Never Cmd: Cmd 1 to 8 are the hub rail.
 *   - Each tab closes on its own x, and "+" opens a new doc.
 *   - The list persists in localStorage ("workwrk:doc-tabs"), per viewer,
 *     and is pruned against the live doc list when a doc is trashed.
 *
 * With nothing open the strip renders nothing at all, so /docs is clean
 * until the first doc opens.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, Plus, FileText } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { renderNoteIcon } from "./note-icon";

type DocTab = { id: string; title: string; icon?: string };
const LS_KEY = "workwrk:doc-tabs";

// Hydration safe "are we on the client yet" flag. Server and first client
// render both see false (matching the HTML), then it flips to true, so the
// localStorage restore never trips a hydration mismatch.
const noopSubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function loadTabs(): DocTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === "string") : [];
  } catch { return []; }
}
function persist(tabs: DocTab[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(tabs)); } catch { /* a private window simply forgets */ }
}

export function DocTabsBar() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [tabs, setTabs] = useState<DocTab[]>(loadTabs);
  const [mod] = useState(() =>
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "Option" : "Alt",
  );

  // The active doc id is the /docs/<id> segment. /docs and /docs/trash are
  // not docs, so neither lights a tab.
  const activeId = (() => {
    const m = pathname?.match(/^\/docs\/([^/]+)$/);
    if (!m || m[1] === "trash") return null;
    return m[1];
  })();

  useEffect(() => { persist(tabs); }, [tabs]);

  // Publish the strip's height so the sticky doc header docks below it
  // instead of under it. Zero when the strip renders nothing.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--doctabs-h", tabs.length > 0 ? "36px" : "0px");
    return () => { root.style.setProperty("--doctabs-h", "0px"); };
  }, [tabs.length]);

  const upsert = useCallback((t: DocTab) => {
    setTabs((prev) => {
      const i = prev.findIndex((x) => x.id === t.id);
      if (i === -1) return [...prev, { id: t.id, title: t.title || "Untitled doc", icon: t.icon }];
      const next = prev.slice();
      next[i] = { ...next[i], title: t.title || next[i].title, icon: t.icon };
      return next;
    });
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent).detail as DocTab | undefined;
      if (d?.id) upsert(d);
    }
    window.addEventListener("workwrk:doc-tab:open", onOpen);
    window.addEventListener("workwrk:doc-tab:meta", onOpen);
    return () => {
      window.removeEventListener("workwrk:doc-tab:open", onOpen);
      window.removeEventListener("workwrk:doc-tab:meta", onOpen);
    };
  }, [upsert]);

  // Prune tabs for docs trashed or deleted anywhere in the app. The
  // docs-changed event carries no id, so reconcile against the live list.
  useEffect(() => {
    function onChange() {
      void (async () => {
        const r = await apiFetch<{ docs?: { id: string }[]; data?: { id: string }[] }>("/api/docs", { cache: "no-store" });
        if (!r.ok) return; // leave the tabs alone rather than guessing
        const rows = r.data.docs ?? r.data.data ?? [];
        if (!Array.isArray(rows)) return;
        const live = new Set(rows.map((x) => x.id));
        setTabs((prev) => prev.filter((t) => live.has(t.id)));
      })();
    }
    window.addEventListener("workwrk:docs-changed", onChange);
    return () => window.removeEventListener("workwrk:docs-changed", onChange);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      const next = prev.filter((x) => x.id !== id);
      // Closing the open doc moves to a neighbour (right, else left).
      if (id === activeId) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
        router.push(fallback ? `/docs/${fallback.id}` : "/docs");
      }
      return next;
    });
  }, [activeId, router]);

  // Alt / Option, never Cmd: the shell binds Cmd 1 to 8 to the hub rail.
  // Keyed off e.code so the Mac Option remapping (Option 1 gives "¡")
  // does not break matching.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (/^Digit[1-9]$/.test(e.code)) {
        const tab = tabs[Number(e.code.slice(5)) - 1];
        if (tab) { e.preventDefault(); router.push(`/docs/${tab.id}`); }
        return;
      }
      if (e.code === "BracketRight" || e.code === "BracketLeft") {
        if (!activeId || tabs.length === 0) return;
        const i = tabs.findIndex((t) => t.id === activeId);
        if (i === -1) return;
        const delta = e.code === "BracketRight" ? 1 : -1;
        const next = tabs[(i + delta + tabs.length) % tabs.length];
        if (next) { e.preventDefault(); router.push(`/docs/${next.id}`); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, activeId, router]);

  const [creating, setCreating] = useState(false);
  async function newDoc() {
    if (creating) return;
    setCreating(true);
    const r = await apiFetch<{ doc?: { id: string }; data?: { id: string }; id?: string }>("/api/docs", {
      method: "POST",
      json: { title: "Untitled doc", content: {}, parentId: null },
    });
    setCreating(false);
    if (!r.ok) return;
    const id = r.data.doc?.id ?? r.data.data?.id ?? r.data.id;
    if (!id) return;
    upsert({ id, title: "Untitled doc" });
    window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
    router.push(`/docs/${id}`);
  }

  // Nothing open: no strip, and nothing rendered before hydration so the
  // server and client HTML agree.
  if (!hydrated || tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open docs"
      className="flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-surface px-2"
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            title={i < 9 ? `${t.title || "Untitled doc"}  (${mod} ${i + 1})` : t.title}
            onClick={() => router.push(`/docs/${t.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/docs/${t.id}`); } }}
            className={cn(
              "group inline-flex min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 self-center rounded-md px-2 py-1 text-sm",
              active ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center text-ink-3 [&_svg]:h-3.5 [&_svg]:w-3.5">
              {renderNoteIcon(t.icon) ?? <FileText strokeWidth={1.5} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate">{t.title || "Untitled doc"}</span>
            <button
              type="button"
              aria-label={`Close ${t.title || "doc"}`}
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              className="inline-grid h-4 w-4 shrink-0 place-items-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void newDoc()}
        title="New doc"
        aria-label="New doc"
        className="inline-grid h-7 w-7 shrink-0 self-center place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
