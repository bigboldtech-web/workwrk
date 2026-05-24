"use client";

// Marketing → Campaigns board.

import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  CAMPAIGN_FIELDS, CampaignModal, Empty, Loading, type Campaign,
} from "@/components/marketing/shared";

export default function MarketingCampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<Campaign | null>(null);

  const workspaceId = useActiveWorkspace("workwrk-campaigns");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing/campaigns${wsQuery}`);
      const d = r.ok ? await r.json() : { campaigns: [] };
      setItems(d.campaigns || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-campaigns"
      boardKey="campaigns"
      viewMode="kanban"
      primaryAction={{ label: "New campaign", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{items.length}</span>
      }
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={Megaphone}
            title="No campaigns yet"
            hint="Plan your first campaign — track budget vs spend, leads vs target."
            onAction={() => setShowNew(true)}
            actionLabel="Plan a campaign"
          />
        </div>
      ) : (
        <BoardView
          boardKey="marketing:campaigns"
          items={items}
          fields={CAMPAIGN_FIELDS}
          getId={(c) => c.id}
          getTitle={(c) => c.name}
          getValue={(c, key) => {
            const raw = (c as unknown as Record<string, unknown>)[key];
            if (key === "budget" || key === "spent") return raw != null ? Number(raw) : null;
            return raw;
          }}
          editableFields={["status"]}
          onRowClick={(c) => setOpen(c)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/marketing/campaigns", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            });
            await refresh();
            setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Campaign : prev);
          }}
        />
      )}

      {showNew && (
        <CampaignModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}

      <ItemDetailDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        item={open}
        title={open?.name ?? ""}
        entityType="CAMPAIGN"
        fields={CAMPAIGN_FIELDS}
        editableFields={["name", "status", "channel", "budget", "startDate", "endDate"]}
        getValue={(c, k) => {
          const raw = (c as unknown as Record<string, unknown>)[k];
          if (k === "budget" || k === "spent") return raw != null ? Number(raw) : null;
          return raw;
        }}
        onChangeField={async (id, key, value) => {
          await fetch("/api/marketing/campaigns", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Campaign : prev);
        }}
      />
    </BoardShell>
  );
}
