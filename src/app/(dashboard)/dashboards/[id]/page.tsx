"use client";

/* Dashboard detail — toolbar (back, inline-editable title) + the
 * widget canvas. v1 the canvas is an honest placeholder: the widget
 * system lands with the Dashboard view phase
 * (docs/plans/views-catalog.md §B). Rename persists via PATCH.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, LayoutDashboard, Loader2 } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [renameValue, setRenameValue] = useState("");

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => router.push("/dashboards")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="Back to Dashboards"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <LayoutDashboard className="h-4 w-4 shrink-0 text-purple-500" />
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[14px] font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-300"
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-zinc-50 p-6">
        {/* Widget canvas placeholder — real widgets (numbers, charts,
            lists over board data) land with the Dashboard view phase. */}
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/60 text-center">
          <LayoutDashboard className="h-7 w-7 text-zinc-300" />
          <div className="text-[13.5px] font-semibold text-zinc-700">Your widget canvas</div>
          <p className="max-w-sm text-[12.5px] text-zinc-500">
            Widgets — numbers, charts and lists over your boards — are coming with the
            Dashboard views build. This dashboard is saved and ready for them.
          </p>
        </div>
      </div>
    </div>
  );
}
