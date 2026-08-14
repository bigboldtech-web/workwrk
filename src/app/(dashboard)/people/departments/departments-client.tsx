"use client";

/* People · Departments — bespoke org tree view + full Functions CRUD.
 *
 *  GET    /api/departments
 *  POST   /api/departments        { name, description?, color?, parentId?, headId? }
 *  PUT    /api/departments/[id]    { name?, description?, color?, parentId?, headId? }
 *  DELETE /api/departments/[id]    (server guards: refuses when members > 0)
 *
 * Members for the head picker come from GET /api/users?limit=500.
 * CRUD affordances are gated on the organization.manageDepartments
 * permission (checkPermission over /api/me + /api/permissions) so the
 * page respects the same matrix the rest of the org honours — view stays
 * open, edit/delete/create only for those the matrix allows.
 *
 * Layout:
 *   OsTitleBar with back + nav + New function.
 *   4-tile KPI strip: Departments · Headcount · With head · Vacant head.
 *   Toolbar: search + view toggle (Tree / Grid) + expand all / collapse all.
 *   Tree: indented nested rows with connector lines, color stripe, head avatar,
 *         and a per-row "…" menu (edit / add sub / delete).
 *   Grid: flat card view with the same "…" menu.
 *   DeptDialog: create/edit with name, description, color, head, parent.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2, Plus, Users, ChevronDown, ChevronRight, Search,
  ArrowLeft, UserX, ListTree, LayoutGrid, GraduationCap, Briefcase, Network,
  MoreHorizontal, Pencil, Trash2, CornerDownRight, Check,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { checkPermission, type PermissionMatrix, type AccessLevel } from "@/lib/permissions";

type ApiDept = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  parentId?: string | null;
  head?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
  _count?: { members?: number };
  subDepartments?: ApiDept[];
};

type Member = { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null };

const AV_PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.yellow, C.brown, C.red];
function avColor(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}
function fullName(f?: string | null, l?: string | null) {
  return [f, l].filter(Boolean).join(" ").trim();
}

/** Brand-safe swatches (design-system CSS vars — no banned hues). */
const SWATCHES: { name: string; value: string }[] = [
  { name: "Blue", value: "var(--os-c-blue)" },
  { name: "Brand", value: "var(--os-brand)" },
  { name: "Green", value: "var(--os-c-green)" },
  { name: "Teal", value: "var(--os-c-teal)" },
  { name: "Orange", value: "var(--os-c-orange)" },
  { name: "Yellow", value: "var(--os-c-yellow)" },
  { name: "Brown", value: "var(--os-c-brown)" },
  { name: "Red", value: "var(--os-c-red)" },
];

type ViewMode = "tree" | "grid";

/** Everything the recursive rows need to render CRUD affordances. */
type DeptActions = {
  canManage: boolean;
  onEdit: (d: ApiDept) => void;
  onAddSub: (parentId: string) => void;
  onDelete: (d: ApiDept) => void;
};

// ── descendants of a node (to keep the parent picker acyclic) ──────────
function descendantIds(all: ApiDept[], rootId: string): Set<string> {
  const childrenBy = new Map<string, string[]>();
  for (const d of all) {
    if (d.parentId) {
      const arr = childrenBy.get(d.parentId) ?? [];
      arr.push(d.id);
      childrenBy.set(d.parentId, arr);
    }
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of childrenBy.get(id) ?? []) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return out;
}

type DialogState =
  | { mode: "create"; presetParentId: string | null }
  | { mode: "edit"; dept: ApiDept };

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<ApiDept[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [canManage, setCanManage] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDepts(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Members for the head picker.
  useEffect(() => {
    let alive = true;
    fetch("/api/users?limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.data) setMembers(d.data as Member[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Resolve manage-departments permission from the org matrix.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/permissions").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([me, perms]) => {
      if (!alive) return;
      const level = (me?.user?.accessLevel ?? "") as AccessLevel;
      const matrix = (perms?.matrix ?? null) as PermissionMatrix | null;
      if (!level) return;
      setCanManage(checkPermission(level, matrix, "organization", "manageDepartments"));
    });
    return () => { alive = false; };
  }, []);

  // ─── Build tree from flat list (uses parentId) ────────────
  const tree = useMemo(() => {
    const list = depts ?? [];
    const byId = new Map<string, ApiDept & { children: ApiDept[] }>();
    for (const d of list) byId.set(d.id, { ...d, children: [] });
    const roots: (ApiDept & { children: ApiDept[] })[] = [];
    for (const d of byId.values()) {
      if (d.parentId && byId.has(d.parentId)) {
        byId.get(d.parentId)!.children.push(d);
      } else {
        roots.push(d);
      }
    }
    // Sort children by name
    function sortRec(n: ApiDept & { children: ApiDept[] }) {
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      for (const c of n.children) sortRec(c as ApiDept & { children: ApiDept[] });
    }
    roots.sort((a, b) => a.name.localeCompare(b.name));
    roots.forEach(sortRec);
    return roots;
  }, [depts]);

  // ─── Total headcount including descendants (for tree rollup) ──
  const totalCounts = useMemo(() => {
    const m = new Map<string, number>();
    function rec(node: ApiDept & { children: ApiDept[] }): number {
      const direct = node._count?.members ?? 0;
      let total = direct;
      for (const c of node.children) total += rec(c as ApiDept & { children: ApiDept[] });
      m.set(node.id, total);
      return total;
    }
    for (const r of tree) rec(r);
    return m;
  }, [tree]);

  // ─── Filter (only match nodes that themselves or any descendant match) ──
  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    function match(node: ApiDept): boolean {
      return node.name.toLowerCase().includes(q) ||
        (node.description ?? "").toLowerCase().includes(q) ||
        `${node.head?.firstName ?? ""} ${node.head?.lastName ?? ""}`.toLowerCase().includes(q);
    }
    function filter(node: ApiDept & { children: ApiDept[] }): (ApiDept & { children: ApiDept[] }) | null {
      const filteredChildren = node.children
        .map((c) => filter(c as ApiDept & { children: ApiDept[] }))
        .filter((c): c is ApiDept & { children: ApiDept[] } => c !== null);
      if (filteredChildren.length > 0 || match(node)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }
    return tree.map((r) => filter(r)).filter((r): r is ApiDept & { children: ApiDept[] } => r !== null);
  }, [tree, search]);

  // ─── KPIs ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = depts ?? [];
    const totalHeadcount = list.reduce((acc, d) => acc + (d._count?.members ?? 0), 0);
    const withHead = list.filter((d) => d.head).length;
    return { total: list.length, totalHeadcount, withHead, vacant: list.length - withHead };
  }, [depts]);

  function expandAll() { setCollapsed(new Set()); }
  function collapseAll() {
    const ids = new Set<string>();
    function rec(node: ApiDept & { children: ApiDept[] }) {
      if (node.children.length > 0) ids.add(node.id);
      for (const c of node.children) rec(c as ApiDept & { children: ApiDept[] });
    }
    for (const r of tree) rec(r);
    setCollapsed(ids);
  }
  function toggleNode(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsed(next);
  }

  // ─── CRUD handlers ────────────────────────────────────────
  const openCreate = useCallback((presetParentId: string | null = null) => {
    setDialog({ mode: "create", presetParentId });
  }, []);
  const openEdit = useCallback((dept: ApiDept) => setDialog({ mode: "edit", dept }), []);
  const openAddSub = useCallback((parentId: string) => setDialog({ mode: "create", presetParentId: parentId }), []);

  const deleteDept = useCallback(async (dept: ApiDept) => {
    const count = dept._count?.members ?? 0;
    if (count > 0) {
      toast(`"${dept.name}" has ${count} ${count === 1 ? "person" : "people"} — reassign them before deleting.`);
      return;
    }
    const ok = await confirm({
      title: `Delete "${dept.name}"?`,
      description: "This removes the function. Sub-departments become top-level. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/departments/${dept.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(body?.error ?? `Couldn't delete (HTTP ${res.status})`);
        return;
      }
      toast("Function deleted");
      void load();
    } catch {
      toast("Couldn't delete function");
    }
  }, [confirm, load, toast]);

  const actions: DeptActions = useMemo(
    () => ({ canManage, onEdit: openEdit, onAddSub: openAddSub, onDelete: deleteDept }),
    [canManage, openEdit, openAddSub, deleteDept],
  );

  return (
    <>
      <OsTitleBar
        title="Departments"
        Icon={Building2}
        iconGradient={GRAD.indigoBlue}
        description={depts === null
          ? "Loading org structure…"
          : `${stats.total} department${stats.total === 1 ? "" : "s"} · ${stats.totalHeadcount} people${stats.vacant > 0 ? ` · ${stats.vacant} need head` : ""}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={Math.max(0, stats.total - 3)}
        actions={
          <div className="dept__head-actions">
            <button type="button" className="dept__back" onClick={() => history.back()}>
              <ArrowLeft /> People
            </button>
            <Link href="/people/roles" className="dept__nav-link"><Briefcase /> Roles</Link>
            <Link href="/people/skills" className="dept__nav-link"><GraduationCap /> Skills</Link>
            {canManage && (
              <button type="button" className="dept__btn-primary" onClick={() => openCreate(null)}>
                <Plus /> New department
              </button>
            )}
          </div>
        }
      />

      <div className="dept">
        {/* KPIs */}
        <div className="dept__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Building2} label="Departments"  value={`${stats.total}`}        sub="org units" />
          <KpiTile accent="var(--os-brand)" Icon={Users}     label="Headcount"    value={`${stats.totalHeadcount}`} sub="across all depts" />
          <KpiTile accent="var(--os-c-green)"  Icon={Network}   label="With head"    value={`${stats.withHead}`}     sub="leadership in place" />
          <KpiTile accent={stats.vacant > 0 ? "var(--os-c-orange)" : "var(--os-c-green)"}
                   Icon={UserX} label="Vacant head" value={`${stats.vacant}`} sub={stats.vacant > 0 ? "need a leader" : "all departments led"} />
        </div>

        {/* Toolbar */}
        <div className="dept__toolbar">
          <div className="dept__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search department, head, description…"
              aria-label="Search departments"
            />
          </div>
          <div className="dept__view-tabs">
            <button type="button" className={viewMode === "tree" ? "is-active" : ""} onClick={() => setViewMode("tree")}>
              <ListTree /> Tree
            </button>
            <button type="button" className={viewMode === "grid" ? "is-active" : ""} onClick={() => setViewMode("grid")}>
              <LayoutGrid /> Grid
            </button>
          </div>
          {viewMode === "tree" && tree.length > 0 && (
            <div className="dept__expand-row">
              <button type="button" className="dept__expand-btn" onClick={expandAll}>Expand all</button>
              <button type="button" className="dept__expand-btn" onClick={collapseAll}>Collapse all</button>
            </div>
          )}
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Building2} iconGradient={GRAD.redPink} title="Couldn't load departments" subtitle={`API error: ${loadError}.`} cta="Retry" onCta={() => void load()} />
        ) : depts === null ? (
          <div className="dept__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Building2}
            iconGradient="#0073EA"
            title="No departments yet"
            subtitle="Departments organize your people and route policies and announcements. Create your first one to get started."
            cta="New department"
            onCta={() => openCreate(null)}
            hideCta={!canManage}
          />
        ) : filteredTree.length === 0 ? (
          <div className="dept__empty">
            <Search />
            <div>No departments match &quot;{search}&quot;.</div>
            <button type="button" className="dept__empty-reset" onClick={() => setSearch("")}>Clear search</button>
          </div>
        ) : viewMode === "tree" ? (
          <div className="dept__tree">
            {filteredTree.map((d) => (
              <TreeNode
                key={d.id}
                node={d as ApiDept & { children: ApiDept[] }}
                depth={0}
                collapsed={collapsed}
                toggleNode={toggleNode}
                totalCounts={totalCounts}
                actions={actions}
              />
            ))}
          </div>
        ) : (
          <div className="dept__grid">
            {filteredTree.map((d) => <DeptCard key={d.id} dept={d as ApiDept & { children: ApiDept[] }} actions={actions} />)}
          </div>
        )}
      </div>

      {dialog && (
        <DeptDialog
          state={dialog}
          allDepts={depts ?? []}
          members={members}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load(); }}
          toast={toast}
        />
      )}
    </>
  );
}

/** Tiny "…" overflow trigger rendering a MorePortal menu. */
function RowMenu({ dept, actions }: { dept: ApiDept; actions: DeptActions }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!actions.canManage) return null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s); }}
        aria-label="Function actions"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={210} open={open} placement="below">
            <MenuList>
              <MenuItem icon={Pencil} label="Edit function" onClick={() => { setOpen(false); actions.onEdit(dept); }} />
              <MenuItem icon={CornerDownRight} label="Add sub-department" onClick={() => { setOpen(false); actions.onAddSub(dept.id); }} />
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { setOpen(false); actions.onDelete(dept); }} />
            </MenuList>
          </MorePortal>
        </>
      )}
    </>
  );
}

function TreeNode({
  node, depth, collapsed, toggleNode, totalCounts, actions,
}: {
  node: ApiDept & { children: ApiDept[] };
  depth: number;
  collapsed: Set<string>;
  toggleNode: (id: string) => void;
  totalCounts: Map<string, number>;
  actions: DeptActions;
}) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const headcount = node._count?.members ?? 0;
  const totalCount = totalCounts.get(node.id) ?? headcount;
  const color = node.color ?? C.blue;

  return (
    <div className="dept__node">
      <div
        className={`dept__row${hasChildren ? " has-children" : ""}`}
        style={{
          ["--depth" as unknown as string]: `${depth}`,
          ["--node-c" as unknown as string]: color,
        }}
      >
        <button
          type="button"
          className={`dept__chev${isCollapsed ? " is-collapsed" : ""}${hasChildren ? "" : " is-leaf"}`}
          onClick={() => hasChildren && toggleNode(node.id)}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {hasChildren ? <ChevronDown /> : <span className="dept__chev-dot" />}
        </button>

        <span className="dept__row-stripe" aria-hidden="true" />

        <div className="dept__row-main">
          <div className="dept__row-name-row">
            <span className="dept__row-name">{node.name}</span>
            {node.description && (
              <span className="dept__row-desc">{node.description.length > 80 ? node.description.slice(0, 80) + "…" : node.description}</span>
            )}
          </div>

          {node.head ? (
            <span className="dept__row-head">
              <span className="dept__row-head-av" style={{ background: avColor(node.head.id) }}>
                {initials(node.head.firstName, node.head.lastName)}
              </span>
              <span className="dept__row-head-name">
                {fullName(node.head.firstName, node.head.lastName) || "Head"}
              </span>
              <span className="dept__row-head-tag">Head</span>
            </span>
          ) : (
            <span className="dept__row-no-head">No head</span>
          )}
        </div>

        <div className="dept__row-counts">
          <span className="dept__count-direct" title={`${headcount} direct member${headcount === 1 ? "" : "s"}`}>
            <Users /> {headcount}
          </span>
          {hasChildren && totalCount !== headcount && (
            <span className="dept__count-total" title={`${totalCount} total including sub-departments`}>
              {totalCount} total
            </span>
          )}
          {hasChildren && (
            <span className="dept__count-subs">
              {node.children.length} sub{node.children.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <RowMenu dept={node} actions={actions} />
      </div>

      {hasChildren && !isCollapsed && (
        <div className="dept__children" aria-hidden={isCollapsed}>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c as ApiDept & { children: ApiDept[] }}
              depth={depth + 1}
              collapsed={collapsed}
              toggleNode={toggleNode}
              totalCounts={totalCounts}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeptCard({ dept, actions }: { dept: ApiDept & { children: ApiDept[] }; actions: DeptActions }) {
  const headcount = dept._count?.members ?? 0;
  const color = dept.color ?? C.blue;
  const subCount = dept.children.length;
  return (
    <article className="dept__card" style={{ ["--card-c" as unknown as string]: color }}>
      <span className="dept__card-stripe" aria-hidden="true" />
      <header className="dept__card-head">
        <h3 className="dept__card-name">{dept.name}</h3>
        <div className="flex items-center gap-1">
          <span className="dept__card-headcount"><Users /> {headcount}</span>
          <RowMenu dept={dept} actions={actions} />
        </div>
      </header>
      {dept.description && (
        <p className="dept__card-desc">{dept.description}</p>
      )}
      <div className="dept__card-body">
        {dept.head ? (
          <div className="dept__card-head-row">
            <span className="dept__card-head-av" style={{ background: avColor(dept.head.id) }}>
              {initials(dept.head.firstName, dept.head.lastName)}
            </span>
            <div>
              <div className="dept__card-head-name">{fullName(dept.head.firstName, dept.head.lastName)}</div>
              <div className="dept__card-head-label">Department head</div>
            </div>
          </div>
        ) : (
          <div className="dept__card-no-head">
            <UserX /> No head assigned
          </div>
        )}
      </div>
      {subCount > 0 && (
        <div className="dept__card-subs">
          <div className="dept__card-subs-label">{subCount} sub-department{subCount === 1 ? "" : "s"}</div>
          <div className="dept__card-subs-list">
            {dept.children.map((s) => (
              <span key={s.id} className="dept__card-sub">
                <ChevronRight /> {s.name}
                <em>{s._count?.members ?? 0}</em>
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Building2; label: string; value: string; sub: string }) {
  return (
    <div className="dept__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <div className="dept__kpi-row">
        <div className="dept__kpi-icon"><Icon /></div>
        <div className="dept__kpi-label">{label}</div>
      </div>
      <div className="dept__kpi-value">{value}</div>
      <div className="dept__kpi-sub">{sub}</div>
    </div>
  );
}

/* ────────────────────────── Create / Edit dialog ────────────────────── */

type PickerOption = { value: string; label: string; leading?: ReactNode; hint?: string };

/** In-dialog dropdown (rendered inline so it never trips the Radix dialog's
 *  outside-click close). Optional search for long lists. */
function PickerField({
  value, options, placeholder, onChange, searchable, ariaLabel,
}: {
  value: string;
  options: PickerOption[];
  placeholder: string;
  onChange: (v: string) => void;
  searchable?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const filtered = searchable && q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((s) => !s)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-left text-[13px] text-zinc-900 hover:border-zinc-300 focus:border-[#0073EA] focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-zinc-400"}`}>
          {selected ? (
            <span className="flex items-center gap-2">
              {selected.leading}
              <span className="truncate">{selected.label}</span>
            </span>
          ) : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQ(""); }} aria-hidden />
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-[#1B1F26]">
            {searchable && (
              <div className="px-2 pb-1">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people…"
                  className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-900 outline-none focus:border-[#0073EA] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12.5px] text-zinc-400">No matches</div>
            ) : filtered.map((o) => (
              <button
                key={o.value || "__none"}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {o.leading}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[11px] text-zinc-400">{o.hint}</span>}
                {o.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MemberAvatar({ m }: { m: Member }) {
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: avColor(m.id) }}
    >
      {initials(m.firstName, m.lastName)}
    </span>
  );
}

function DeptDialog({
  state, allDepts, members, onClose, onSaved, toast,
}: {
  state: DialogState;
  allDepts: ApiDept[];
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
  toast: (msg: string) => void;
}) {
  const editing = state.mode === "edit" ? state.dept : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [color, setColor] = useState(editing?.color ?? SWATCHES[0].value);
  const [headId, setHeadId] = useState(editing?.head?.id ?? "");
  const [parentId, setParentId] = useState(
    state.mode === "create" ? (state.presetParentId ?? "") : (editing?.parentId ?? ""),
  );
  const [saving, setSaving] = useState(false);

  // Parent options: every function except self + own descendants (no cycles).
  const parentOptions = useMemo<PickerOption[]>(() => {
    const excluded = editing ? descendantIds(allDepts, editing.id) : new Set<string>();
    if (editing) excluded.add(editing.id);
    const opts: PickerOption[] = [{ value: "", label: "Top level (no parent)" }];
    for (const d of [...allDepts].sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(d.id)) continue;
      opts.push({ value: d.id, label: d.name });
    }
    return opts;
  }, [allDepts, editing]);

  const headOptions = useMemo<PickerOption[]>(() => {
    const opts: PickerOption[] = [{ value: "", label: "No head assigned" }];
    for (const m of members) {
      opts.push({
        value: m.id,
        label: fullName(m.firstName, m.lastName) || "Unnamed",
        leading: <MemberAvatar m={m} />,
      });
    }
    return opts;
  }, [members]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { toast("Name is required"); return; }
    setSaving(true);
    const payload = {
      name: trimmed,
      description: description.trim() || null,
      color,
      parentId: parentId || null,
      headId: headId || null,
    };
    try {
      const res = editing
        ? await fetch(`/api/departments/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/departments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(body?.error ?? `Couldn't save (HTTP ${res.status})`);
        setSaving(false);
        return;
      }
      toast(editing ? "Function updated" : "Function created");
      onSaved();
    } catch {
      toast("Couldn't save function");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit function" : "New function"}</DialogTitle>
          <DialogDescription>
            Functions (departments) organise people and route policies, announcements, and ownership.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5 pt-1">
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Name</span>
            <input
              autoFocus={!editing}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              placeholder="e.g. Engineering"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Description <span className="font-normal text-zinc-400">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this function owns…"
              rows={2}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          {/* Color */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Color</span>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-label={s.name}
                  title={s.name}
                  onClick={() => setColor(s.value)}
                  className={`grid h-7 w-7 place-items-center rounded-full ring-offset-1 ring-offset-white transition dark:ring-offset-[#14171D] ${color === s.value ? "ring-2 ring-[#0073EA]" : "ring-1 ring-zinc-200 dark:ring-zinc-700"}`}
                  style={{ background: s.value }}
                >
                  {color === s.value && <Check className="h-3.5 w-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Head */}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Department head</span>
            <PickerField
              ariaLabel="Department head"
              value={headId}
              onChange={setHeadId}
              options={headOptions}
              placeholder="No head assigned"
              searchable
            />
          </div>

          {/* Parent */}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Parent department</span>
            <PickerField
              ariaLabel="Parent department"
              value={parentId}
              onChange={setParentId}
              options={parentOptions}
              placeholder="Top level (no parent)"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-8 items-center rounded-lg border border-zinc-200 px-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0073EA] px-3.5 text-[13px] font-medium text-white hover:bg-[#0068d6] disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create function"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
