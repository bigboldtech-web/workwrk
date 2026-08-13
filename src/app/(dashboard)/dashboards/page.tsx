"use client";

/* Dashboards — list of user-created dashboards.
 *
 *  GET  /api/dashboards (?mine=1 → owned only)
 *  POST /api/dashboards { name }
 *
 * `?new=1` opens the create card on mount (the app-rail "New Dashboard"
 * action and the sidebar "+" deep-link land here). The widget canvas
 * itself is a placeholder until the Dashboard view phase
 * (docs/plans/views-catalog.md §B).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BarChart3, LayoutDashboard, Loader2, Plus, Timer as TimerIcon, Users as UsersIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { useOsToast } from "@/components/layout/os/toast";
import { TAUPE, taupeButton } from "@/components/ui/accent";

type ApiDashboard = {
  id: string;
  name: string;
  description?: string | null;
  ownerId?: string | null;
  widgets?: unknown[];
  createdAt: string;
  updatedAt: string;
};

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useOsToast();
  const mine = searchParams.get("mine") === "1";
  const [dashboards, setDashboards] = useState<ApiDashboard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // The Dashboards "+" routes here with ?new=1 → open the create card and
  // strip the param via the router. useState only seeds the FIRST render,
  // so the old seed-once version left the "+" dead whenever this page was
  // already mounted. Armed latch: disarms on fire, re-arms when the param
  // leaves the URL, so every "+" click opens the card.
  const newArmed = useRef(true);
  useEffect(() => {
    if (searchParams.get("new") !== "1") { newArmed.current = true; return; }
    if (!newArmed.current) return;
    newArmed.current = false;
    setCreating(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const qs = params.toString();
    router.replace(qs ? `/dashboards?${qs}` : "/dashboards", { scroll: false });
  }, [searchParams, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards${mine ? "?mine=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setDashboards(d.dashboards ?? []);
    } catch {
      setDashboards([]);
      toast("Couldn't load dashboards");
    }
  }, [mine, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (creating) setTimeout(() => nameRef.current?.focus(), 0);
  }, [creating]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Couldn't create dashboard");
        return;
      }
      const data = await res.json();
      router.push(`/dashboards/${data.dashboard.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <OsTitleBar
        title={mine ? "My Dashboards" : "Dashboards"}
        Icon={LayoutDashboard}
        iconGradient=""
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[12.5px] font-semibold text-white hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            New Dashboard
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {creating ? (
          <div className="mb-4 max-w-md rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="mb-2 text-[13px] font-semibold text-zinc-900">New dashboard</div>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Dashboard name"
              className="h-8 w-full rounded-lg border bg-white px-2.5 text-[13px] outline-none"
              style={{ borderColor: TAUPE.ring }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-8 rounded-lg border border-zinc-200 px-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void create()}
                disabled={!name.trim() || busy}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-white ${taupeButton}`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        ) : null}

        {dashboards === null ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : dashboards.length === 0 && !creating ? (
          // ClickUp's "Choose a Dashboard template" chooser (chrome only —
          // every card opens the same create flow for now).
          <div className="flex flex-col items-center pt-16">
            <h2 className="text-[20px] font-semibold text-zinc-900">Choose a Dashboard template</h2>
            <p className="mt-1 max-w-md text-center text-[13px] text-zinc-500">
              Get started with a Dashboard template or create a custom Dashboard to fit your exact needs.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { name: "Simple Dashboard", desc: "Manage and prioritize tasks", Icon: LayoutDashboard },
                { name: "Team Center", desc: "View team activity", Icon: UsersIcon },
                { name: "Time Tracking", desc: "View and report on time tracking metrics", Icon: TimerIcon },
                { name: "Project Management", desc: "Analyze project progress and metrics", Icon: BarChart3 },
                { name: "Start from scratch", desc: "A blank canvas for your widgets", Icon: Plus },
              ].map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-56 rounded-lg border border-zinc-200 bg-white p-4 text-left hover:border-zinc-300 hover:shadow-sm"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-zinc-50">
                    <t.Icon className="h-4 w-4 text-zinc-600" />
                  </span>
                  <div className="mt-3 text-[13px] font-semibold text-zinc-900">{t.name}</div>
                  <p className="mt-0.5 text-[12px] text-zinc-500">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboards.map((d) => (
              <Link
                key={d.id}
                href={`/dashboards/${d.id}`}
                className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4 text-zinc-500" />
                  <span className="truncate text-[13.5px] font-semibold text-zinc-900">{d.name}</span>
                </div>
                {d.description ? (
                  <p className="mb-2 line-clamp-2 text-[12px] text-zinc-500">{d.description}</p>
                ) : null}
                <div className="text-[11.5px] text-zinc-400">
                  {Array.isArray(d.widgets) ? d.widgets.length : 0} widgets · edited {relTime(d.updatedAt)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
