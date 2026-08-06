"use client";

/* Dashboard detail — ClickUp-parity chrome: breadcrumb header (Dashboards /
 * inline-rename + star), Share + "..." actions, Edit-mode toolbar row
 * (Refreshed just now · Auto refresh · Filters · dark Add card), the Add
 * Card gallery (AddCardPanel), and the widget canvas: a react-grid-layout
 * grid of WidgetShell cards persisted (debounce-PATCH) into
 * Dashboard.widgets. Widget model lives in components/dashboard/widget-types.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import {
  Filter, LayoutDashboard, Loader2, MoreHorizontal, Pencil, Plus,
  RefreshCw, Share2, Star, Trash2,
} from "lucide-react";
import "react-grid-layout/css/styles.css";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Switch } from "@/components/ui/switch";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { AddCardPanel } from "@/components/dashboard/add-card-panel";
import {
  createWidget, parseWidgets, serializeWidgets, WIDGET_LIMIT,
  type DashWidget, type WidgetPreset, type WidgetSource, type WidgetType,
} from "@/components/dashboard/widget-types";
import { WidgetShell, type BoardOption } from "@/components/dashboard/widgets/widget-shell";
import { StatWidget } from "@/components/dashboard/widgets/stat-widget";
import { NotesWidget } from "@/components/dashboard/widgets/notes-widget";
import { TaskListWidget } from "@/components/dashboard/widgets/task-list-widget";
import { BatteryWidget } from "@/components/dashboard/widgets/battery-widget";
import { ChartWidget } from "@/components/dashboard/widgets/chart-widget";

const ResponsiveGridLayout = WidthProvider(Responsive);

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

  // Widget canvas state. widgetsRef always mirrors the latest list so the
  // debounced PATCH never persists a stale snapshot.
  const [widgets, setWidgets] = useState<DashWidget[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const widgetsRef = useRef<DashWidget[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards/${params.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setDashboard(d.dashboard);
      setRenameValue(d.dashboard?.name ?? "");
      const parsed = parseWidgets(d.dashboard?.widgets);
      setWidgets(parsed);
      widgetsRef.current = parsed;
      setHydrated(true);
    } catch {
      toast("Couldn't load dashboard");
    } finally {
      setLoading(false);
    }
  }, [params.id, toast]);

  useEffect(() => { void load(); }, [load]);

  // Boards for the widget Source pickers — fetched once per page.
  useEffect(() => {
    let alive = true;
    fetch("/api/boards?all=1", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { boards: [] }))
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.boards) ? data.boards : [];
        setBoards(list.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ─── Widget persistence (optimistic UI + debounce-PATCH + retry) ───

  const pushWidgets = useCallback(async (attempt = 0) => {
    try {
      const res = await fetch(`/api/dashboards/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgets: serializeWidgets(widgetsRef.current) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (attempt === 0) {
        toast("Couldn't save dashboard — retrying…");
        setTimeout(() => { void pushWidgets(1); }, 1500);
      } else {
        toast("Couldn't save dashboard changes. Check your connection.");
      }
    }
  }, [params.id, toast]);

  const persistWidgets = useCallback((next: DashWidget[]) => {
    widgetsRef.current = next;
    setWidgets(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void pushWidgets(); }, 750);
  }, [pushWidgets]);

  // Flush a pending debounce on unmount so the last edit isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void pushWidgets();
      }
    };
  }, [pushWidgets]);

  const addWidget = useCallback((type: WidgetType, preset?: WidgetPreset) => {
    const current = widgetsRef.current;
    if (current.length >= WIDGET_LIMIT) {
      toast(`Dashboard card limit reached (${WIDGET_LIMIT})`);
      return;
    }
    const bottom = current.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
    persistWidgets([...current, createWidget(type, bottom, preset)]);
  }, [persistWidgets, toast]);

  const patchWidget = useCallback((id: string, patch: (w: DashWidget) => DashWidget) => {
    persistWidgets(widgetsRef.current.map((w) => (w.id === id ? patch(w) : w)));
  }, [persistWidgets]);

  const removeWidget = useCallback((id: string) => {
    persistWidgets(widgetsRef.current.filter((w) => w.id !== id));
  }, [persistWidgets]);

  const onLayoutChange = useCallback((current: Layout[]) => {
    if (!hydrated) return;
    const byId = new Map(current.map((l) => [l.i, l] as const));
    const prev = widgetsRef.current;
    const changed = prev.some((w) => {
      const l = byId.get(w.id);
      return l && (l.x !== w.layout.x || l.y !== w.layout.y || l.w !== w.layout.w || l.h !== w.layout.h);
    });
    if (!changed) return;
    persistWidgets(prev.map((w) => {
      const l = byId.get(w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    }));
  }, [hydrated, persistWidgets]);

  const gridLayout = useMemo<Layout[]>(
    () => widgets.map((w) => ({
      i: w.id, x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h, minW: 2, minH: 2,
    })),
    [widgets],
  );

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

      {/* Canvas — widget grid, or the centered empty state when bare. */}
      <div className="flex-1 overflow-y-auto bg-zinc-50">
        {widgets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <LayoutDashboard className="h-8 w-8 text-zinc-300" />
            <div className="text-[13.5px] font-semibold text-zinc-800">This Dashboard is empty</div>
            <p className="max-w-sm text-[12.5px] text-zinc-500">
              Add cards to visualize work across your boards.
            </p>
            <div className="mt-1">{addCardPill}</div>
          </div>
        ) : (
          <div className="px-3 py-2">
            <ResponsiveGridLayout
              className="layout mytasks-grid"
              layouts={{ lg: gridLayout }}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
              rowHeight={52}
              margin={[12, 12]}
              draggableCancel="a,button,input,textarea,select"
              resizeHandles={["s", "e", "se"]}
              compactType="vertical"
              isDraggable={editMode}
              isResizable={editMode}
              onLayoutChange={onLayoutChange}
            >
              {widgets.map((w) => (
                <div key={w.id}>
                  <WidgetShell
                    widget={w}
                    boards={boards}
                    onRename={(title) => patchWidget(w.id, (prev) => ({ ...prev, title }))}
                    onRemove={() => removeWidget(w.id)}
                    onSourceChange={(source: WidgetSource) =>
                      patchWidget(w.id, (prev) => ({ ...prev, config: { ...prev.config, source } }))}
                  >
                    <WidgetBody
                      widget={w}
                      editMode={editMode}
                      onConfigChange={(patch) =>
                        patchWidget(w.id, (prev) => ({ ...prev, config: { ...prev.config, ...patch } }))}
                    />
                  </WidgetShell>
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        )}
      </div>

      <AddCardPanel open={addOpen} onClose={() => setAddOpen(false)} onAdd={addWidget} />
    </div>
  );
}

/** Per-type widget body — all five widget types render live. */
function WidgetBody({
  widget,
  editMode,
  onConfigChange,
}: {
  widget: DashWidget;
  editMode: boolean;
  onConfigChange: (patch: Partial<DashWidget["config"]>) => void;
}) {
  switch (widget.type) {
    case "task-list":
      return <TaskListWidget widget={widget} />;
    case "stat":
      return <StatWidget widget={widget} editMode={editMode} onConfigChange={onConfigChange} />;
    case "notes":
      return <NotesWidget widget={widget} onConfigChange={onConfigChange} />;
    case "battery":
      return <BatteryWidget widget={widget} />;
    case "chart":
      return <ChartWidget widget={widget} editMode={editMode} onConfigChange={onConfigChange} />;
  }
}
