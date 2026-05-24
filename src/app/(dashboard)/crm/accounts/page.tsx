"use client";

// CRM → Accounts board. Simple table for v1.

import { useCallback, useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  AccountTypeBadge, NewAccountModal, type Account,
} from "@/components/crm/shared";

export default function CrmAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const workspaceId = useActiveWorkspace("workwrk-crm");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/crm/accounts${wsQuery}`);
      const data = r.ok ? await r.json() : { accounts: [] };
      setAccounts(data.accounts || []);
    } finally {
      setLoading(false);
    }
  }, [wsQuery]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-crm"
      boardKey="accounts"
      viewMode="table"
      primaryAction={{ label: "New account", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{accounts.length}</span>
      }
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="text-sm text-muted py-20 text-center">Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-20">
            <Building2 size={40} className="mx-auto mb-3 text-muted-2" />
            <p className="text-sm text-muted mb-4">No accounts yet. Track companies you sell to or partner with.</p>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              <Plus size={14} /> Add your first account
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Industry</th>
                <th className="text-left px-4 py-2.5 font-medium">Size</th>
                <th className="text-left px-4 py-2.5 font-medium">Deals</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5"><AccountTypeBadge type={a.type} /></td>
                  <td className="px-4 py-2.5 text-muted">{a.industry ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{a.size ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{a._count.opportunities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewAccountModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
