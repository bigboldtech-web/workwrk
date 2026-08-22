"use client";

// TablesSidebar — the left panel for the Tables (spreadsheets) app.
//
// Modeled on DocsSidebar: the header ("Tables" + create button) is rendered
// by ClickSidebarBody; this is the scrolling body. It lists every worksheet
// the viewer can see (GET /api/tables, already updatedAt-desc) so clicking
// one opens the spreadsheet directly — the card overview at /tables stays
// reachable via a small secondary "All tables" row.

import { createExcelSheet } from "@/lib/sheet-new";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import { useSidebarSearch } from "./sidebar-search-context";
import { onSidebarRefresh, notifyTablesChanged } from "./sidebar-refresh";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { usePrompt } from "@/components/ui/dialog-provider";

type SheetRow = {
  id: string;
  name: string;
  updatedAt: string;
  rowCount?: number;
};

export function TablesSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { query } = useSidebarSearch();
  const { rowVersion, bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const [sheets, setSheets] = useState<SheetRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tables", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      // jsonSuccess historically wrapped in {data}; today it returns the raw
      // array — accept both shapes like the list page does.
      setSheets((d.data ?? (Array.isArray(d) ? d : [])) as SheetRow[]);
    } catch {
      setSheets([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Refresh triggers: the tables-specific event (notifyTablesChanged), the
  // generic sidebar-refresh bus, and the shell's rowVersion("tables") bump
  // that the list page also honours — any mutation path lands on one of them.
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:tables-changed", onChange);
    const offRefresh = onSidebarRefresh(onChange);
    return () => {
      window.removeEventListener("workwrk:tables-changed", onChange);
      offRefresh();
    };
  }, [load]);
  const v = rowVersion("tables");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Self-heal: a sheet created elsewhere (list page's ?new=1 latch, CSV
  // import) routes to /tables/<id> without firing any notify — if that id
  // isn't in our list yet, refetch once. The attempted-set stops a refetch
  // loop when the id genuinely doesn't exist (deleted / no access).
  const attemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sheets) return;
    const m = pathname.match(/^\/tables\/([^/?#]+)/);
    if (!m) return;
    const id = m[1];
    if (sheets.some((s) => s.id === id) || attemptedRef.current.has(id)) return;
    attemptedRef.current.add(id);
    void load();
  }, [pathname, sheets, load]);

  const createSheet = useCallback(async () => {
    const name = (await promptDialog({ title: "Sheet name?" }))?.trim();
    if (!name) return;
    try {
      const t = await createExcelSheet(name);
      // Both notify channels: the event keeps other mounted sidebars in
      // sync (each listener refetches), the rowVersion bump refreshes the
      // /tables card overview. No explicit load() on top — three fetches
      // for one create was a refetch storm.
      notifyTablesChanged();
      bumpRowVersion("tables");
      router.push(`/tables/${t.id}`);
    } catch {
      toast("Couldn't create sheet");
    }
  }, [promptDialog, bumpRowVersion, load, router, toast]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (sheets ?? []).filter((s) => !q || (s.name || "Untitled").toLowerCase().includes(q)),
    [sheets, q],
  );

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => void createSheet()}
        className="flex w-full items-center gap-2 h-7 px-2 rounded-md text-[13.5px] text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        <span>New sheet</span>
      </button>

      <SectionLabel>Sheets</SectionLabel>
      {sheets === null ? (
        <div className="px-2 py-1.5 text-[12.5px] text-zinc-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyCard text={q ? "No sheets match" : "Create your first sheet"} />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {filtered.map((s) => {
            const active = pathname === `/tables/${s.id}`;
            return (
              <li key={s.id}>
                <Link
                  href={`/tables/${s.id}`}
                  className={`flex items-center gap-2 h-7 px-2 rounded-md text-[14px] ${
                    active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate flex-1">{s.name || "Untitled"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Secondary escape hatch back to the card overview. */}
      <div className="mt-3 border-t border-zinc-100 pt-2">
        <Link
          href="/tables"
          className={`flex items-center gap-2 h-7 px-2 rounded-md text-[13px] ${
            pathname === "/tables" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
          <span>All tables</span>
        </Link>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-4 pb-1 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">{children}</div>;
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="mx-0.5 my-1 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-5 text-center">
      <Table2 className="w-4 h-4 mx-auto text-zinc-300" />
      <p className="mt-1.5 text-[12.5px] text-zinc-400 leading-snug">{text}</p>
    </div>
  );
}
