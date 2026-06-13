"use client";

// Account · Notifications — per-user email notification preferences.
// Backed by GET /api/email-preferences (booleans) + PATCH the same route
// with a single { <field>: bool } body. Each preference is one row: a
// label + sublabel on the left, a sliding toggle switch on the right.
// USER-level (no admin gate). Optimistic toggles; revert + toast on error.

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

// The five boolean preferences returned by /api/email-preferences, in the
// order they render. Keys match the API field names exactly so we can PATCH
// { [key]: newBool } directly.
type Prefs = {
  kraNotifications: boolean;
  reviewNotifications: boolean;
  sopNotifications: boolean;
  kudosNotifications: boolean;
  dailyDigest: boolean;
};

type PrefKey = keyof Prefs;

const ROWS: Array<{ key: PrefKey; label: string; sub: string }> = [
  { key: "kraNotifications", label: "KRA & KPI updates", sub: "Assignments and score activity" },
  { key: "reviewNotifications", label: "Review reminders", sub: "Weekly & cycle reviews" },
  { key: "sopNotifications", label: "SOP updates", sub: "New & changed procedures you're assigned" },
  { key: "kudosNotifications", label: "Kudos received", sub: "When a teammate recognizes you" },
  { key: "dailyDigest", label: "Daily digest email", sub: "One summary email each morning" },
];

/** Toggle switch built as a <button> so it survives the `.workwrk-os`
 *  input reset. Rounded-full track + sliding knob; on = bg-zinc-900. */
function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-zinc-900" : "bg-zinc-200"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function NotificationsPage() {
  const { toast } = useOsToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState<PrefKey | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/email-preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Partial<Prefs>;
      setPrefs({
        kraNotifications: !!data.kraNotifications,
        reviewNotifications: !!data.reviewNotifications,
        sopNotifications: !!data.sopNotifications,
        kudosNotifications: !!data.kudosNotifications,
        dailyDigest: !!data.dailyDigest,
      });
    } catch {
      // Render with everything off rather than blocking — a failed save
      // will toast and revert anyway.
      setPrefs({
        kraNotifications: false,
        reviewNotifications: false,
        sopNotifications: false,
        kudosNotifications: false,
        dailyDigest: false,
      });
      toast("Couldn't load notification settings");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: PrefKey) => {
    if (!prefs) return;
    const next = !prefs[key];
    // Optimistic flip.
    setPrefs((p) => (p ? { ...p, [key]: next } : p));
    setSaving(key);
    try {
      const res = await fetch("/api/email-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch {
      // Revert on failure.
      setPrefs((p) => (p ? { ...p, [key]: !next } : p));
      toast("Couldn't save — try again");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Bell className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Notifications</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Choose which emails WorkwrK sends you. Changes save automatically.
      </p>

      {prefs === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-900">{row.label}</div>
                <div className="text-[12px] text-zinc-500">{row.sub}</div>
              </div>
              <Toggle
                on={prefs[row.key]}
                disabled={saving === row.key}
                onClick={() => void toggle(row.key)}
                label={row.label}
              />
            </div>
          ))}
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
