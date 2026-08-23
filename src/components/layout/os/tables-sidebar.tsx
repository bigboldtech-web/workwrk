"use client";

// TablesSidebar — the left panel for the Tables (spreadsheets) app.
//
// Modeled on DocsSidebar: the header ("Tables" + create button) is rendered
// by ClickSidebarBody; this is the scrolling body. It lists every worksheet
// the viewer can see (GET /api/tables, already updatedAt-desc) so clicking
// one opens the spreadsheet directly — the card overview at /tables stays
// reachable via a small secondary "All tables" row.

import { createUntitledSheet } from "@/lib/sheet-new";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { useSidebarSearch } from "./sidebar-search-context";
import { onSidebarRefresh, notifyTablesChanged } from "./sidebar-refresh";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { MenuList, MenuItem } from "@/components/ui/menu";
import { MorePortal } from "./more-portal";

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

  // Right-click a worksheet row: Rename / Delete (Sheets' tab menu, mirrored
  // here so the sidebar can manage sheets without opening them). DELETE is
  // a soft delete (Trash) server-side.
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const [rowMenu, setRowMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const rowMenuAnchorRef = useRef<HTMLElement | null>(null); // unused in point mode
  const rowMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rowMenuPanelRef.current?.contains(e.target as Node)) return;
      setRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRowMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);

  const renameSheet = useCallback(async (id: string, name: string) => {
    const next = await promptDialog({ title: "Rename sheet", defaultValue: name || "Untitled spreadsheet" });
    if (next == null) return;
    const trimmed = next.trim() || "Untitled spreadsheet";
    if (trimmed === name) return;
    try {
      const res = await fetch(`/api/tables/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      notifyTablesChanged();
      bumpRowVersion("tables");
      if (pathname === `/tables/${id}`) router.refresh();
    } catch { toast("Couldn't rename sheet"); }
  }, [promptDialog, bumpRowVersion, pathname, router, toast]);

  const deleteSheet = useCallback(async (id: string, name: string) => {
    const label = name || "Untitled spreadsheet";
    if (!(await confirm({ title: "Delete sheet", description: `Delete "${label}"? It moves to Trash.`, destructive: true, confirmLabel: "Delete" }))) return;
    try {
      const res = await fetch(`/api/tables/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`DELETE ${res.status}`);
      const remaining = (sheets ?? []).filter((s) => s.id !== id);
      setSheets(remaining);
      notifyTablesChanged();
      bumpRowVersion("tables");
      // Deleting the OPEN sheet: land on the next one, or the overview.
      if (pathname === `/tables/${id}`) router.push(remaining[0] ? `/tables/${remaining[0].id}` : "/tables");
    } catch { toast("Couldn't delete sheet"); }
  }, [confirm, sheets, bumpRowVersion, pathname, router, toast]);

  const createSheetBusyRef = useRef(false);
  const createSheet = useCallback(async () => {
    // Promptless create means a double-click would fire two POSTs and mint
    // two identical "Untitled spreadsheet"s — latch until the first lands.
    if (createSheetBusyRef.current) return;
    createSheetBusyRef.current = true;
    try {
      // No name prompt (Sheets model): born "Untitled spreadsheet", the
      // loaded list only feeds the cosmetic " 2"/" 3" suffix.
      const t = await createUntitledSheet((sheets ?? []).map((s) => s.name));
      // Both notify channels: the event keeps other mounted sidebars in
      // sync (each listener refetches), the rowVersion bump refreshes the
      // /tables card overview. No explicit load() on top — three fetches
      // for one create was a refetch storm.
      notifyTablesChanged();
      bumpRowVersion("tables");
      router.push(`/tables/${t.id}`);
    } catch {
      toast("Couldn't create sheet");
    } finally {
      createSheetBusyRef.current = false;
    }
  }, [sheets, bumpRowVersion, router, toast]);

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
                  onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: s.id, name: s.name, x: e.clientX, y: e.clientY }); }}
                >
                  <Table2 className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate flex-1">{s.name || "Untitled"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rowMenu ? (
        <MorePortal anchorRef={rowMenuAnchorRef} panelRef={rowMenuPanelRef} width={180} open placement="below" point={{ x: rowMenu.x, y: rowMenu.y }}>
          <MenuList className="min-w-[180px]">
            <MenuItem icon={Pencil} label="Rename" onClick={() => { const m = rowMenu; setRowMenu(null); void renameSheet(m.id, m.name); }} />
            <MenuItem icon={Trash2} label="Delete sheet" destructive onClick={() => { const m = rowMenu; setRowMenu(null); void deleteSheet(m.id, m.name); }} />
          </MenuList>
        </MorePortal>
      ) : null}

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
