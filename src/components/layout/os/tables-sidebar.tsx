"use client";

// TablesSidebar: the ONE sidebar of the Tables hub (sidebar-map section 7,
// spec-tables-forms section 1 "Hub sidebar contents"). It renders on /tables,
// /tables/[id], /forms and /forms/[id], resolved from the URL, so the sidebar
// never depends on how a person arrived (the deleted FormsSidebar was that
// second sidebar, and was unreachable). Five row groups, in order:
//
//   1  All tables          /tables   (only while the spreadsheets module is on)
//   2  All forms           /forms    (Forms is core, founder decision D15)
//   3  FAVORITES           starred tables and forms, most recently starred
//                          first; hover "...": Remove from favorites, Copy link
//   4  TABLES              every table the viewer can open, updatedAt desc;
//                          hover and focus "..." = TableRowMenu; "+ New table"
//                          ghost last; past 20 rows "Show all (N)" -> /tables
//   5  FORMS               every form (for a Guest, only the ones they
//                          made: GET /api/forms scopes it), updatedAt desc, response count; hover
//                          and focus "..." = FormRowMenu; "+ New form" ghost
//                          last; past 20 rows "Show all (N)" -> /forms
//
// There is no Trash row here: the one Trash lives in the Work hub, and the
// /tables and /forms "..." menus link it pre-filtered (?type=table, ?type=form).
// A section that fails to load says so with a wired Try again, never an empty
// list. Right click on a row still opens its menu, as a shortcut to the "...".
//
// The hub "+" row "Import a CSV..." dispatches workwrk:os:new:tables-import-csv;
// this sidebar is mounted on every Tables hub route, so it hosts the dialog.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, LayoutGrid, Link2, MoreHorizontal, Plus, Star, Table2 } from "lucide-react";
import { useSidebarSearch } from "./sidebar-search-context";
import { useActiveRowHref } from "./use-active-row";
import { onSidebarRefresh, notifyTablesChanged } from "./sidebar-refresh";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { useBoot } from "./boot-context";
import { MorePortal } from "./more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import {
  SidebarRow, SidebarGhostRow, SidebarSectionLabel, SidebarErrorLine, SidebarSkeletonRows, SidebarEmptyLine,
} from "./sidebar-primitives";
import { TableRowMenuHost, useTableRowMenu } from "@/components/tables/table-row-menu";
import { FormRowMenuHost, dispatchFormsChanged, useFormRowMenu } from "@/components/forms/form-row-menu";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";
import { createNewTable, newTableHref } from "@/lib/sheet-new";
import { isSectionCollapsed, toggleSectionCollapsed } from "@/lib/docs-prefs";
import { apiFetch } from "@/lib/api-fetch";

type TableRow = { id: string; name: string; updatedAt: string; spaceId?: string | null; canManage?: boolean; isPublic?: boolean };
type FormRow = { id: string; name: string; updatedAt: string; submissionCount?: number; canManage?: boolean; isPublic?: boolean };
type FavoriteRow = { kind: string; id: string; name: string; href: string };

/** The Tables hub "+" row's event (apps-catalog createActions). */
export const TABLES_IMPORT_CSV_EVENT = "tables-import-csv";

const HUB_ROWS = [
  { href: "/tables", match: "exact" as const },
  { href: "/forms", match: "exact" as const },
];
const COLLAPSE_AT = 20;
const FAV_KEY = "tables.favorites";
const TABLES_KEY = "tables.tables";
const FORMS_KEY = "tables.forms";

export function TablesSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const activeHubHref = useActiveRowHref(HUB_ROWS);
  const { query } = useSidebarSearch();
  const { rowVersion, bumpRowVersion, prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const isGuest = boot.viewer.orgRole === "GUEST";
  const tablesOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("tables");

  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [tablesError, setTablesError] = useState(false);
  const [forms, setForms] = useState<FormRow[] | null>(null);
  // A Guest has no /forms list to "Show all" on (FormsListGate 404s it), so
  // for them "Show all (N)" expands the section in place instead.
  const [guestFormsExpanded, setGuestFormsExpanded] = useState(false);
  const [formsError, setFormsError] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteRow[] | null>(null);
  const [favError, setFavError] = useState(false);

  // No setState before the first await (react-hooks/set-state-in-effect).
  const loadTables = useCallback(async () => {
    if (!tablesOn) return;
    const r = await apiFetch<TableRow[] | { data?: TableRow[] }>("/api/tables", { cache: "no-store" });
    if (!r.ok) { setTablesError(true); return; }
    setTablesError(false);
    setTables(Array.isArray(r.data) ? r.data : r.data.data ?? []);
  }, [tablesOn]);
  const loadForms = useCallback(async () => {
    const r = await apiFetch<FormRow[] | { data?: FormRow[] }>("/api/forms", { cache: "no-store" });
    if (!r.ok) { setFormsError(true); return; }
    setFormsError(false);
    setForms(Array.isArray(r.data) ? r.data : r.data.data ?? []);
  }, []);
  // FAVORITES comes from the ONE aggregate, which drops a starred object the
  // viewer lost access to rather than showing it locked.
  const loadFavorites = useCallback(async () => {
    const r = await apiFetch<{ favorites?: FavoriteRow[] }>("/api/me/favorites", { cache: "no-store" });
    if (!r.ok) { setFavError(true); return; }
    setFavError(false);
    setFavorites((r.data.favorites ?? []).filter((f) => f.kind === "form" || (f.kind === "table" && tablesOn)));
  }, [tablesOn]);

  useEffect(() => {
    const t = setTimeout(() => { void loadTables(); void loadForms(); void loadFavorites(); }, 0);
    return () => clearTimeout(t);
  }, [loadTables, loadForms, loadFavorites]);

  // Refresh triggers: the tables and forms buses, the generic sidebar bus,
  // the favorites bus, and the shell's rowVersion bumps.
  useEffect(() => {
    const onTables = () => { void loadTables(); void loadFavorites(); };
    const onForms = () => { void loadForms(); void loadFavorites(); };
    const onFavs = () => { void loadFavorites(); };
    window.addEventListener("workwrk:tables-changed", onTables);
    window.addEventListener("workwrk:forms-changed", onForms);
    window.addEventListener("workwrk:favs-changed", onFavs);
    const offRefresh = onSidebarRefresh(() => { onTables(); onForms(); });
    return () => {
      window.removeEventListener("workwrk:tables-changed", onTables);
      window.removeEventListener("workwrk:forms-changed", onForms);
      window.removeEventListener("workwrk:favs-changed", onFavs);
      offRefresh();
    };
  }, [loadTables, loadForms, loadFavorites]);
  const tv = rowVersion("tables");
  useEffect(() => { if (tv > 0) void loadTables(); }, [tv, loadTables]);
  const fv = rowVersion("forms");
  useEffect(() => { if (fv > 0) void loadForms(); }, [fv, loadForms]);

  // Self-heal: an object opened by URL that is not in the list yet (created
  // elsewhere, or a CSV import) refetches once; the attempted set stops a
  // loop when the id genuinely does not exist.
  const attemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const m = pathname.match(/^\/(tables|forms)\/([^/?#]+)/);
    if (!m) return;
    const [, kind, id] = m;
    const list = kind === "tables" ? tables : forms;
    if (!list || list.some((x) => x.id === id) || attemptedRef.current.has(id)) return;
    attemptedRef.current.add(id);
    void (kind === "tables" ? loadTables() : loadForms());
  }, [pathname, tables, forms, loadTables, loadForms]);

  /* ── create ── */
  const createBusy = useRef(false);
  const newTable = useCallback(async () => {
    if (createBusy.current) return;
    createBusy.current = true;
    try {
      const t = await createNewTable();
      notifyTablesChanged();
      bumpRowVersion("tables");
      router.push(newTableHref(t.id));
    } catch {
      toast("Couldn't create the table", { tone: "danger" });
    } finally { createBusy.current = false; }
  }, [bumpRowVersion, router, toast]);
  const newForm = useCallback(async () => {
    if (createBusy.current) return;
    createBusy.current = true;
    const r = await apiFetch<{ id: string }>("/api/forms", { method: "POST", json: { name: "Untitled form", fields: [] } });
    createBusy.current = false;
    if (!r.ok) { toast("Couldn't create the form", { tone: "danger" }); return; }
    dispatchFormsChanged();
    router.push(`/forms/${r.data.id}?new=1`);
  }, [router, toast]);

  /* ── the hub "+" Import a CSV... ── */
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    const onImport = () => setImportOpen(true);
    const name = `workwrk:os:new:${TABLES_IMPORT_CSV_EVENT}`;
    window.addEventListener(name, onImport);
    return () => window.removeEventListener(name, onImport);
  }, []);

  /* ── collapse ── */
  const favCollapsed = isSectionCollapsed(prefs.sidebar, FAV_KEY);
  const tablesCollapsed = isSectionCollapsed(prefs.sidebar, TABLES_KEY);
  const formsCollapsed = isSectionCollapsed(prefs.sidebar, FORMS_KEY);
  const toggleSection = useCallback((key: string) => {
    void patchPrefs({ sidebar: { collapsedSections: toggleSectionCollapsed(prefs.sidebar, key) } });
  }, [prefs.sidebar, patchPrefs]);

  /* ── search ── */
  const q = query.trim().toLowerCase();
  const match = useCallback((name: string) => !q || (name || "Untitled").toLowerCase().includes(q), [q]);
  const tableRows = useMemo(() => (tables ?? []).filter((t) => match(t.name)), [tables, match]);
  const formRows = useMemo(() => (forms ?? []).filter((f) => match(f.name)), [forms, match]);
  const favRows = useMemo(() => (favorites ?? []).filter((f) => match(f.name)), [favorites, match]);
  // Searching shows every match; at rest a long section collapses at 20. The
  // object open right now always keeps its row (appended past the 20), so
  // the route's active row exists in its section (spec section 1: the
  // table's row in TABLES, the form's row in FORMS).
  const withActive = <T extends { id: string }>(all: T[], shown: T[], prefix: string): T[] => {
    const open = all.find((x) => pathname === `${prefix}${x.id}`);
    return open && !shown.includes(open) ? [...shown, open] : shown;
  };
  const tableShown = q ? tableRows : withActive(tableRows, tableRows.slice(0, COLLAPSE_AT), "/tables/");
  const formShown = q || (isGuest && guestFormsExpanded)
    ? formRows
    : withActive(formRows, formRows.slice(0, COLLAPSE_AT), "/forms/");
  // /forms/[id] (and its respond page) with no FORMS row for the form: the
  // fallback active row is "All forms" (spec section 2 /forms/[id]).
  const formPathId = pathname.match(/^\/forms\/([^/?#]+)/)?.[1] ?? null;
  const formRowListed = !!formPathId && formShown.some((f) => f.id === formPathId);
  const allFormsActive = activeHubHref === "/forms" || (!!formPathId && !formRowListed);

  const tableMenu = useTableRowMenu();
  const formMenu = useFormRowMenu();
  const [favMenu, setFavMenu] = useState<{ row: FavoriteRow; anchor: RefObject<HTMLElement | null> } | null>(null);

  const moreButton = (label: string, onOpen: (e: React.MouseEvent) => void) => (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(e); }}
      aria-label={label}
      aria-haspopup="menu"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex flex-col">
      {/* Rows 1 and 2: no section label (sidebar-map 1.2 rule 2). */}
      <ul className="flex flex-col gap-0.5">
        {/* A Guest sees "All tables" only while a table is shared with them:
            with none, /tables is the shell 404 for them (spec 1 Access). */}
        {tablesOn && (!isGuest || (tables?.length ?? 0) > 0) && match("All tables") ? <SidebarRow href="/tables" label="All tables" icon={LayoutGrid} active={activeHubHref === "/tables"} /> : null}
        {/* A Guest has no /forms list (FormsListGate 404s it); their own
            forms, the only ones they hold, are still listed under FORMS. */}
        {!isGuest && match("All forms") ? <SidebarRow href="/forms" label="All forms" icon={ClipboardList} active={allFormsActive} /> : null}
      </ul>

      {/* FAVORITES renders only when it has rows (design 4.2). A starred
          object's row is active here too while it is open (spec section 2
          /tables/[id]: "in TABLES (and in FAVORITES when starred)"). */}
      {favError ? (
        <>
          <SidebarSectionLabel collapsed={favCollapsed} onToggle={() => toggleSection(FAV_KEY)}>Favorites</SidebarSectionLabel>
          {!favCollapsed ? <ul><SidebarErrorLine what="favorites" onRetry={() => void loadFavorites()} /></ul> : null}
        </>
      ) : favRows.length > 0 ? (
        <>
          <SidebarSectionLabel collapsed={favCollapsed} onToggle={() => toggleSection(FAV_KEY)}>Favorites</SidebarSectionLabel>
          {!favCollapsed ? (
            <ul className="flex flex-col gap-0.5">
              {favRows.map((f) => (
                <SidebarRow
                  key={`${f.kind}-${f.id}`}
                  href={f.href}
                  label={f.name || (f.kind === "form" ? "Untitled form" : "Untitled table")}
                  icon={f.kind === "form" ? ClipboardList : Table2}
                  active={pathname === f.href}
                  trailing={moreButton(`Actions for ${f.name || "Untitled"}`, (e) => setFavMenu({ row: f, anchor: { current: e.currentTarget as HTMLElement } }))}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {tablesOn ? (
        <>
          <SidebarSectionLabel collapsed={tablesCollapsed} onToggle={() => toggleSection(TABLES_KEY)}>Tables</SidebarSectionLabel>
          {!tablesCollapsed ? (
            <ul className="flex flex-col gap-0.5">
              {tablesError ? (
                <SidebarErrorLine what="tables" onRetry={() => void loadTables()} />
              ) : tables === null ? (
                <SidebarSkeletonRows />
              ) : tableRows.length === 0 && q ? (
                <SidebarEmptyLine>No tables match</SidebarEmptyLine>
              ) : (
                <>
                  {tableShown.map((t) => (
                      <SidebarRow
                        key={t.id}
                        onContextMenu={(e) => tableMenu.open(e, { id: t.id, name: t.name, spaceId: t.spaceId ?? null, isPublic: t.isPublic, canManage: t.canManage })}
                        href={`/tables/${t.id}`}
                        label={t.name || "Untitled table"}
                        icon={Table2}
                        active={pathname === `/tables/${t.id}`}
                        trailing={moreButton(`Actions for ${t.name || "Untitled table"}`, (e) => tableMenu.open(e, { id: t.id, name: t.name, spaceId: t.spaceId ?? null, isPublic: t.isPublic, canManage: t.canManage }))}
                      />
                  ))}
                  {!q && tableRows.length > COLLAPSE_AT ? <SidebarGhostRow href="/tables" label={`Show all (${tableRows.length})`} /> : null}
                  {!isGuest && !q ? <SidebarGhostRow label="New table" icon={Plus} onClick={() => void newTable()} /> : null}
                </>
              )}
            </ul>
          ) : null}
        </>
      ) : null}

      <SidebarSectionLabel collapsed={formsCollapsed} onToggle={() => toggleSection(FORMS_KEY)}>Forms</SidebarSectionLabel>
      {!formsCollapsed ? (
        <ul className="flex flex-col gap-0.5">
          {formsError ? (
            <SidebarErrorLine what="forms" onRetry={() => void loadForms()} />
          ) : forms === null ? (
            <SidebarSkeletonRows />
          ) : formRows.length === 0 && q ? (
            <SidebarEmptyLine>No forms match</SidebarEmptyLine>
          ) : (
            <>
              {formShown.map((f) => (
                  <SidebarRow
                    key={f.id}
                    onContextMenu={(e) => formMenu.open(e, { id: f.id, name: f.name, isPublic: f.isPublic, canManage: f.canManage, responseCount: f.submissionCount })}
                    href={`/forms/${f.id}`}
                    label={f.name || "Untitled form"}
                    icon={ClipboardList}
                    active={pathname === `/forms/${f.id}`}
                    count={f.submissionCount ?? null}
                    trailing={moreButton(`Actions for ${f.name || "Untitled form"}`, (e) => formMenu.open(e, { id: f.id, name: f.name, isPublic: f.isPublic, canManage: f.canManage, responseCount: f.submissionCount }))}
                  />
              ))}
              {!isGuest && !q && formRows.length > COLLAPSE_AT ? <SidebarGhostRow href="/forms" label={`Show all (${formRows.length})`} /> : null}
              {isGuest && !q && formRows.length > COLLAPSE_AT ? (
                <SidebarGhostRow
                  label={guestFormsExpanded ? "Show fewer" : `Show all (${formRows.length})`}
                  onClick={() => setGuestFormsExpanded((v) => !v)}
                />
              ) : null}
              {!isGuest && !q ? <SidebarGhostRow label="New form" icon={Plus} onClick={() => void newForm()} /> : null}
            </>
          )}
        </ul>
      ) : null}

      <TableRowMenuHost menu={tableMenu} context="tree" onChanged={() => { void loadTables(); void loadFavorites(); }} />
      <FormRowMenuHost menu={formMenu} context="tree" onChanged={() => { void loadForms(); void loadFavorites(); }} />
      {favMenu ? <FavoriteMenu row={favMenu.row} anchor={favMenu.anchor} onClose={() => setFavMenu(null)} onChanged={() => void loadFavorites()} /> : null}
      {tablesOn ? <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={({ tableId, created }) => { void loadTables(); if (created) router.push(`/tables/${tableId}`); }} /> : null}
    </div>
  );
}

/** The FAVORITES row "...": Remove from favorites, Copy link (sidebar-map 7 row 3). */
function FavoriteMenu({ row, anchor, onClose, onChanged }: {
  row: FavoriteRow;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  async function unstar() {
    const r = row.kind === "form"
      ? await apiFetch("/api/me/favorites/forms", { method: "POST", json: { formId: row.id, on: false } })
      : await apiFetch("/api/me/favorites/tables", { method: "POST", json: { tableId: row.id, on: false } });
    if (r.ok) {
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged();
      toast("Removed from favorites");
    } else toast("Couldn't update favorites", { tone: "danger" });
    onClose();
  }
  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}${row.href}`).then(() => toast("Link copied"), () => toast("Couldn't copy link", { tone: "danger" }));
    onClose();
  }
  return (
    <MorePortal anchorRef={anchor} width={220} open placement="below" onClose={onClose}>
      <MenuList aria-label={`Actions for ${row.name || "Untitled"}`}>
        <MenuItem icon={Star} iconFilled label="Remove from favorites" onClick={() => void unstar()} />
        <MenuItem icon={Link2} label="Copy link" onClick={copyLink} />
      </MenuList>
    </MorePortal>
  );
}
