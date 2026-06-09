"use client";

/*
 * DocTabsBar — a browser-style strip of open-note tabs across the top of the
 * /docs area, mirroring Notion's desktop tabs.
 *
 * Why a layout-level component: tabs must survive navigation between
 * /docs/<a> and /docs/<b>. Mounted from (dashboard)/docs/layout.tsx, this
 * component does NOT unmount as the [id] segment changes, so its state +
 * localStorage persistence stay intact across note switches.
 *
 * How tabs get populated: BlockDocEditor dispatches `workwrk:doc-tab:open`
 * (and `…:meta` on rename / icon change) with { id, title, icon }. This bar
 * upserts that into its list. Open notes therefore self-register — no prop
 * threading through the router.
 *
 * Keyboard: ⌘/Ctrl + 1–9 jumps to the Nth tab (Notion / browser parity).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, Plus, FileText } from "lucide-react";
import { renderNoteIcon } from "./note-icon";

type DocTab = { id: string; title: string; icon?: string };
const LS_KEY = "workwrk:doc-tabs";

// Hydration-safe "are we on the client yet" flag. Server + first client render
// both see `false` (matching HTML), then it flips to `true` post-hydration —
// avoids a mismatch when tabs are restored from localStorage on the client.
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
  try { localStorage.setItem(LS_KEY, JSON.stringify(tabs)); } catch { /* ignore */ }
}

export function DocTabsBar() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  // Lazy-init from localStorage (repo convention — guarded for SSR). Avoids a
  // synchronous setState-in-effect for hydration.
  const [tabs, setTabs] = useState<DocTab[]>(loadTabs);
  const [mod] = useState(() =>
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥" : "Alt",
  );

  // The active doc id is the /docs/<id> segment (library + trash are not docs).
  const activeId = (() => {
    const m = pathname?.match(/^\/docs\/([^/]+)$/);
    if (!m || m[1] === "trash") return null;
    return m[1];
  })();

  // Persist on every change.
  useEffect(() => { persist(tabs); }, [tabs]);

  // Publish the bar's height so the sticky doc header (.bdoc__head) can dock
  // *below* it instead of being hidden under it when the note is scrolled.
  // Cleared to 0 when there are no tabs (the bar renders nothing).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--doctabs-h", tabs.length > 0 ? "40px" : "0px");
    return () => { root.style.setProperty("--doctabs-h", "0px"); };
  }, [tabs.length]);

  // Self-registration from the editor: add the note if new, merge title/icon
  // if it already has a tab. Appends to the end (left-to-right open order).
  const upsert = useCallback((t: DocTab) => {
    setTabs((prev) => {
      const i = prev.findIndex((x) => x.id === t.id);
      if (i === -1) return [...prev, { id: t.id, title: t.title || "Untitled note", icon: t.icon }];
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

  // Prune tabs for notes deleted/trashed anywhere in the app. The
  // docs-changed event carries no id, so reconcile against the live list.
  useEffect(() => {
    function onChange() {
      (async () => {
        try {
          const res = await fetch("/api/docs");
          if (!res.ok) return;
          const d = await res.json();
          const rows: { id: string }[] = d.docs ?? d.data ?? d ?? [];
          const live = new Set(rows.map((r) => r.id));
          setTabs((prev) => prev.filter((t) => live.has(t.id)));
        } catch { /* leave tabs as-is */ }
      })();
    }
    window.addEventListener("workwrk:docs-changed", onChange);
    return () => window.removeEventListener("workwrk:docs-changed", onChange);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      const next = prev.filter((x) => x.id !== id);
      // Closing the active tab moves focus to a neighbour (right, else left).
      if (id === activeId) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
        router.push(fallback ? `/docs/${fallback.id}` : "/docs");
      }
      return next;
    });
  }, [activeId, router]);

  // Tab switching lives on ⌥/Alt — NOT ⌘/Ctrl, which the shell already binds
  // to "jump to the Nth pinned app" (the left rail). Keyed off e.code so the
  // Mac Option-key remapping (⌥1 → "¡", ⌥] → "‘") doesn't break matching.
  //   ⌥/Alt + 1–9     → jump to the Nth note tab
  //   ⌥/Alt + ] / [   → next / previous tab
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

  async function newNote() {
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled note", content: {}, parentId: null }),
      });
      if (!res.ok) return;
      const d = await res.json();
      const id = d.doc?.id ?? d.data?.id ?? d.id;
      if (!id) return;
      upsert({ id, title: "Untitled note" });
      window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
      router.push(`/docs/${id}`);
    } catch { /* ignore */ }
  }

  // Nothing open → no bar (keeps the library view clean until a note opens).
  // Also render nothing until hydrated, so server + client HTML agree.
  if (!hydrated || tabs.length === 0) return null;

  return (
    <div className="doctabs" role="tablist" aria-label="Open notes">
      <div className="doctabs__scroll">
        {tabs.map((t, i) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              className={`doctabs__tab ${active ? "is-active" : ""}`}
              title={i < 9 ? `${t.title || "Untitled note"}  (${mod}${i + 1})` : t.title}
              onClick={() => router.push(`/docs/${t.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/docs/${t.id}`); } }}
            >
              <span className="doctabs__ico">{renderNoteIcon(t.icon) ?? <FileText />}</span>
              <span className="doctabs__title">{t.title || "Untitled note"}</span>
              <button
                type="button"
                className="doctabs__close"
                aria-label={`Close ${t.title || "note"}`}
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              >
                <X />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="doctabs__new" onClick={newNote} title="New note" aria-label="New note">
        <Plus />
      </button>
    </div>
  );
}
