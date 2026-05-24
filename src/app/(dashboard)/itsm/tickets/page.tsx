"use client";

// ITSM → Tickets board.

import { useCallback, useEffect, useState } from "react";
import { Headphones } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  TICKET_FIELDS, NewTicketModal, EmptyState, type Ticket,
} from "@/components/itsm/shared";

export default function ItsmTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<Ticket | null>(null);

  const workspaceId = useActiveWorkspace("workwrk-itsm");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/itsm/tickets${wsQuery}`);
      const d = r.ok ? await r.json() : { tickets: [] };
      setTickets(d.tickets || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-itsm"
      boardKey="tickets"
      viewMode="kanban"
      primaryAction={{ label: "New ticket", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{tickets.length}</span>
      }
    >
      {loading ? (
        <div className="text-sm text-muted py-20 text-center">Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <EmptyState
          Icon={Headphones}
          title="No tickets yet"
          hint="Submit your first IT support ticket to start tracking employee requests."
          action={{ label: "Create first ticket", onClick: () => setShowNew(true) }}
        />
      ) : (
        <BoardView
          boardKey="itsm:tickets"
          items={tickets}
          fields={TICKET_FIELDS}
          getId={(t) => t.id}
          getTitle={(t) => t.title}
          getValue={(t, key) => (t as unknown as Record<string, unknown>)[key]}
          editableFields={["status", "priority"]}
          selectable
          onRowClick={(t) => setOpen(t)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/itsm/tickets", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            });
            await refresh();
            setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Ticket : prev);
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/itsm/tickets", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      {showNew && (
        <NewTicketModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}

      <ItemDetailDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        item={open}
        title={open?.title ?? ""}
        entityType="TICKET"
        fields={TICKET_FIELDS}
        editableFields={["title", "status", "priority", "category", "dueAt"]}
        getValue={(t, k) => (t as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/itsm/tickets", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Ticket : prev);
        }}
      />
    </BoardShell>
  );
}
