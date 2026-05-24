"use client";

// Marketing → Content board.

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  CONTENT_FIELDS, ContentModal, Empty, Loading, type ContentItem,
} from "@/components/marketing/shared";

export default function MarketingContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<ContentItem | null>(null);

  const workspaceId = useActiveWorkspace("workwrk-campaigns");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing/content${wsQuery}`);
      const d = r.ok ? await r.json() : { items: [] };
      setItems(d.items || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-campaigns"
      boardKey="content"
      viewMode="kanban"
      primaryAction={{ label: "New content", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{items.length}</span>
      }
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={FileText}
            title="Empty content calendar"
            hint="Start planning content — briefs, drafts, schedule, publish."
            onAction={() => setShowNew(true)}
            actionLabel="Add first piece"
          />
        </div>
      ) : (
        <BoardView
          boardKey="marketing:content"
          items={items}
          fields={CONTENT_FIELDS}
          getId={(c) => c.id}
          getTitle={(c) => c.title}
          getValue={(c, key) => (c as unknown as Record<string, unknown>)[key]}
          onRowClick={(c) => setOpen(c)}
        />
      )}

      {showNew && (
        <ContentModal
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
        entityType="CONTENT_ITEM"
        fields={CONTENT_FIELDS}
        editableFields={["title", "type", "status", "channel", "scheduledFor"]}
        getValue={(c, k) => (c as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/marketing/content", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpen((prev) => prev && prev.id === id ? { ...prev, [key]: value } as ContentItem : prev);
        }}
      />
    </BoardShell>
  );
}
