"use client";

/* Settings · Defaults & locks: the Admin door surface that finally writes
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
 * every resolve, so members can't override it: the control is frozen org-wide.
 * (See src/lib/preferences.ts getEffectivePreferences: defaults → org → user
 * → locked re-stamp.)
 */

import { ACCENT_CHOICE_OFFERED } from "@/lib/accents";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sun, Moon, Monitor, Check, Lock,
  Palette, Rows3, PanelLeft, LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsCard } from "@/components/settings/settings-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { PREFERENCE_LOCK_GROUPS } from "@/lib/preferences-locks";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Density = "compact" | "cozy" | "comfortable";

// Brand-safe subset of the customize-panel / appearance accent list
// (src/components/layout/os/customize-panel.tsx ACCENT_OPTIONS). The banned
// hues (purple/grape, pink, violet, indigo) are dropped on purpose: org
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

// Comfortable 44 (default) / Cozy 36 / Compact 32 (design-system 3.2).
const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "cozy",        label: "Cozy" },
  { value: "compact",     label: "Compact" },
];

// Each lock toggle owns the canonical dot-path(s) the effective-prefs merge
// re-stamps. "theme" freezes both appearance + accent (the two paths the
// customize panel disables); the rest are single scalars/arrays the merge
// re-stamps wholesale. Kept honest against src/lib/preferences.ts.
// The paths come from the one lockable list (src/lib/preferences-locks.ts),
// which PATCH /api/org/preferences also validates against.
const lockPaths = (key: (typeof PREFERENCE_LOCK_GROUPS)[number]["key"]): string[] => [
  ...(PREFERENCE_LOCK_GROUPS.find((g) => g.key === key)?.paths ?? []),
];

const LOCK_GROUPS: Array<{
  key: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  paths: string[];
}> = [
  {
    key: "theme",
    label: "Theme",
    desc: "Members can't change light or dark. Everyone gets the org default above.",
    Icon: Palette,
    paths: lockPaths("theme"),
  },
  {
    key: "density",
    label: "Density",
    desc: "Freezes row density to the org default. The per-member density control is disabled.",
    Icon: Rows3,
    paths: lockPaths("density"),
  },
  {
    key: "sidebar",
    label: "Sidebar layout",
    desc: "Freezes the collapsed (icons-only) vs. labeled sidebar to the org default. Members can't flip it.",
    Icon: PanelLeft,
    paths: lockPaths("sidebar"),
  },
  {
    key: "home",
    label: "Home cards",
    desc: "Freezes which cards show on Home to the org default. Members can't add or remove Home cards.",
    Icon: LayoutGrid,
    paths: lockPaths("home"),
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

// Identity & culture > Appearance defaults (the old /settings/defaults 308s
// to /settings/identity?tab=appearance). The org theme, density and the four
// locks, whose dot-paths come from src/lib/preferences-locks.ts.
export function AppearanceDefaults() {
  const { toast } = useOsToast();
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  // A failed read renders ErrorState: default values here would let the next
  // switch overwrite the workspace's real defaults and drop its locks.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/org/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as OrgPrefResponse;
      const p = data.preference;
      setState({
        appearance: p?.themeDefault?.appearance ?? "LIGHT",
        accent: p?.themeDefault?.accent ?? "workwrk",
        density: p?.densityDefault ?? "comfortable",
        lockedKeys: p?.lockedKeys ?? [],
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
    }
  }, []);

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
        if (!res.ok) {
          // A 400 from the strict schema names the key; show it, since
          // retrying a refused value never helps.
          const d = await res.json().catch(() => ({}));
          throw new Error(typeof d?.error === "string" ? d.error : "");
        }
        toast(okMsg);
      } catch (e) {
        toast(e instanceof Error && e.message ? `Couldn't save: ${e.message}` : "Couldn't save. Try again.");
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
    // locks set elsewhere): only add/remove this group's exact paths.
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
    <SettingsCard
      id="appearance-defaults"
      wide="identity.appearance"
      title="Appearance defaults"
      description={
        <>
          Set the look every member starts with, then lock any control to keep it consistent
          workspace-wide. A default seeds new members and anyone who hasn&apos;t customized; a lock
          re-stamps that setting on every load, so members can&apos;t override it.
        </>
      }
    >

      {loadError ? (
        <ErrorState compact what="the workspace defaults" hint={loadError} onRetry={() => { void load(); }} />
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : (
        <div className="space-y-8">
          {/* ── Appearance defaults ─────────────────────────── */}
          <section>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Default appearance
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              {/* Appearance */}
              <div className="mb-5">
                <h3 className="mb-2 text-base font-semibold text-zinc-800">Theme</h3>
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
                        <span className="text-base font-medium text-zinc-900">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent: hidden while the product offers one blue
                  (src/lib/accents.ts OFFERED_ACCENTS), the same rule as
                  Customize and My settings, so no swatch saves a colour
                  nobody sees. */}
              {ACCENT_CHOICE_OFFERED ? (
              <div className="mb-5">
                <h3 className="mb-2 text-base font-semibold text-zinc-800">Accent color</h3>
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
                          saving ? "opacity-60" : active ? "" : "hover:brightness-110"
                        }`}
                      >
                        {active ? <Check className="h-4 w-4 text-white" strokeWidth={3.5} /> : null}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  Brand-safe swatches only. WorkwrK is the default brand blue.
                </p>
              </div>
              ) : null}

              {/* Density */}
              <div>
                <h3 className="mb-2 text-base font-semibold text-zinc-800">Density</h3>
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
                        className={`rounded-md px-4 py-1.5 text-base font-medium transition-colors ${
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
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Locked controls
            </h2>

            <div className="mb-3 flex items-start gap-2.5 rounded-lg bg-brand-soft p-3.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} />
              <p className="text-base leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">A lock freezes a setting for every member.</span>{" "}
                While locked, that setting always resolves to the org default above: a member&apos;s own value is
                overridden on every load, so their change never sticks, and where My settings &gt;
                Preferences has a control for it, it shows the locked value instead. Unlock to hand the choice back.
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
                        <span className="text-base font-semibold text-zinc-900">{g.label}</span>
                        {locked && (
                          <span className="inline-flex items-center gap-1 rounded bg-[#0073EA]/10 px-1.5 py-0.5 text-xs font-semibold text-[#0073EA]">
                            <Lock className="h-2.5 w-2.5" /> Locked
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-base leading-relaxed text-zinc-500">{g.desc}</p>
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
            <p className="mt-2 text-xs text-zinc-400">
              Members tune their own look in{" "}
              <Link href="/account/preferences?tab=appearance" className="text-[#0073EA] hover:underline">
                My settings, Preferences
              </Link>
              . A locked setting there always reverts to the workspace default above.
            </p>
          </section>
        </div>
      )}
    </SettingsCard>
  );
}
