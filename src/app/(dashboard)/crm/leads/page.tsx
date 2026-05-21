"use client";

// CRM → Leads board. BoardView (table) over the lead pipeline.

import { useCallback, useEffect, useState } from "react";
import { Users as UsersIcon, Plus } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import { LEAD_FIELDS, NewLeadModal, type Lead } from "@/components/crm/shared";

export default function CrmLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openLead, setOpenLead] = useState<Lead | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/crm/leads");
      const data = r.ok ? await r.json() : { leads: [] };
      setLeads(data.leads || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-crm"
      boardKey="leads"
      viewMode="table"
      primaryAction={{ label: "New lead", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{leads.length}</span>
      }
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface text-sm text-muted py-20 text-center">
          Loading leads…
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface text-center py-20">
          <UsersIcon size={40} className="mx-auto mb-3 text-muted-2" />
          <p className="text-sm text-muted mb-4">No leads yet. Capture inbound interest, work outbound lists.</p>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            <Plus size={14} /> Add your first lead
          </button>
        </div>
      ) : (
        <BoardView
          boardKey="crm:leads"
          items={leads}
          fields={LEAD_FIELDS}
          getId={(l) => l.id}
          getTitle={(l) => `${l.firstName} ${l.lastName ?? ""}`.trim()}
          getValue={(l, key) => (l as unknown as Record<string, unknown>)[key]}
          editableFields={["status", "source"]}
          selectable
          onRowClick={(l) => setOpenLead(l)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/crm/leads", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            }).catch(() => {});
            await refresh();
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/crm/leads", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      {showNew && (
        <NewLeadModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}

      <ItemDetailDrawer
        open={!!openLead}
        onClose={() => setOpenLead(null)}
        item={openLead}
        title={openLead ? `${openLead.firstName} ${openLead.lastName ?? ""}`.trim() : ""}
        entityType="LEAD"
        fields={LEAD_FIELDS}
        editableFields={["firstName", "lastName", "company", "title", "email", "status", "source"]}
        getValue={(l, k) => (l as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/crm/leads", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenLead((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Lead : prev);
        }}
      />
    </BoardShell>
  );
}
