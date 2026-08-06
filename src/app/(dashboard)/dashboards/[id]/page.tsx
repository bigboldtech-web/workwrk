"use client";

/* Dashboard detail — ClickUp-parity chrome: breadcrumb header (Dashboards /
 * inline-rename + star), Share + "..." actions, Edit-mode toolbar row
 * (Refreshed just now · Auto refresh · Filters · dark Add card), the Add
 * Card gallery (AddCardPanel), and a centered empty-state canvas. Widget
 * data itself lands with the Dashboard view phase; the shared WidgetCard
 * shell in components/dashboard/widget-card.tsx is ready for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Filter, LayoutDashboard, Loader2, MoreHorizontal, Pencil, Plus,
  RefreshCw, Share2, Star, Trash2,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Switch } from "@/components/ui/switch";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { AddCardPanel } from "@/components/dashboard/add-card-panel";

type Dashboard = {
  id: string;
  name: string;
  description: string | null;
  widgets: unknown[];
  updatedAt: string;
};

export default function DashboardDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [renameValue, setRenameValue] = useState("");
  const [editMode, setEditMode] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards/${params.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setDashboard(d.dashboard);
      setRenameValue(d.dashboard?.name ?? "");
    } catch {
      toast("Couldn't load dashboard");
    } finally {
      setLoading(false);
    }
  }, [params.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const rename = async () => {
    const trimmed = renameValue.trim();
    if (!dashboard || !trimmed || trimmed === dashboard.name) {
      setRenameValue(dashboard?.name ?? "");
      return;
    }
    const res = await fetch(`/api/dashboards/${dashboard.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      toast("Couldn't rename dashboard");
      setRenameValue(dashboard.name);
      return;
    }
    setDashboard({ ...dashboard, name: trimmed });
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy link"),
    );
  };

  const remove = async () => {
    if (!dashboard) return;
    const ok = await confirm({
      title: "Delete dashboard?",
      description: `"${dashboard.name}" will be deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/dashboards/${dashboard.id}`, { method: "DELETE" });
    if (res.ok) router.push("/dashboards");
    else toast("Couldn't delete dashboard");
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-zinc-500">
        Dashboard not found.
        <button
          type="button"
          onClick={() => router.push("/dashboards")}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Back to Dashboards
        </button>
      </div>
    );
  }

  const addCardPill = (
    <button
      type="button"
      onClick={() => setAddOpen(true)}
      className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[12.5px] font-semibold text-white hover:bg-zinc-800"
    >
      <Plus className="h-3.5 w-3.5" /> Add card
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => router.push("/dashboards")}
          className="shrink-0 text-[12.5px] text-zinc-500 hover:text-zinc-800"
        >
          Dashboards
        </button>
        <span className="text-zinc-300" aria-hidden>/</span>
        <input
          ref={titleRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13.5px] font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-300"
        />
        <button
          type="button"
          disabled
          title="Favorites for dashboards coming soon"
          aria-label="Favorite"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-400 disabled:opacity-60"
        >
          <Star className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
          <button
            ref={moreRef}
            type="button"
            aria-label="Dashboard actions"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <MorePortal anchorRef={moreRef} width={190} open={moreOpen} placement="below">
            <MenuList onMouseLeave={() => setMoreOpen(false)}>
              <MenuItem icon={Pencil} label="Rename" onClick={() => { setMoreOpen(false); titleRef.current?.focus(); titleRef.current?.select(); }} />
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete dashboard" destructive onClick={() => { setMoreOpen(false); void remove(); }} />
            </MenuList>
          </MorePortal>
        </div>
      </div>

      {/* Edit-mode toolbar */}
      <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <span className="text-[12.5px] text-zinc-600">Edit mode</span>
        <Switch checked={editMode} onChange={setEditMode} aria-label="Edit mode" />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { void load(); toast("Refreshed"); }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-zinc-500 hover:bg-zinc-100"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refreshed just now
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[12px] text-zinc-600 hover:bg-zinc-50"
          >
            Auto refresh: On
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-zinc-500 hover:bg-zinc-100"
          >
            <Filter className="h-3.5 w-3.5" /> Filters
          </button>
          {addCardPill}
        </div>
      </div>

      {/* Canvas — centered ClickUp empty state until widgets land. */}
      <div className="flex-1 overflow-y-auto bg-zinc-50 p-6">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <LayoutDashboard className="h-8 w-8 text-zinc-300" />
          <div className="text-[13.5px] font-semibold text-zinc-800">This Dashboard is empty</div>
          <p className="max-w-sm text-[12.5px] text-zinc-500">
            Add cards to visualize work across your boards.
          </p>
          <div className="mt-1">{addCardPill}</div>
        </div>
      </div>

      <AddCardPanel open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
