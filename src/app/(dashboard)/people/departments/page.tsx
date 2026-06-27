"use client";

/* People · Departments — bespoke org tree view.
 *
 *  GET   /api/departments
 *  POST  /api/departments  { name, color? }
 *
 * Layout:
 *   OsTitleBar with back + nav + New department.
 *   4-tile KPI strip: Departments · Headcount · With head · Vacant head.
 *   Toolbar: search + view toggle (Tree / Grid) + expand all / collapse all.
 *   Tree: indented nested rows with connector lines, color stripe, head avatar.
 *   Grid: flat card view as fallback.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2, Plus, Users, ChevronDown, ChevronRight, Search,
  ArrowLeft, UserX, ListTree, LayoutGrid, GraduationCap, Briefcase, Network,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

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

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

const PALETTE = [C.blue, C.purple, C.green, C.orange, C.pink, C.indigo, C.teal, C.red];

type ViewMode = "tree" | "grid";

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<ApiDept[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

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

  async function quickAdd() {
    const name = (await promptDialog({ title: "Department name?" }))?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Department created");
      void load();
    } catch { toast("Couldn't create department"); }
  }

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
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
  }

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
            <button type="button" className="dept__btn-primary" onClick={quickAdd}>
              <Plus /> New department
            </button>
          </div>
        }
      />

      <div className="dept">
        {/* KPIs */}
        <div className="dept__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Building2} label="Departments"  value={`${stats.total}`}        sub="org units" />
          <KpiTile accent="var(--os-c-purple)" Icon={Users}     label="Headcount"    value={`${stats.totalHeadcount}`} sub="across all depts" />
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
          <OsEmptyView Icon={Building2} iconGradient={GRAD.redPink} title="Couldn't load departments" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : depts === null ? (
          <div className="dept__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Building2}
            iconGradient={GRAD.indigoBlue}
            title="No departments yet"
            subtitle="Departments organize your people and route policies, payroll, and announcements. Create your first one to get started."
            cta="New department"
          />
        ) : filteredTree.length === 0 ? (
          <div className="dept__empty">
            <Search />
            <div>No departments match "{search}".</div>
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
                isLast
              />
            ))}
          </div>
        ) : (
          <div className="dept__grid">
            {filteredTree.map((d) => <DeptCard key={d.id} dept={d as ApiDept & { children: ApiDept[] }} />)}
          </div>
        )}
      </div>
    </>
  );
}

function TreeNode({
  node, depth, collapsed, toggleNode, totalCounts, isLast,
}: {
  node: ApiDept & { children: ApiDept[] };
  depth: number;
  collapsed: Set<string>;
  toggleNode: (id: string) => void;
  totalCounts: Map<string, number>;
  isLast: boolean;
}) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const headcount = node._count?.members ?? 0;
  const totalCount = totalCounts.get(node.id) ?? headcount;
  const color = node.color ?? C.indigo;

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
                {[node.head.firstName, node.head.lastName].filter(Boolean).join(" ") || "Head"}
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
      </div>

      {hasChildren && !isCollapsed && (
        <div className="dept__children" aria-hidden={isCollapsed}>
          {node.children.map((c, idx) => (
            <TreeNode
              key={c.id}
              node={c as ApiDept & { children: ApiDept[] }}
              depth={depth + 1}
              collapsed={collapsed}
              toggleNode={toggleNode}
              totalCounts={totalCounts}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeptCard({ dept }: { dept: ApiDept & { children: ApiDept[] } }) {
  const headcount = dept._count?.members ?? 0;
  const color = dept.color ?? C.indigo;
  const subCount = dept.children.length;
  return (
    <article className="dept__card" style={{ ["--card-c" as unknown as string]: color }}>
      <span className="dept__card-stripe" aria-hidden="true" />
      <header className="dept__card-head">
        <h3 className="dept__card-name">{dept.name}</h3>
        <span className="dept__card-headcount"><Users /> {headcount}</span>
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
              <div className="dept__card-head-name">{[dept.head.firstName, dept.head.lastName].filter(Boolean).join(" ")}</div>
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
      <span className="dept__kpi-accent" aria-hidden="true" />
      <div className="dept__kpi-row">
        <div className="dept__kpi-icon"><Icon /></div>
        <div className="dept__kpi-label">{label}</div>
      </div>
      <div className="dept__kpi-value">{value}</div>
      <div className="dept__kpi-sub">{sub}</div>
    </div>
  );
}
