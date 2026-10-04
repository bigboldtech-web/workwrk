"use client";

// Tools (spec-tools-misc 2.1): the apps the company pays for, and the saved
// login for the ones you may use. Every Member reads the tools shared with
// them; the tool admins see every tool; a manager adds tools and manages the
// ones they added (src/lib/tools/tool-access.ts).
//
// What changed: one Add tool modal (name, website, category, icon,
// description, and a login) replaces the two chained prompts that always
// wrote "Uncategorized". A drawer at /tools?tool=<id> replaces the
// hand-rolled overlay, and it is where the fields, the login (shown, copied,
// changed), sharing (the share routes' first caller) and Delete live. Delete
// moves the tool to Trash with its shares instead of erasing it. The KPI
// tiles (one of them, "With creds", counted shares, not logins) and the
// Settings header link go. Search is ?q= on the API instead of a filter over
// one loaded page. Every filter, the sort and the view live in the URL (one
// setParams patch, so Clear all clears all); the Category rows come from
// GET /api/tools/categories, not from the rows on screen; the tool admins
// get a checkbox column with Share, Change category and Delete, a card
// footer, and Export CSV in the "…" square; the drawer's autosaving fields
// carry an AutosaveIndicator, and a Can view holder's banner names the
// person to ask, with a Request link into the access request flow.
//
// While the one share dialog serves tools (ACCESS_V2_TABLES on, batch 7) a
// share carries a role: the drawer header's Share (Full access) or role chip
// opens the one dialog, the row menu's Share opens it too, and Can edit
// opens the fields and the login. With the flag off every share is Can view
// and the drawer keeps its own Who has access section, as before.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ExternalLink, KeyRound, Eye, EyeOff, Copy, Plus, Link2, X, Trash2, UserPlus, ChevronDown, Download, Tag, MoreHorizontal, PanelRight,
} from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Drawer } from "@/components/ui/drawer";
import { Picker } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { SkeletonLines } from "@/components/ui/skeleton";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { useShortcut } from "@/lib/shortcuts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { ShareDialog } from "@/components/access/share-dialog";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

type Person = { id: string; name: string; avatar?: string | null };
type ToolRow = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  category: string | null;
  addedBy: string;
  createdAt: string;
  hasLogin: boolean;
  /** Share it and delete it (Full access). */
  canManage: boolean;
  /** Change it: only while the roles are on (the flag); otherwise canManage decides. */
  canEdit?: boolean;
  sharedAt: string | null;
  addedByPerson: Person | null;
  sharedWith: Person[];
  shareCount: number;
};
type Credentials = { username?: string; password?: string; apiKey?: string; notes?: string };
type ToolDetail = Omit<ToolRow, "sharedWith" | "shareCount" | "sharedAt"> & {
  credentials: Credentials | null;
  /** The viewer's role: only while the roles are on (the flag). */
  role?: "FULL" | "EDIT" | "VIEW" | null;
  shares: Array<{ userId: string; sharedAt: string; name: string; avatar: string | null; role?: "FULL" | "EDIT" | "VIEW" | null }>;
};

/** Change it: Can edit and up while the roles are on; otherwise whoever manages it. */
const editsTool = (t: { canManage: boolean; canEdit?: boolean }) => t.canEdit ?? t.canManage;

const LOGIN_FIELDS: Array<{ key: keyof Credentials; label: string; secret: boolean }> = [
  { key: "username", label: "Username", secret: false },
  { key: "password", label: "Password", secret: true },
  { key: "apiKey", label: "API key", secret: true },
  { key: "notes", label: "Notes", secret: false },
];

const splitName = (name: string) => {
  const [firstName, ...rest] = name.split(" ");
  return { firstName, lastName: rest.join(" ") };
};

export default function ToolsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();

  const openId = sp?.get("tool") ?? null;
  const q = sp?.get("q") ?? "";
  const category = sp?.get("category") ?? "";
  const hasLogin = sp?.get("hasLogin") ?? "";
  const sort = (sp?.get("sort") ?? "recent") as "recent" | "name" | "category";
  const view: "all" | "shared" = sp?.get("view") === "shared" ? "shared" : "all";
  const [draftQ, setDraftQ] = useState(q);
  const [filterOpen, setFilterOpen] = useState(Boolean(q || category || hasLogin));
  const [sortOpen, setSortOpen] = useState(false);
  const [rows, setRows] = useState<ToolRow[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkShareOpen, setBulkShareOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [canAdd, setCanAdd] = useState(false);
  const [seesAll, setSeesAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The row "..." (spec-tools-misc 2.1): Open, Open website, Share, Change
  // category, Copy link, then Delete; only on a row the viewer manages.
  const [menu, setMenu] = useState<{ tool: ToolRow; anchor: RefObject<HTMLElement | null> } | null>(null);
  const shareOpen = sp?.get("share") === "1";
  // The one share dialog for a row's Share while it serves tools (the flag).
  const objectShare = !!boot.org.objectShare;
  const [shareFor, setShareFor] = useState<{ id: string; name: string } | null>(null);

  // One patch per change. Three calls in a row would each rebuild the URL
  // from the same stale search params and only the last would land.
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);
  const setParam = useCallback((key: string, value: string | null) => setParams({ [key]: value }), [setParams]);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParam("q", draftQ.trim() || null), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParam]);
  useShortcut({ id: "tools.search", keys: "/", label: "Search tools", scope: "page", group: "On this page", run: (e) => {
    e.preventDefault();
    setFilterOpen(true);
    requestAnimationFrame(() => (document.querySelector(".os-filter-panel input[type=search]") as HTMLInputElement | null)?.focus());
  } });

  const load = useCallback(async () => {
    const r = await apiFetch<{ tools: ToolRow[]; canAdd: boolean; seesAll: boolean }>(`/api/tools${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows(r.data.tools);
    setCanAdd(r.data.canAdd);
    setSeesAll(r.data.seesAll);
    // The org's categories, not the categories of the rows on screen, so the
    // group never vanishes when a search narrows the list to nothing.
    const c = await apiFetch<{ categories: string[] }>("/api/tools/categories", { cache: "no-store" });
    if (c.ok) setCategories(c.data.categories);
  }, [q]);
  const version = rowVersion("tools");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load, version]);

  const activeFilters = (q ? 1 : 0) + (category ? 1 : 0) + (hasLogin ? 1 : 0);
  const clearFilters = () => { setDraftQ(""); setParams({ q: null, category: null, hasLogin: null }); };
  const exportHref = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (hasLogin) params.set("hasLogin", hasLogin);
    return `/api/export/tools?${params}`;
  };

  // The bulk bar (tool admins): every id is a row the viewer may manage.
  async function bulk(op: "category" | "delete" | "share", value?: string | null) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (op === "delete") {
      const ok = await confirm({
        title: `Delete ${ids.length} ${ids.length === 1 ? "tool" : "tools"}?`,
        description: `They move to Trash with their saved logins and shares. Restore them from Trash within ${boot.org.trashDays} days to bring all of it back.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
    }
    const r = await apiFetch<{ done: number; failed: number }>("/api/tools/bulk", { method: "POST", json: { op, ids, value } });
    if (!r.ok) { toast(r.error || "Couldn't change those tools", { tone: "danger" }); return; }
    if (r.data.failed > 0) toast(`Changed ${r.data.done} of ${ids.length}. ${r.data.failed} couldn't be changed.`, { tone: "danger" });
    else toast(op === "delete" ? `${r.data.done} moved to Trash` : op === "share" ? "Shared" : "Category changed");
    setSelected(new Set());
    void load();
  }
  async function bulkCategory(value: string) {
    setBulkCategoryOpen(false);
    if (value === "__new__") {
      const name = await prompt({ title: "New category", placeholder: "Design, Finance, Sales", submitLabel: "Change", required: true });
      if (!name || !name.trim()) return;
      void bulk("category", name.trim().slice(0, 60));
      return;
    }
    void bulk("category", value === "__none__" ? null : value);
  }
  // One row's actions from its "..." menu: the same routes the drawer and
  // the bulk bar use, so a right the API refuses is a toast, never a dead row.
  async function rowCategory(t: ToolRow, value: string) {
    let category: string | null = value === "__none__" ? null : value;
    if (value === "__new__") {
      const name = await prompt({ title: "New category", placeholder: "Design, Finance, Sales", submitLabel: "Change", required: true });
      if (!name || !name.trim()) return;
      category = name.trim().slice(0, 60);
    }
    const r = await apiFetch(`/api/tools/${t.id}`, { method: "PATCH", json: { category } });
    if (!r.ok) { toast(r.status === 403 ? "You can't change this tool." : (r.error || "Couldn't change the category"), { tone: "danger", action: { label: "Try again", onClick: () => void rowCategory(t, value) } }); return; }
    toast("Category changed");
    void load();
  }
  async function rowDelete(t: ToolRow) {
    const ok = await confirm({
      title: `Delete ${t.name}?`,
      description: `It moves to Trash with its saved login and its shares, and the people it was shared with lose it. Restore it from Trash within ${boot.org.trashDays} days to bring all of it back.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/tools/${t.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the tool", { tone: "danger", action: { label: "Try again", onClick: () => void rowDelete(t) } }); return; }
    toast(`${t.name} moved to Trash`);
    if (openId === t.id) setParam("tool", null);
    void load();
  }
  async function rowCopyLink(t: ToolRow) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/tools?tool=${t.id}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  }
  const websiteHref = (t: ToolRow) => (t.url ? (t.url.startsWith("http") ? t.url : `https://${t.url}`) : null);

  const shown = useMemo(() => {
    if (!rows) return null;
    let list = view === "shared" ? rows.filter((r) => r.sharedAt) : rows;
    if (category) list = list.filter((r) => r.category === category);
    if (hasLogin) list = list.filter((r) => (hasLogin === "yes" ? r.hasLogin : !r.hasLogin));
    if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "category") list = [...list].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
    return list;
  }, [rows, view, category, hasLogin, sort]);
  const SORTS = [{ value: "recent", label: "Recently added" }, { value: "name", label: "Name A to Z" }, { value: "category", label: "Category" }];

  const columns = useMemo<TableColumn<ToolRow>[]>(() => [
    { key: "name", label: "Name", title: true, width: "minmax(220px,1.4fr)", render: (t) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" icon={t.icon || null} name={t.name} {...NEUTRAL_TILE} />
        <span className="truncate">{t.name}</span>
      </span>
    ) },
    { key: "category", label: "Category", width: "160px", render: (t) => t.category
      ? <span className="inline-flex h-6 max-w-full items-center truncate rounded-md bg-hover px-2 text-xs font-medium text-ink-2">{t.category}</span>
      : <span className="text-sm text-ink-2">No category</span> },
    { key: "login", label: "Login", width: "120px", render: (t) => t.hasLogin
      ? <span className="inline-flex items-center gap-1.5 text-sm text-ink"><KeyRound className="h-3 w-3" aria-hidden />Saved</span>
      : <span className="text-sm text-ink-2">None</span> },
    { key: "shared", label: "Shared with", width: "150px", hideBelow: 760, render: (t) => t.sharedWith.length > 0
      ? <AvatarStack size={20} max={3} people={t.sharedWith.map((p) => ({ id: p.id, avatar: p.avatar, ...splitName(p.name) }))} />
      : <span className="text-sm text-ink-2">{t.shareCount > 0 ? `${t.shareCount} ${t.shareCount === 1 ? "person" : "people"}` : "Not shared"}</span> },
    { key: "added", label: "Added", width: "120px", hideBelow: 680, render: (t) => (
      <span className="text-sm text-ink-2" title={t.addedByPerson ? `Added by ${t.addedByPerson.name}` : undefined}>{formatRelative(t.createdAt, datePrefs)}</span>
    ) },
  ], [datePrefs]);

  return (
    <>
      <OsPageHeader
        title="Tools"
        views={seesAll ? (
          <>
            <ViewTab label="All tools" active={view === "all"} onClick={() => setParam("view", null)} />
            <ViewTab label="Shared with me" active={view === "shared"} onClick={() => setParam("view", "shared")} />
          </>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          sort: { onClick: () => setSortOpen((v) => !v), label: sort === "recent" ? "Sort" : SORTS.find((x) => x.value === sort)?.label, active: sort !== "recent" },
          primary: canAdd ? { label: "Add tool", icon: Plus, onClick: () => setAddOpen(true) } : undefined,
          // Export CSV: the tool admins, never an Agent (the export rule).
          menu: seesAll && !boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref(); } }] : undefined,
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort tools" selected={sort}
              sections={[{ options: SORTS }]}
              onSelect={(v) => { setSortOpen(false); setParam("sort", v === "recent" ? null : v); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="tools"
          activeCount={activeFilters}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search tools" }}
        >
          {categories.length > 0 ? (
            <FilterGroup label="Category">
              {categories.map((c) => (
                <FilterRow key={c} label={c} checked={category === c} onCheckedChange={(on) => setParam("category", on ? c : null)} />
              ))}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Has a login">
            <FilterRow label="Yes" checked={hasLogin === "yes"} onCheckedChange={(on) => setParam("hasLogin", on ? "yes" : null)} />
            <FilterRow label="No" checked={hasLogin === "no"} onCheckedChange={(on) => setParam("hasLogin", on ? "no" : null)} />
          </FilterGroup>
        </FilterPanel>
        <div className="min-w-0 flex-1">
        {error ? (
          <OsEmptyView variant="error" title="Couldn't load Tools" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : shown && shown.length === 0 && activeFilters === 0 ? (
          <OsEmptyView title={view === "shared" || !canAdd ? "No tools shared with you yet." : "No tools yet"} />
        ) : (
          <TableCard
            ariaLabel="Tools"
            columns={columns}
            rows={shown}
            rowKey={(t) => t.id}
            onRowClick={(t) => setParam("tool", t.id)}
            highlightKey={openId}
            empty={<span className="text-row text-ink-2">No results · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>}
            selectable={seesAll}
            isRowSelectable={(t) => t.canManage}
            selected={selected}
            onSelectedChange={setSelected}
            footer={shown ? { total: shown.length, noun: "records", from: shown.length ? 1 : 0, to: shown.length } : undefined}
            bulkActions={seesAll ? (
              <>
                <BulkShare open={bulkShareOpen} onOpenChange={setBulkShareOpen} onPick={(id) => { setBulkShareOpen(false); void bulk("share", id); }} />
                <div className="relative">
                  <BulkButton icon={Tag} label="Change category" onClick={() => setBulkCategoryOpen((v) => !v)} />
                  <Picker
                    open={bulkCategoryOpen}
                    onClose={() => setBulkCategoryOpen(false)}
                    side="top"
                    ariaLabel="Change category"
                    sections={[{ options: [
                      ...categories.map((c) => ({ value: c, label: c })),
                      { value: "__none__", label: "No category" },
                      { value: "__new__", label: "New category…" },
                    ] }]}
                    onSelect={(v) => void bulkCategory(v)}
                    className="absolute bottom-10 start-0 z-50"
                  />
                </div>
                <BulkButton icon={Trash2} label="Delete" destructive onClick={() => void bulk("delete")} />
              </>
            ) : undefined}
            rowMenu={(t) => editsTool(t) ? (
              <button
                type="button"
                aria-label={`Actions for ${t.name}`}
                aria-haspopup="menu"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ tool: t, anchor: { current: e.currentTarget } }); }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            ) : t.url ? (
              <a
                href={websiteHref(t) ?? undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open ${t.name} website`}
                title="Open website"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          />
        )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.tool.name}`}>
            <MenuItem icon={PanelRight} label="Open" onClick={() => { const t = menu.tool; setMenu(null); setParams({ tool: t.id, share: null }); }} />
            {websiteHref(menu.tool) ? (
              <MenuItem icon={ExternalLink} label="Open website" onClick={() => { const href = websiteHref(menu.tool); setMenu(null); if (href) window.open(href, "_blank", "noopener,noreferrer"); }} />
            ) : null}
            {menu.tool.canManage ? (
              <MenuItem icon={UserPlus} label="Share" onClick={() => { const t = menu.tool; setMenu(null); if (objectShare) setShareFor({ id: t.id, name: t.name }); else setParams({ tool: t.id, share: "1" }); }} />
            ) : null}
            <MenuSubmenu icon={Tag} label="Change category">
              {categories.map((c) => (
                <MenuItem key={c} label={c} onClick={() => { const t = menu.tool; setMenu(null); void rowCategory(t, c); }} />
              ))}
              <MenuItem label="No category" onClick={() => { const t = menu.tool; setMenu(null); void rowCategory(t, "__none__"); }} />
              <MenuItem label="New category…" onClick={() => { const t = menu.tool; setMenu(null); void rowCategory(t, "__new__"); }} />
            </MenuSubmenu>
            <MenuItem icon={Link2} label="Copy link" onClick={() => { const t = menu.tool; setMenu(null); void rowCopyLink(t); }} />
            {menu.tool.canManage ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { const t = menu.tool; setMenu(null); void rowDelete(t); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      <ToolDrawer id={openId} shareOpen={shareOpen} onClose={() => setParams({ tool: null, share: null })} onChanged={() => void load()} />
      {objectShare ? (
        <ShareDialog
          open={!!shareFor}
          onOpenChange={(o) => { if (!o) setShareFor(null); }}
          target={shareFor ? { kind: "tool", id: shareFor.id, name: shareFor.name } : null}
          onChanged={() => void load()}
        />
      ) : null}
      {addOpen ? <AddToolDialog onClose={() => setAddOpen(false)} onAdded={(id) => { setAddOpen(false); void load(); setParam("tool", id); }} /> : null}
    </>
  );
}

function BulkButton({ icon: Icon, label, onClick, destructive }: { icon: typeof Plus; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-hover ${destructive ? "text-danger-text" : "text-ink"}`}>
      <Icon className="h-4 w-4" aria-hidden />{label}
    </button>
  );
}

/** The bulk bar's Share: a people picker over GET /api/people/pick. */
function BulkShare({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (userId: string) => void }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await apiFetch<{ people: Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null }> }>(`/api/people/pick?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      setLoading(false);
      if (r.ok) setOptions(r.data.people.map((p) => ({ id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone", email: p.email })));
    }, 200);
    return () => clearTimeout(t);
  }, [open, query]);
  return (
    <div className="relative">
      <BulkButton icon={UserPlus} label="Share" onClick={() => onOpenChange(!open)} />
      <Picker
        open={open}
        onClose={() => onOpenChange(false)}
        side="top"
        alwaysSearch
        onSearchChange={setQuery}
        loading={loading}
        searchPlaceholder="Search people"
        ariaLabel="Share with"
        sections={[{ options: options.map((p) => ({ value: p.id, label: p.name, description: p.email ?? undefined, keywords: p.email ?? undefined })) }]}
        onSelect={onPick}
        className="absolute bottom-10 start-0 z-50"
      />
    </div>
  );
}

/* ─────────────────────────── the drawer ─────────────────────────── */

function ToolDrawer({ id, shareOpen, onClose, onChanged }: { id: string | null; shareOpen?: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [loginDraft, setLoginDraft] = useState<Credentials | null>(null);
  // The fields autosave on blur (design 5.17): every save is visible.
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [requested, setRequested] = useState(false);
  // The one share dialog while it serves tools (the flag): "share" for Full
  // access, "who" (read only) for everyone else.
  const objectShare = !!boot.org.objectShare;
  const [shareMode, setShareMode] = useState<"share" | "who" | null>(null);

  const load = useCallback(async (toolId: string) => {
    const r = await apiFetch<{ tool: ToolDetail }>(`/api/tools/${toolId}`, { cache: "no-store" });
    if (!r.ok) { if (r.status === 404) setMissing(true); else setError(true); return; }
    setMissing(false);
    setError(false);
    setTool(r.data.tool);
  }, []);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => { setTool(null); setShown({}); setLoginDraft(null); void load(id); }, 0);
    return () => clearTimeout(t);
  }, [id, load]);

  async function patch(body: Record<string, unknown>, done?: string) {
    if (!tool) return false;
    setSaveStatus("saving");
    const r = await apiFetch(`/api/tools/${tool.id}`, { method: "PATCH", json: body });
    if (!r.ok) {
      setSaveStatus("error");
      toast(r.error || "Couldn't save the change", { tone: "danger", action: { label: "Try again", onClick: () => void patch(body, done) } });
      return false;
    }
    setSaveStatus("saved");
    setLastSavedAt(new Date());
    if (done) toast(done);
    await load(tool.id);
    onChanged();
    return true;
  }

  // The Can view holder's Request (spec-tools-misc 2.1, access 5.6): one
  // inbox row for whoever added the tool.
  async function requestAccess() {
    if (!tool) return;
    const r = await apiFetch<{ notified: number; throttled?: boolean }>("/api/access-requests", { method: "POST", json: { objectType: "tool", objectId: tool.id, role: "EDIT" } });
    if (!r.ok) { toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    setRequested(true);
    toast(r.data.throttled ? "Already asked today. They have your request." : "Request sent");
  }

  async function remove() {
    if (!tool) return;
    const ok = await confirm({
      title: `Delete ${tool.name}?`,
      description: `It moves to Trash with its saved login and its shares, and the people it was shared with lose it. Restore it from Trash within ${boot.org.trashDays} days to bring all of it back.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/tools/${tool.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the tool", { tone: "danger" }); return; }
    toast(`${tool.name} moved to Trash`);
    onChanged();
    onClose();
  }

  async function copy(value: string, what: string) {
    try { await navigator.clipboard.writeText(value); toast(`${what} copied`); } catch { toast(`Couldn't copy the ${what.toLowerCase()}`, { tone: "danger" }); }
  }

  const manage = tool?.canManage ?? false;
  const edit = tool ? editsTool(tool) : false;
  const creds = tool?.credentials ?? {};
  // The row menu's Share (?share=1) opens the one dialog once the tool loads.
  const toolId = tool?.id ?? null;
  useEffect(() => {
    if (!objectShare || !shareOpen || !toolId || !manage) return;
    const t = setTimeout(() => setShareMode("share"), 0);
    return () => clearTimeout(t);
  }, [objectShare, shareOpen, toolId, manage]);

  return (
    <>
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      ariaLabel="Tool"
      layerId="tool-drawer"
      header={
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Tools › <span className="text-ink">{tool?.name ?? ""}</span></span>
          {tool ? (
            <button type="button" aria-label="Copy link" title="Copy link" onClick={() => void copy(`${window.location.origin}/tools?tool=${tool.id}`, "Link")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
              <Link2 className="h-4 w-4" />
            </button>
          ) : null}
          {tool && edit ? <AutosaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} /> : null}
          {tool && objectShare ? (
            <ShareOrRoleChip role={tool.role ?? (manage ? "FULL" : "VIEW")} onOpen={(m) => setShareMode(m)} />
          ) : tool && !manage ? <span className="inline-flex h-6 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink-2">Can view</span> : null}
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      {missing ? (
        <OsEmptyView title="This tool isn't here any more, or it isn't shared with you." compact />
      ) : error ? (
        <OsEmptyView variant="error" title="Couldn't load this tool" action={{ label: "Try again", onClick: () => id && void load(id) }} compact />
      ) : !tool ? (
        <div className="p-4"><SkeletonLines lines={6} /></div>
      ) : (
        <div className="flex flex-col gap-6 p-4">
          {!edit ? (
            <div className="flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">
              <span className="min-w-0 flex-1">View only. Ask {tool.addedByPerson?.name ?? "whoever added it"} for edit access.</span>
              {requested ? <span className="shrink-0 text-ink-3">Requested</span> : (
                <button type="button" onClick={() => void requestAccess()} className="shrink-0 font-medium text-brand-deep hover:underline">Request</button>
              )}
            </div>
          ) : null}

          <section className="flex flex-col">
            <FieldRow label="Name" value={tool.name} editable={edit} onSave={(v) => patch({ name: v })} required />
            <FieldRow label="Website" value={tool.url ?? ""} editable={edit} onSave={(v) => patch({ url: v })} placeholder="https://" />
            <FieldRow label="Category" value={tool.category ?? ""} editable={edit} onSave={(v) => patch({ category: v })} placeholder="No category" />
            <FieldRow label="Icon" value={tool.icon ?? ""} editable={edit} onSave={(v) => patch({ icon: v })} placeholder="An emoji" />
            <FieldRow label="Description" value={tool.description ?? ""} editable={edit} onSave={(v) => patch({ description: v })} multiline />
          </section>

          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Login</h3>
              {edit && !loginDraft ? (
                <button type="button" onClick={() => setLoginDraft({ ...creds })} className="text-sm font-medium text-brand-deep hover:underline">Edit</button>
              ) : null}
            </div>
            {loginDraft ? (
              <div className="flex flex-col gap-2">
                {LOGIN_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-medium text-ink-2">{f.label}</span>
                    {f.key === "notes" ? (
                      <textarea value={loginDraft[f.key] ?? ""} onChange={(e) => setLoginDraft({ ...loginDraft, [f.key]: e.target.value })} rows={2} className="min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 py-1 text-base text-ink" />
                    ) : (
                      <input type={f.secret ? "password" : "text"} value={loginDraft[f.key] ?? ""} onChange={(e) => setLoginDraft({ ...loginDraft, [f.key]: e.target.value })} autoComplete="off" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink" />
                    )}
                  </label>
                ))}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setLoginDraft(null)} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
                  <button type="button" onClick={async () => { if (await patch({ credentials: loginDraft }, "Login saved")) setLoginDraft(null); }} className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover">Save login</button>
                </div>
              </div>
            ) : (
              LOGIN_FIELDS.map((f) => {
                const value = creds[f.key];
                return (
                  <div key={f.key} className="flex min-h-9 items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-medium text-ink-2">{f.label}</span>
                    {value ? (
                      <>
                        <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.secret && !shown[f.key] ? "••••••••" : value}</span>
                        {f.secret ? (
                          <button type="button" aria-label={`${shown[f.key] ? "Hide" : "Show"} ${f.label.toLowerCase()}`} title={shown[f.key] ? "Hide" : "Show"} onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                            {shown[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        ) : null}
                        <button type="button" aria-label={`Copy ${f.label.toLowerCase()}`} title="Copy" onClick={() => void copy(value, f.label)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                          <Copy className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <span className="text-ink-3">Not set</span>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {manage && !objectShare ? (
            <ShareSection tool={tool} initialOpen={shareOpen} onChanged={async () => { await load(tool.id); onChanged(); }} />
          ) : null}

          {manage ? (
            <section className="rounded-lg border border-danger-soft p-3">
              <button type="button" onClick={() => void remove()} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-danger-bg">
                <Trash2 className="h-4 w-4" /> Delete tool
              </button>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
    {objectShare && tool ? (
      <ShareDialog
        open={shareMode !== null}
        onOpenChange={(o) => { if (!o) setShareMode(null); }}
        target={{ kind: "tool", id: tool.id, name: tool.name }}
        readOnly={shareMode === "who"}
        onChanged={() => { void load(tool.id); onChanged(); }}
      />
    ) : null}
    </>
  );
}

function FieldRow({ label, value, editable, onSave, placeholder, multiline, required }: {
  label: string;
  value: string;
  editable: boolean;
  onSave: (v: string) => Promise<boolean>;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next === value.trim()) { setDraft(null); return; }
    if (required && !next) { setDraft(null); return; }
    // A failed save keeps the edit on screen (the toast has Try again).
    if (await onSave(next)) setDraft(null);
  };
  return (
    <div className="flex min-h-9 items-start gap-3 py-1 text-sm">
      <span className="w-28 shrink-0 pt-1.5 font-medium text-ink-2">{label}</span>
      {editable ? (
        multiline ? (
          <textarea
            value={draft ?? value}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            rows={3}
            aria-label={label}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base text-ink hover:border-line focus:border-line-strong"
          />
        ) : (
          <input
            value={draft ?? value}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            aria-label={label}
            className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base text-ink hover:border-line focus:border-line-strong"
          />
        )
      ) : (
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1.5 text-base text-ink">{value || <span className="text-ink-3">{placeholder ?? "None"}</span>}</span>
      )}
    </div>
  );
}

function ShareSection({ tool, initialOpen, onChanged }: { tool: ToolDetail; initialOpen?: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useOsToast();
  // Opened by the row menu's Share (?share=1) the people picker is already up.
  const [open, setOpen] = useState(Boolean(initialOpen));
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const exclude = tool.shares.map((s) => s.userId).join(",");
      const r = await apiFetch<{ people: Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null }> }>(`/api/people/pick?q=${encodeURIComponent(query)}&exclude=${exclude}`, { cache: "no-store" });
      setLoading(false);
      if (r.ok) setOptions(r.data.people.map((p) => ({ id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone", email: p.email })));
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, tool.shares]);

  async function share(userId: string) {
    setOpen(false);
    const r = await apiFetch(`/api/tools/${tool.id}/share`, { method: "POST", json: { userIds: [userId] } });
    if (!r.ok) { toast(r.error || "Couldn't share the tool", { tone: "danger" }); return; }
    toast("Shared");
    await onChanged();
  }
  async function unshare(userId: string) {
    const r = await apiFetch(`/api/tools/${tool.id}/share`, { method: "DELETE", json: { userId } });
    if (!r.ok) { toast(r.error || "Couldn't remove access", { tone: "danger" }); return; }
    toast("Access removed");
    await onChanged();
  }

  return (
    <section className="flex flex-col gap-1">
      <div className="relative flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Who has access</h3>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium text-ink hover:bg-hover" aria-haspopup="listbox">
          <UserPlus className="h-4 w-4" /> Share <ChevronDown className="h-3.5 w-3.5 text-ink-2" />
        </button>
        <Picker
          open={open}
          onClose={() => setOpen(false)}
          align="end"
          alwaysSearch
          onSearchChange={setQuery}
          loading={loading}
          searchPlaceholder="Search people"
          ariaLabel="Share with"
          sections={[{ options: options.map((p) => ({ value: p.id, label: p.name, description: p.email ?? undefined, keywords: p.email ?? undefined })) }]}
          onSelect={(v) => void share(v)}
          className="absolute end-0 top-9 z-20"
        />
      </div>
      <p className="text-sm text-ink-2">People you share with can see this tool and its saved login.</p>
      {tool.shares.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">Not shared with anyone yet.</p>
      ) : (
        <ul className="flex flex-col">
          {tool.shares.map((s) => (
            <li key={s.userId} className="flex h-9 items-center gap-2 text-base text-ink">
              <AvatarStack size={24} max={1} people={[{ id: s.userId, avatar: s.avatar, ...splitName(s.name) }]} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs font-medium text-ink-2">Can view</span>
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => void unshare(s.userId)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── Add tool ─────────────────────────── */

function AddToolDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [login, setLogin] = useState<Credentials>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(name || url || category || icon || description || Object.values(login).some(Boolean));

  useEffect(() => {
    void apiFetch<{ categories: string[] }>("/api/tools/categories", { cache: "no-store" }).then((r) => { if (r.ok) setCategories(r.data.categories); });
  }, []);

  async function close() {
    if (dirty && !(await confirm({ title: "Discard this tool?", description: "What you typed here is not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/api/tools", {
      method: "POST",
      json: { name, url, category, icon, description, credentials: Object.values(login).some((v) => v && v.trim()) ? login : undefined },
    });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't add the tool", { tone: "danger" }); return; }
    toast(`${name.trim()} added`);
    onAdded(r.data.id);
  }

  const input = "h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add tool</DialogTitle>
          <DialogDescription>An app the company uses. Share it with the people who need the login.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Name <span className="font-normal text-ink-2">(required)</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Website
            <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" className={input} />
          </label>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Category
              <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} list="tool-categories" placeholder="Pick or type a new one" className={input} />
              <datalist id="tool-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Icon
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="An emoji" className={input} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink" />
          </label>
          <button type="button" onClick={() => setLoginOpen((v) => !v)} aria-expanded={loginOpen} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink">
            <ChevronDown className={`h-4 w-4 transition-transform ${loginOpen ? "" : "-rotate-90"}`} /> Add a login
          </button>
          {loginOpen ? (
            <div className="flex flex-col gap-2">
              {LOGIN_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 font-medium text-ink-2">{f.label}</span>
                  <input type={f.secret ? "password" : "text"} autoComplete="off" value={login[f.key] ?? ""} onChange={(e) => setLogin({ ...login, [f.key]: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink" />
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy || !name.trim()} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">Add tool</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
