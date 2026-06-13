"use client";

// Account · Appearance — per-user theme, accent, and density.
// Backed by GET /api/preferences ({ effective: { theme, density } }) and
// PATCH /api/preferences { theme: { appearance, accent }, density }. The
// applied result is read by ThemeApplier on the next load, so after a save
// we router.refresh() to re-pull the effective prefs into the shell.
// USER-level (no admin gate). Save-on-change with a toast.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Palette, Loader2, Check, Sun, Moon, Monitor } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Density = "compact" | "cozy";

type ThemeState = { appearance: Appearance; accent: string };

// Mirror of ACCENT_OPTIONS in components/layout/os/customize-panel.tsx —
// keep keys + swatch hex in sync with that source of truth.
const ACCENT_OPTIONS: Array<{ key: string; label: string; swatch: string }> = [
  { key: "black", label: "Black", swatch: "#1f2024" },
  { key: "purple", label: "Purple", swatch: "#7c3aed" },
  { key: "blue", label: "Blue", swatch: "#3b82f6" },
  { key: "pink", label: "Pink", swatch: "#ec4899" },
  { key: "violet", label: "Violet", swatch: "#a855f7" },
  { key: "indigo", label: "Indigo", swatch: "#6366f1" },
  { key: "orange", label: "Orange", swatch: "#f59e0b" },
  { key: "teal", label: "Teal", swatch: "#14b8a6" },
  { key: "bronze", label: "Bronze", swatch: "#a78b6c" },
  { key: "mint", label: "Mint", swatch: "#3ab39e" },
];

const APPEARANCE_CARDS: Array<{ value: Appearance; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: "LIGHT", label: "Light", Icon: Sun },
  { value: "DARK", label: "Dark", Icon: Moon },
  { value: "AUTO", label: "Auto", Icon: Monitor },
];

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "cozy", label: "Cozy" },
];

export default function AppearancePage() {
  const router = useRouter();
  const { toast } = useOsToast();

  const [theme, setTheme] = useState<ThemeState | null>(null);
  const [density, setDensity] = useState<Density | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as {
        effective?: { theme?: { appearance?: Appearance; accent?: string }; density?: Density };
      };
      const t = data.effective?.theme;
      setTheme({
        appearance: t?.appearance ?? "LIGHT",
        accent: t?.accent ?? "mint",
      });
      setDensity(data.effective?.density ?? "cozy");
    } catch {
      setTheme({ appearance: "LIGHT", accent: "mint" });
      setDensity("cozy");
      toast("Couldn't load appearance settings");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Persist a partial change. We optimistically set local state first
  // (caller does that), then PATCH the merged values and refresh so the
  // shell's ThemeApplier re-reads the effective prefs.
  const save = useCallback(
    async (nextTheme: ThemeState, nextDensity: Density) => {
      setSaving(true);
      try {
        const res = await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            theme: { appearance: nextTheme.appearance, accent: nextTheme.accent },
            density: nextDensity,
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        toast("Appearance saved");
        // ThemeApplier reads effective prefs — let live listeners + a
        // refresh re-apply without a full reload.
        window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
        router.refresh();
      } catch {
        toast("Couldn't save — try again");
        void load(); // resync truth from server on failure
      } finally {
        setSaving(false);
      }
    },
    [router, toast, load],
  );

  const pickAppearance = (appearance: Appearance) => {
    if (!theme || !density) return;
    const next = { ...theme, appearance };
    setTheme(next);
    void save(next, density);
  };

  const pickAccent = (accent: string) => {
    if (!theme || !density) return;
    const next = { ...theme, accent };
    setTheme(next);
    void save(next, density);
  };

  const pickDensity = (value: Density) => {
    if (!theme || !density) return;
    setDensity(value);
    void save(theme, value);
  };

  const loading = theme === null || density === null;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Palette className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Appearance</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Personalize your theme, accent color, and layout density. Changes apply across your devices.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-2xl space-y-7">
          {/* ── Theme ───────────────────────────────────── */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-zinc-800">Theme</h2>
            <div className="grid grid-cols-3 gap-3">
              {APPEARANCE_CARDS.map((opt) => {
                const active = theme.appearance === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    onClick={() => pickAppearance(opt.value)}
                    className={`flex flex-col items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-all hover:border-zinc-300 disabled:opacity-60 ${
                      active ? "ring-2 ring-zinc-900" : ""
                    }`}
                  >
                    <opt.Icon className="h-4 w-4 text-zinc-600" />
                    <span className="text-[13px] font-medium text-zinc-900">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Accent ──────────────────────────────────── */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-zinc-800">Accent</h2>
            <div className="flex flex-wrap gap-2.5">
              {ACCENT_OPTIONS.map((a) => {
                const active = theme.accent === a.key;
                return (
                  <button
                    key={a.key}
                    type="button"
                    disabled={saving}
                    onClick={() => pickAccent(a.key)}
                    title={a.label}
                    aria-label={a.label}
                    aria-pressed={active}
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:opacity-60 ${
                      active ? "ring-2 ring-zinc-900 ring-offset-2" : "hover:scale-105"
                    }`}
                    style={{ background: a.swatch }}
                  >
                    {active ? <Check className="h-4 w-4 text-white" strokeWidth={3.5} /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Density ─────────────────────────────────── */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-zinc-800">Density</h2>
            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5">
              {DENSITY_OPTIONS.map((opt) => {
                const active = density === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    onClick={() => pickDensity(opt.value)}
                    className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${
                      active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
