"use client";

// Helpdesk → Tickets board.

import { useCallback, useEffect, useState } from "react";
import { Headphones } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import {
  SUPPORT_TICKET_FIELDS, TicketModal, Empty, Loading, type Ticket,
} from "@/components/helpdesk/shared";

export default function HelpdeskTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<Ticket | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/helpdesk/tickets");
      const d = r.ok ? await r.json() : { tickets: [] };
      setTickets(d.tickets || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-help"
      boardKey="tickets"
      viewMode="kanban"
      primaryAction={{ label: "New ticket", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{tickets.length}</span>}
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={Headphones}
            title="No tickets yet"
            hint="When a customer emails support or files a request, the ticket lands here."
            onAction={() => setShowNew(true)}
            actionLabel="Log first ticket"
          />
        </div>
      ) : (
        <BoardView
          boardKey="helpdesk:tickets"
          items={tickets}
          fields={SUPPORT_TICKET_FIELDS}
          getId={(t) => t.id}
          getTitle={(t) => t.subject}
          getValue={(t, key) => {
            if (key === "subject") return t.subject;
            return (t as unknown as Record<string, unknown>)[key];
          }}
          editableFields={["status", "priority"]}
          selectable
          onRowClick={(t) => setOpen(t)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/helpdesk/tickets", {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            });
            await refresh();
            setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Ticket : prev);
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/helpdesk/tickets", {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      {showNew && (
        <TicketModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}

      <ItemDetailDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        item={open}
        title={open?.subject ?? ""}
        entityType="SUPPORT_TICKET"
        fields={SUPPORT_TICKET_FIELDS}
        editableFields={["subject", "status", "priority", "channel", "category", "slaTier"]}
        getValue={(t, k) => (t as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/helpdesk/tickets", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Ticket : prev);
        }}
      />
    </BoardShell>
  );
}
