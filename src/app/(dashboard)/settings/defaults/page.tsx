"use client";

/* Settings · Defaults & locks — the Admin door surface that finally writes
 * the org-wide preference system.
 *
 * Reads GET  /api/org/preferences  → { preference: OrgPreference | null }
 * Writes PATCH /api/org/preferences (admin-gated, zod-validated) on every
 * change:
 *   - themeDefault.appearance  (light / dark / auto)
 *   - themeDefault.accent      (brand-safe swatch key)
 *   - densityDefault           (compact / cozy)
 *   - lockedKeys[]             (dot-paths the effective-prefs merge re-stamps
 *                               with the org value, freezing them against
 *                               per-user override)
 *
 * The defaults seed what a brand-new member sees and what anyone who never
 * customized keeps getting. A LOCK goes further: it re-stamps that key on
 * every resolve, so members can't override it — the control is frozen org-wide.
 * (See src/lib/preferences.ts getEffectivePreferences: defaults → org → user
 * → locked re-stamp.)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sliders, ChevronRight, Sun, Moon, Monitor, Check, Lock, Loader2,
  Palette, Rows3, PanelLeft, LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Density = "compact" | "cozy";

// Brand-safe subset of the customize-panel / appearance accent list
// (src/components/layout/os/customize-panel.tsx ACCENT_OPTIONS). The banned
// hues (purple/grape, pink, violet, indigo) are dropped on purpose — org
// defaults must stay on-brand, and the design system forbids those.
const ACCENT_OPTIONS: Array<{ key: string; label: string; swatch: string }> = [
  { key: "workwrk", label: "WorkwrK (brand blue)", swatch: "#0073EA" },
  { key: "black",   label: "Black",                swatch: "#1f2024" },
  { key: "blue",    label: "Blue",                 swatch: "#3b82f6" },
  { key: "teal",    label: "Teal",                 swatch: "#14b8a6" },
  { key: "mint",    label: "Mint",                 swatch: "#3ab39e" },
  { key: "orange",  label: "Orange",               swatch: "#f59e0b" },
  { key: "bronze",  label: "Bronze",               swatch: "#a78b6c" },
];

const APPEARANCE_CARDS: Array<{ value: Appearance; label: string; Icon: LucideIcon }> = [
  { value: "LIGHT", label: "Light", Icon: Sun },
  { value: "DARK",  label: "Dark",  Icon: Moon },
  { value: "AUTO",  label: "Auto",  Icon: Monitor },
];

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "cozy",    label: "Cozy" },
];

// Each lock toggle owns the canonical dot-path(s) the effective-prefs merge
// re-stamps. "theme" freezes both appearance + accent (the two paths the
// customize panel disables); the rest are single scalars/arrays the merge
// re-stamps wholesale. Kept honest against src/lib/preferences.ts.
const LOCK_GROUPS: Array<{
  key: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  paths: string[];
}> = [
  {
    key: "theme",
    label: "Theme (appearance + accent)",
    desc: "Members can't change light/dark or the accent color. Everyone gets the org defaults above.",
    Icon: Palette,
    paths: ["theme.appearance", "theme.accent"],
  },
  {
    key: "density",
    label: "Density",
    desc: "Freezes compact vs. cozy spacing to the org default. The per-member density control is disabled.",
    Icon: Rows3,
    paths: ["density"],
  },
  {
    key: "sidebar",
    label: "Sidebar layout",
    desc: "Freezes the collapsed (icons-only) vs. labeled sidebar to the org default. Members can't flip it.",
    Icon: PanelLeft,
    paths: ["sidebar.iconsOnly"],
  },
  {
    key: "home",
    label: "Home cards",
    desc: "Freezes which cards show on Home to the org default. Members can't add or remove Home cards.",
    Icon: LayoutGrid,
    paths: ["home.cards"],
  },
];

type State = {
  appearance: Appearance;
  accent: string;
  density: Density;
  lockedKeys: string[];
};

type OrgPrefResponse = {
  preference: {
    themeDefault?: { appearance?: Appearance; accent?: string } | null;
    densityDefault?: Density | null;
    lockedKeys?: string[] | null;
  } | null;
};

export default function DefaultsPage() {
  const { toast } = useOsToast();
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as OrgPrefResponse;
      const p = data.preference;
      setState({
        appearance: p?.themeDefault?.appearance ?? "LIGHT",
        accent: p?.themeDefault?.accent ?? "workwrk",
        density: p?.densityDefault ?? "cozy",
        lockedKeys: p?.lockedKeys ?? [],
      });
    } catch {
      setState({ appearance: "LIGHT", accent: "workwrk", density: "cozy", lockedKeys: [] });
      toast("Couldn't load org defaults");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // PATCH a partial body. Local state is set optimistically by the caller;
  // on failure we resync truth from the server.
  const patch = useCallback(
    async (body: Record<string, unknown>, okMsg: string) => {
      setSaving(true);
      try {
        const res = await fetch("/api/org/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        toast(okMsg);
      } catch {
        toast("Couldn't save — try again");
        void load();
      } finally {
        setSaving(false);
      }
    },
    [toast, load],
  );

  const pickAppearance = (appearance: Appearance) => {
    if (!state) return;
    setState({ ...state, appearance });
    void patch({ themeDefault: { appearance } }, "Default appearance saved");
  };

  const pickAccent = (accent: string) => {
    if (!state) return;
    setState({ ...state, accent });
    void patch({ themeDefault: { accent } }, "Default accent saved");
  };

  const pickDensity = (density: Density) => {
    if (!state) return;
    setState({ ...state, density });
    void patch({ densityDefault: density }, "Default density saved");
  };

  const isGroupLocked = (paths: string[]) =>
    !!state && paths.every((p) => state.lockedKeys.includes(p));

  const toggleLock = (group: { label: string; paths: string[] }, next: boolean) => {
    if (!state) return;
    // Preserve any locked keys outside this group (e.g. per-card home.cards.<key>
    // locks set elsewhere) — only add/remove this group's exact paths.
    const set = new Set(state.lockedKeys);
    for (const p of group.paths) {
      if (next) set.add(p);
      else set.delete(p);
    }
    const lockedKeys = [...set];
    setState({ ...state, lockedKeys });
    void patch(
      { lockedKeys },
      next ? `${group.label} locked for all members` : `${group.label} unlocked`,
    );
  };

  const loading = state === null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
          <Link href="/settings" className="hover:text-zinc-700">Settings</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Defaults &amp; locks</span>
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-[19px] font-semibold tracking-tight text-zinc-900">
          <Sliders className="h-5 w-5 text-[#0073EA]" />
          Defaults &amp; locks
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
          Set the look every member starts with, then lock any control to keep it consistent org-wide.
          A default seeds new members and anyone who hasn&apos;t customized; a{" "}
          <span className="font-medium text-zinc-700">lock</span> re-stamps that setting on every load, so
          members can&apos;t override it.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading org defaults…
        </div>
      ) : (
        <div className="space-y-8">
          {/* ── Appearance defaults ─────────────────────────── */}
          <section>
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Default appearance
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              {/* Appearance */}
              <div className="mb-5">
                <h3 className="mb-2 text-[13px] font-semibold text-zinc-800">Theme</h3>
                <div className="grid grid-cols-3 gap-3">
                  {APPEARANCE_CARDS.map((opt) => {
                    const active = state.appearance === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={saving}
                        onClick={() => pickAppearance(opt.value)}
                        style={{
                          background: "#fff",
                          border: active ? "1px solid #0073EA" : "1px solid #e4e4e7",
                          boxShadow: active ? "0 0 0 3px rgba(0,115,234,0.15)" : "none",
                        }}
                        className={`flex flex-col items-start gap-2 rounded-xl p-3 text-left transition-all ${
                          saving ? "opacity-60" : "hover:border-zinc-300"
                        }`}
                      >
                        <opt.Icon className="h-4 w-4 text-zinc-600" />
                        <span className="text-[13px] font-medium text-zinc-900">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent */}
              <div className="mb-5">
                <h3 className="mb-2 text-[13px] font-semibold text-zinc-800">Accent color</h3>
                <div className="flex flex-wrap gap-2.5">
                  {ACCENT_OPTIONS.map((a) => {
                    const active = state.accent === a.key;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        disabled={saving}
                        onClick={() => pickAccent(a.key)}
                        title={a.label}
                        aria-label={a.label}
                        aria-pressed={active}
                        style={{
                          background: a.swatch,
                          boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #18181b" : "none",
                        }}
                        className={`flex h-9 w-9 items-center justify-center rounded-full transition-transform ${
                          saving ? "opacity-60" : active ? "" : "hover:scale-105"
                        }`}
                      >
                        {active ? <Check className="h-4 w-4 text-white" strokeWidth={3.5} /> : null}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11.5px] text-zinc-400">
                  Brand-safe swatches only. WorkwrK is the default brand blue.
                </p>
              </div>

              {/* Density */}
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-zinc-800">Density</h3>
                <div
                  className="inline-flex rounded-lg p-0.5"
                  style={{ background: "#f4f4f5", border: "1px solid #e4e4e7" }}
                >
                  {DENSITY_OPTIONS.map((opt) => {
                    const active = state.density === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={saving}
                        onClick={() => pickDensity(opt.value)}
                        style={{
                          background: active ? "#fff" : "transparent",
                          boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                        }}
                        className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
                          saving ? "opacity-60" : ""
                        } ${active ? "text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── Locks ───────────────────────────────────────── */}
          <section>
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Locked controls
            </h2>

            <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-[#0073EA]/20 bg-[#0073EA]/[0.04] p-3.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#0073EA]" />
              <p className="text-[12.5px] leading-relaxed text-zinc-600">
                <span className="font-semibold text-zinc-800">A lock freezes a control for every member.</span>{" "}
                While locked, that setting always resolves to the org default above — the matching control is
                disabled in each member&apos;s Appearance page and Customize panel, and any value they had is
                overridden. Unlock to hand the choice back.
              </p>
            </div>

            <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {LOCK_GROUPS.map((g, i) => {
                const locked = isGroupLocked(g.paths);
                return (
                  <li
                    key={g.key}
                    className={`flex items-start gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-zinc-100" : ""}`}
                  >
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
                      <g.Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-zinc-900">{g.label}</span>
                        {locked && (
                          <span className="inline-flex items-center gap-1 rounded bg-[#0073EA]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0073EA]">
                            <Lock className="h-2.5 w-2.5" /> Locked
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{g.desc}</p>
                    </div>
                    <div className="mt-0.5 shrink-0">
                      <Switch
                        checked={locked}
                        disabled={saving}
                        onChange={(next) => toggleLock(g, next)}
                        aria-label={`Lock ${g.label}`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11.5px] text-zinc-400">
              Members tune their own look in{" "}
              <Link href="/account/appearance" className="text-[#0073EA] hover:underline">
                Appearance
              </Link>{" "}
              (Personal door) — anything you lock here is greyed out there.
            </p>
          </section>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
