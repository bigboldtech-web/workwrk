"use client";

// Legal → Contracts board.

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import {
  CONTRACT_FIELDS, ContractModal, Empty, Loading, type Contract,
} from "@/components/legal/shared";

export default function LegalContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<Contract | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/legal/contracts");
      const d = r.ok ? await r.json() : { contracts: [] };
      setContracts(d.contracts || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-contracts"
      boardKey="contracts"
      viewMode="table"
      primaryAction={{ label: "New contract", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{contracts.length}</span>}
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={FileText}
            title="No contracts tracked"
            hint="Track every MSA, NDA, SOW, DPA — get alerted before renewals expire."
            onAction={() => setShowNew(true)}
            actionLabel="Add first contract"
          />
        </div>
      ) : (
        <BoardView
          boardKey="legal:contracts"
          items={contracts}
          fields={CONTRACT_FIELDS}
          getId={(c) => c.id}
          getTitle={(c) => c.title}
          getValue={(c, key) => {
            const raw = (c as unknown as Record<string, unknown>)[key];
            if (key === "value") return raw != null ? Number(raw) : null;
            return raw;
          }}
          editableFields={["status"]}
          selectable
          onRowClick={(c) => setOpen(c)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/legal/contracts", {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            });
            await refresh();
            setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Contract : prev);
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/legal/contracts", {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      {showNew && (
        <ContractModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />
      )}

      <ItemDetailDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        item={open}
        title={open?.title ?? ""}
        entityType="CONTRACT"
        fields={CONTRACT_FIELDS}
        editableFields={["title", "counterparty", "type", "status", "value", "effectiveDate", "expiresAt"]}
        getValue={(c, k) => {
          const raw = (c as unknown as Record<string, unknown>)[k];
          if (k === "value") return raw != null ? Number(raw) : null;
          return raw;
        }}
        onChangeField={async (id, key, value) => {
          await fetch("/api/legal/contracts", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Contract : prev);
        }}
      />
    </BoardShell>
  );
}
