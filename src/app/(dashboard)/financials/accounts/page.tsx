"use client";

/* Finance · GL Accounts — chart of accounts as parent->child tree per bucket.
 *
 * Five top-level buckets: Assets · Liabilities · Equity · Revenue · Expense.
 * KPI strip surfaces totals per bucket; search filters tree.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet, ChevronRight, ChevronDown, Circle, Search, Coins, BookText,
  Receipt, TrendingUp, TrendingDown, ScrollText,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type AcctType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type ApiAcct = {
  id: string;
  code: string;
  name: string;
  type: AcctType;
  parentId?: string | null;
  currency?: string | null;
  description?: string | null;
  active: boolean;
};

const TYPE_LABEL: Record<AcctType, string> = {
  ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity",
  REVENUE: "Revenue", EXPENSE: "Expenses",
};
const TYPE_HUE: Record<AcctType, string> = {
  ASSET: "var(--os-c-green)", LIABILITY: "var(--os-c-red)",
  EQUITY: "var(--os-c-purple)", REVENUE: "var(--os-c-teal)",
  EXPENSE: "var(--os-c-orange)",
};
const TYPE_ICON: Record<AcctType, typeof Wallet> = {
  ASSET: Wallet, LIABILITY: TrendingDown, EQUITY: ScrollText,
  REVENUE: TrendingUp, EXPENSE: Receipt,
};
const TYPE_ORDER: AcctType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

type TreeNode = { acct: ApiAcct; children: TreeNode[] };

function buildTree(accts: ApiAcct[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const a of accts) byId.set(a.id, { acct: a, children: [] });
  const roots: TreeNode[] = [];
  for (const a of accts) {
    const node = byId.get(a.id)!;
    if (a.parentId && byId.has(a.parentId)) byId.get(a.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sortByCode = (a: TreeNode, b: TreeNode) => a.acct.code.localeCompare(b.acct.code);
  function recursiveSort(n: TreeNode) { n.children.sort(sortByCode); n.children.forEach(recursiveSort); }
  roots.sort(sortByCode);
  roots.forEach(recursiveSort);
  return roots;
}

function flatten(nodes: TreeNode[]): number {
  let n = 0; const walk = (xs: TreeNode[]) => { for (const x of xs) { n += 1; walk(x.children); } }; walk(nodes); return n;
}

export default function GlAccountsPage() {
  const [accts, setAccts] = useState<ApiAcct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [activeBucket, setActiveBucket] = useState<AcctType | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gl-accounts?includeInactive=1");
      if (res.status === 403) { setLoadError("Org-admin access required to view the chart of accounts."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAccts(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filteredAccts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accts ?? []).filter((a) => {
      if (activeBucket && a.type !== activeBucket) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) ||
             a.code.toLowerCase().includes(q) ||
             (a.description ?? "").toLowerCase().includes(q);
    });
  }, [accts, search, activeBucket]);

  // When searching, expand all ancestors of matching nodes
  const visibleIds = useMemo(() => {
    if (!search.trim() && !activeBucket) return null;
    const ids = new Set<string>();
    const byId = new Map<string, ApiAcct>();
    for (const a of accts ?? []) byId.set(a.id, a);
    for (const a of filteredAccts) {
      let cur: ApiAcct | undefined = a;
      while (cur) {
        ids.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return ids;
  }, [accts, filteredAccts, search, activeBucket]);

  const treesByType = useMemo(() => {
    const list = visibleIds
      ? (accts ?? []).filter((a) => visibleIds.has(a.id))
      : (accts ?? []);
    const m = new Map<AcctType, TreeNode[]>();
    for (const t of TYPE_ORDER) m.set(t, buildTree(list.filter((a) => a.type === t)));
    return m;
  }, [accts, visibleIds]);

  function toggle(id: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const hasKids = node.children.length > 0;
    const isCollapsed = collapsed.has(node.acct.id);
    return (
      <div key={node.acct.id}>
        <div className={`gl__row ${!node.acct.active ? "gl__row--off" : ""}`} style={{ paddingLeft: 14 + depth * 22 }}>
          {hasKids ? (
            <button type="button" className="gl__caret" onClick={() => toggle(node.acct.id)}>
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </button>
          ) : <span className="gl__caret gl__caret--empty"><Circle /></span>}
          <span className="gl__code">{node.acct.code}</span>
          <span className="gl__name">{node.acct.name}</span>
          {node.acct.description ? <span className="gl__desc">{node.acct.description}</span> : null}
          <span className="gl__currency">{node.acct.currency ?? "USD"}</span>
          <span className={`gl__dot ${node.acct.active ? "is-active" : ""}`} title={node.acct.active ? "Active" : "Inactive"} />
        </div>
        {hasKids && !isCollapsed ? node.children.map((c) => renderNode(c, depth + 1)) : null}
      </div>
    );
  }

  const stats = useMemo(() => {
    const list = accts ?? [];
    const total = list.length;
    const inactive = list.filter((a) => !a.active).length;
    const counts: Record<AcctType, number> = { ASSET: 0, LIABILITY: 0, EQUITY: 0, REVENUE: 0, EXPENSE: 0 };
    for (const a of list) counts[a.type] = (counts[a.type] ?? 0) + 1;
    return { total, inactive, counts };
  }, [accts]);

  const matchTotal = useMemo(() => visibleIds ? filteredAccts.length : (accts?.length ?? 0), [visibleIds, filteredAccts, accts]);

  return (
    <>
      <OsTitleBar
        title="Chart of accounts"
        Icon={Wallet}
        iconGradient={GRAD.greenTeal}
        description={accts === null ? "Loading…" : `${stats.total} account${stats.total === 1 ? "" : "s"} · ${stats.inactive} inactive · 5 top-level buckets`}
        actions={
          <div className="gl__head-actions">
            <Link href="/financials" className="gl__nav-link"><Coins /> Finance</Link>
            <Link href="/financials/entries" className="gl__nav-link"><BookText /> Journal</Link>
          </div>
        }
      />

      <div className="gl">
        <div className="gl__kpis">
          {TYPE_ORDER.map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <button
                key={t}
                type="button"
                className={`gl__kpi${activeBucket === t ? " is-active" : ""}`}
                style={{ ["--kpi-accent" as unknown as string]: TYPE_HUE[t] }}
                onClick={() => setActiveBucket(activeBucket === t ? null : t)}
              >
                <span className="gl__kpi-accent" aria-hidden="true" />
                <div className="gl__kpi-row">
                  <div className="gl__kpi-icon"><Icon /></div>
                  <div className="gl__kpi-label">{TYPE_LABEL[t]}</div>
                </div>
                <div className="gl__kpi-value">{stats.counts[t]}</div>
                <div className="gl__kpi-sub">{activeBucket === t ? "showing only this" : "click to filter"}</div>
              </button>
            );
          })}
        </div>

        <div className="gl__toolbar">
          <div className="gl__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, description…"
            />
          </div>
          {(search.trim() || activeBucket) && (
            <button type="button" className="gl__clear" onClick={() => { setSearch(""); setActiveBucket(null); }}>
              Clear filters
            </button>
          )}
          <span className="gl__count">{matchTotal} match{matchTotal === 1 ? "" : "es"}</span>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Wallet} iconGradient={GRAD.redPink} title="Couldn't load chart" subtitle={loadError} cta="Retry" />
        ) : accts === null ? (
          <div className="gl__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Wallet}
            iconGradient={GRAD.greenTeal}
            title="No GL accounts yet"
            subtitle="Set up your chart of accounts before posting journal entries. Each entry must reference an account."
            chips={["Assets", "Liabilities", "Equity", "Revenue", "Expenses"]}
            cta="Import COA"
          />
        ) : matchTotal === 0 ? (
          <div className="gl__no-match"><Search /> No accounts match your filter.</div>
        ) : (
          <div className="gl__buckets">
            {TYPE_ORDER.map((type) => {
              if (activeBucket && activeBucket !== type) return null;
              const tree = treesByType.get(type) ?? [];
              if (tree.length === 0 && (search.trim() || activeBucket)) return null;
              const flatCount = flatten(tree);
              return (
                <section key={type} className="gl__bucket" style={{ ["--b-c" as unknown as string]: TYPE_HUE[type] }}>
                  <header className="gl__bucket-head">
                    <span className="gl__bucket-dot" />
                    <h2>{TYPE_LABEL[type]}</h2>
                    <span className="gl__bucket-count">{flatCount} of {stats.counts[type]}</span>
                  </header>
                  {tree.length === 0 ? (
                    <div className="gl__bucket-empty">No {TYPE_LABEL[type].toLowerCase()} accounts yet.</div>
                  ) : (
                    <div className="gl__tree">{tree.map((n) => renderNode(n, 0))}</div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
