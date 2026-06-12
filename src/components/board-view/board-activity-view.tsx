"use client";

// BoardActivityView — ACTIVITY renderer. Chronological board-wide feed
// of ItemActivity rows across every task on the board (the per-item
// drawer tab, board-scoped). Served by /api/item-activity?boardId=;
// each row carries its task title chip → opens the drawer.

import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon, Loader2 } from "lucide-react";
import type { StatusOption } from "@/lib/board-items-shared";

interface FeedRow {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
  itemId: string;
  itemTitle: string | null;
}

interface BoardActivityViewProps {
  boardId: string;
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24); if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function describe(row: FeedRow, statuses: StatusOption[]): string {
  const meta = row.meta ?? {};
  const statusLabel = (v: string) => statuses.find((o) => o.value === v)?.label ?? v;
  switch (row.action) {
    case "CREATED": return "created this task";
    case "STATUS_CHANGED": {
      const from = typeof meta.from === "string" ? statusLabel(meta.from) : "—";
      const to = typeof meta.to === "string" ? statusLabel(meta.to) : "—";
      return `changed status from ${from} → ${to}`;
    }
    case "TITLE_CHANGED": {
      const from = typeof meta.from === "string" ? meta.from : "";
      const to = typeof meta.to === "string" ? meta.to : "";
      return `renamed "${from}" → "${to}"`;
    }
    case "OWNER_CHANGED": return "changed the assignee";
    case "FIELDS_UPDATED": return "updated fields";
    case "ARCHIVED": return "archived this task";
    case "COMMENTED": return "commented";
    default: return row.action.toLowerCase().replace(/_/g, " ");
  }
}

export function BoardActivityView({ boardId, statuses, onOpenItem }: BoardActivityViewProps) {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/item-activity?boardId=${boardId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRows(Array.isArray(d?.activity) ? d.activity : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load activity");
      setRows([]);
    }
  }, [boardId]);

  useEffect(() => { void load(); }, [load]);

  if (rows === null) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-12 flex items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <ActivityIcon className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">
          {error ?? "No activity yet — task changes across this List will stream here."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 divide-y divide-zinc-50">
      {rows.map((r) => (
        <div key={r.id} className="flex items-baseline gap-2 py-2 text-[12.5px]">
          <span className="text-zinc-400 whitespace-nowrap tabular-nums w-16 shrink-0">
            {relativeTime(new Date(r.createdAt))}
          </span>
          <span className="flex-1 min-w-0">
            <span className="font-medium text-zinc-800">{r.actorName ?? "System"}</span>{" "}
            <span className="text-zinc-500">{describe(r, statuses)}</span>
            {r.itemTitle ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => onOpenItem?.(r.itemId)}
                  className="inline max-w-[280px] truncate align-bottom text-zinc-700 hover:text-[var(--os-brand)] underline decoration-zinc-200 underline-offset-2"
                  title={r.itemTitle}
                >
                  {r.itemTitle}
                </button>
              </>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
