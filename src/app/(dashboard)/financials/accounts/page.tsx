"use client";

/* Finance · GL Accounts — chart of accounts as a parent->child tree.
 *
 * Five top-level buckets: Assets · Liabilities · Equity · Revenue · Expense.
 * Within each, accounts indent by parentId hierarchy. Each leaf shows code,
 * name, currency, and an active dot. Click a parent to collapse its
 * descendants. No table here — this is an accounting tree.
 *
 * Reads: GET /api/gl-accounts?includeInactive=1
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, ChevronRight, ChevronDown, Circle } from "lucide-react";
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

export default function GlAccountsPage() {
  const [accts, setAccts] = useState<ApiAcct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gl-accounts?includeInactive=1");
      if (res.status === 403) { setLoadError("Org-admin access required to view the chart of accounts."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAccts(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const treesByType = useMemo(() => {
    const m = new Map<AcctType, TreeNode[]>();
    for (const t of TYPE_ORDER) m.set(t, buildTree((accts ?? []).filter((a) => a.type === t)));
    return m;
  }, [accts]);

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

  const total = accts?.length ?? 0;
  const inactive = (accts ?? []).filter((a) => !a.active).length;

  return (
    <div className="gl">
      <header className="gl__head">
        <div className="gl__head-l">
          <div className="gl__icon"><Wallet /></div>
          <div>
            <h1 className="gl__title">Chart of accounts</h1>
            <div className="gl__sub">{accts === null ? "Loading…" : `${total} account${total === 1 ? "" : "s"} · ${inactive} inactive · 5 top-level buckets`}</div>
          </div>
        </div>
        <p className="gl__caption">Click any row with children to collapse it. This is the canonical GL — every journal entry posts against one of these accounts.</p>
      </header>

      {loadError ? (
        <div className="gl__error">{loadError}</div>
      ) : accts === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="gl__buckets">
          {TYPE_ORDER.map((type) => {
            const tree = treesByType.get(type) ?? [];
            const flatCount = (() => { let n = 0; const walk = (nodes: TreeNode[]) => { for (const x of nodes) { n += 1; walk(x.children); } }; walk(tree); return n; })();
            return (
              <section key={type} className="gl__bucket" style={{ borderLeft: `4px solid ${TYPE_HUE[type]}` }}>
                <header className="gl__bucket-head">
                  <h2>{TYPE_LABEL[type]}</h2>
                  <span>{flatCount}</span>
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
  );
}
