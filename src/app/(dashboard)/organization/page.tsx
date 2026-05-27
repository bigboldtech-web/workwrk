"use client";

/* Organization · Org chart — visual reporting hierarchy.
 *
 * Builds a manager -> directReports tree from /api/users, rendered as a
 * vertically-cascading set of cards. Each level indents below its
 * manager. Click any card to expand/collapse its reports.
 *
 * Use case: "show me the org chart, who reports to whom."
 *
 * Reads: GET /api/users  (returns each user with manager id)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, ChevronDown, ChevronRight, Search } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  managerId?: string | null;
  accessLevel?: string;
  manager?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  role?: { id: string; title: string } | null;
  department?: { id: string; name: string } | null;
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

type TreeNode = { user: ApiUser; reports: TreeNode[] };

function buildTree(users: ApiUser[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const u of users) byId.set(u.id, { user: u, reports: [] });
  const roots: TreeNode[] = [];
  for (const u of users) {
    const node = byId.get(u.id)!;
    if (u.managerId && byId.has(u.managerId)) byId.get(u.managerId)!.reports.push(node);
    else roots.push(node);
  }
  // Sort: by direct-reports count desc, then by name
  const sortFn = (a: TreeNode, b: TreeNode) =>
    b.reports.length - a.reports.length
    || (a.user.firstName ?? "").localeCompare(b.user.firstName ?? "");
  function walk(n: TreeNode) { n.reports.sort(sortFn); n.reports.forEach(walk); }
  roots.sort(sortFn);
  roots.forEach(walk);
  return roots;
}

export default function OrgChartPage() {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiUser[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setUsers(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const tree = useMemo(() => buildTree(users ?? []), [users]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set((users ?? []).filter((u) =>
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q) ||
      (u.role?.title ?? "").toLowerCase().includes(q) ||
      (u.department?.name ?? "").toLowerCase().includes(q)
    ).map((u) => u.id));
  }, [search, users]);

  function toggle(id: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const id = node.user.id;
    const isCollapsed = collapsed.has(id);
    const hasReports = node.reports.length > 0;
    const isMatch = matches?.has(id);
    const dim = matches && !isMatch;
    return (
      <div key={id} className="org-node" style={{ marginLeft: depth === 0 ? 0 : 38 }}>
        <article className={`org-card ${dim ? "is-dim" : ""} ${isMatch ? "is-match" : ""}`} onClick={() => hasReports && toggle(id)}>
          <span className="org-card__av" style={{ background: avColor(id) }}>{initials(node.user.firstName, node.user.lastName)}</span>
          <div className="org-card__main">
            <div className="org-card__name">{[node.user.firstName, node.user.lastName].filter(Boolean).join(" ")}</div>
            <div className="org-card__role">{node.user.role?.title ?? "—"} {node.user.department?.name ? <span className="org-card__dept">· {node.user.department.name}</span> : null}</div>
          </div>
          {hasReports ? (
            <span className="org-card__reports">
              {node.reports.length} report{node.reports.length === 1 ? "" : "s"}
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </span>
          ) : null}
        </article>
        {hasReports && !isCollapsed ? (
          <div className="org-children">{node.reports.map((r) => renderNode(r, depth + 1))}</div>
        ) : null}
      </div>
    );
  }

  const total = users?.length ?? 0;
  const withManager = (users ?? []).filter((u) => u.managerId).length;
  const ceoLayer = tree.length;

  return (
    <div className="org">
      <header className="org__head">
        <div className="org__head-l">
          <div className="org__icon"><Network /></div>
          <div>
            <h1 className="org__title">Org chart</h1>
            <div className="org__sub">{users === null ? "Loading…" : `${total} people · ${withManager} have a manager · ${ceoLayer} at the top`}</div>
          </div>
        </div>
        <div className="org__search">
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person, role, or department…" />
        </div>
      </header>

      {loadError ? (
        <div className="org__error">{loadError}</div>
      ) : users === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="org__empty">
          <Network />
          <div>
            <h3>No people yet</h3>
            <p>Add team members and set their manager — the chart builds itself.</p>
          </div>
        </div>
      ) : (
        <div className="org__chart">{tree.map((n) => renderNode(n, 0))}</div>
      )}
    </div>
  );
}
