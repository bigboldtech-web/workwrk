"use client";

// Helpdesk → Customers board.

import { useCallback, useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  CustomerModal, Empty, Loading, timeAgo, type Customer,
} from "@/components/helpdesk/shared";

export default function HelpdeskCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/helpdesk/customers");
      const d = r.ok ? await r.json() : { customers: [] };
      setCustomers(d.customers || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-help"
      boardKey="customers"
      viewMode="table"
      primaryAction={{ label: "Add customer", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{customers.length}</span>}
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? <Loading /> : customers.length === 0 ? (
          <Empty
            Icon={UsersIcon}
            title="No customers"
            hint="Customers get auto-created when they file a ticket. You can also add them manually."
            onAction={() => setShowNew(true)}
            actionLabel="Add customer"
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Company</th>
                <th className="text-left px-4 py-2.5">Tickets</th>
                <th className="text-left px-4 py-2.5">Added</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-medium">{c.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted text-xs">{c.email}</td>
                  <td className="px-4 py-2.5 text-muted">{c.companyName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{c._count.tickets}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-2">{timeAgo(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <CustomerModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
