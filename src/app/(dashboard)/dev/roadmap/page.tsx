"use client";

// Dev → Roadmap board. BoardView (table) over RoadmapItem with detail drawer.

import { useCallback, useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { BoardView } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";
import { BoardShell } from "@/components/layout/board-shell";
import {
  Empty, Loading, RoadmapModal, ROADMAP_FIELDS, type RoadmapItem,
} from "@/components/dev/shared";

export default function DevRoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openItem, setOpenItem] = useState<RoadmapItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dev/roadmap");
      const d = r.ok ? await r.json() : { items: [] };
      setItems(d.items || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-dev"
      boardKey="roadmap"
      viewMode="table"
      primaryAction={{ label: "New item", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{items.length}</span>
      }
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={MapIcon}
            title="Empty roadmap"
            hint="Themes → initiatives → outcomes. Tied to OKRs + Releases."
            onAction={() => setShowNew(true)}
            actionLabel="Add first item"
          />
        </div>
      ) : (
        <BoardView
          boardKey="dev:roadmap"
          items={items}
          fields={ROADMAP_FIELDS}
          getId={(r) => r.id}
          getTitle={(r) => r.title}
          getValue={(r, key) => (r as unknown as Record<string, unknown>)[key]}
          editableFields={["status", "priority", "quarter", "impactScore", "effortPoints"]}
          selectable
          onRowClick={(r) => setOpenItem(r)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/dev/roadmap", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            });
            await refresh();
            setOpenItem((prev) => prev && prev.id === id ? { ...prev, [key]: value } as RoadmapItem : prev);
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/dev/roadmap", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      {showNew && (
        <RoadmapModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}

      <ItemDetailDrawer
        open={!!openItem}
        onClose={() => setOpenItem(null)}
        item={openItem}
        title={openItem?.title ?? ""}
        entityType="ROADMAP_ITEM"
        fields={ROADMAP_FIELDS}
        editableFields={["title", "theme", "status", "priority", "quarter", "impactScore", "effortPoints"]}
        getValue={(r, k) => (r as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/dev/roadmap", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenItem((prev) => prev && prev.id === id ? { ...prev, [key]: value } as RoadmapItem : prev);
        }}
      />
    </BoardShell>
  );
}
