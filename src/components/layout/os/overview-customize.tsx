"use client";

// OverviewCustomizeBanner + OverviewToolbar — Overview-tab chrome that
// matches the ClickUp screenshot exactly. Banner is dismissible
// (sessionStorage so it doesn't pop back every reload). Toolbar is
// visual-only for v1 — the Refresh / Filter / Settings / + Card
// affordances land when we wire customize-cards persistence.

import { useEffect, useState } from "react";
import { Lightbulb, X, RefreshCcw, ListFilter, Settings, Plus, ChevronDown } from "lucide-react";

const DISMISS_KEY = "workwrk:overview:customize-dismissed";

export function OverviewCustomizeBanner() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
      setHidden(dismissed);
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-md text-[12.5px] border"
      style={{
        background: "color-mix(in srgb, var(--os-brand) 8%, transparent)",
        borderColor: "color-mix(in srgb, var(--os-brand) 24%, transparent)",
        color: "var(--os-ink, #18181b)",
      }}
    >
      <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--os-brand)" }} />
      <span className="flex-1">
        Get the most out of your Overview! Add, reorder, and resize cards to customize this page.{" "}
        <button
          type="button"
          className="underline font-medium hover:opacity-80"
          style={{ color: "var(--os-brand)" }}
        >
          Get Started
        </button>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try { window.sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
          setHidden(true);
        }}
        className="p-0.5 rounded hover:bg-black/5 shrink-0 text-zinc-500"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function OverviewToolbar() {
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    setRefreshedAt(new Date());
  }, []);

  return (
    <div className="flex items-center gap-2 text-[12px]">
      <div className="flex items-center gap-1.5 text-zinc-500">
        <RefreshCcw className="w-3 h-3" />
        <span>Refreshed: {refreshedAt ? relTime(refreshedAt) : "just now"}</span>
      </div>
      <button
        type="button"
        onClick={() => setAutoRefresh((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-zinc-700 hover:bg-zinc-50 border border-zinc-200"
        title="Toggle auto-refresh"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? "bg-emerald-500" : "bg-zinc-300"}`}
        />
        Auto refresh: {autoRefresh ? "On" : "Off"}
        <ChevronDown className="w-3 h-3 text-zinc-400" />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Filter"
        title="Filter"
        className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
      >
        <ListFilter className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
      >
        <Settings className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-white"
        style={{ background: "var(--os-brand)" }}
        title="Add a card"
      >
        <Plus className="w-3.5 h-3.5" />
        Card
      </button>
    </div>
  );
}

function relTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleString();
}
