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
 *
 * ONE CARD (settings-cleanup Phase 5, B4 and B5): the defaults are rows with
 * the shared segmented control (Theme reads Light · Dark · System, the words
 * My settings > Preferences uses for the same setting), then the "Locks"
 * sub-heading, the one consequence sentence a lock carries (visible: a lock
 * switch saves with no confirm), the rest of that explanation behind Show
 * more, and one row per lock. The icons-only "Sidebar layout" lock is gone:
 * the rail lost that mode (design-system 4.1), so it locked nothing anyone
 * could see. A workspace that stored its key keeps it: the key still reads,
 * and every later lock change carries it through (nextLockedKeys here,
 * refusedLockedKeys in the route).
 */

import { ACCENT_CHOICE_OFFERED } from "@/lib/accents";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsMore } from "@/components/settings/settings-more";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { PREFERENCE_LOCK_GROUPS, nextLockedKeys } from "@/lib/preferences-locks";

export type Appearance = "LIGHT" | "DARK" | "AUTO";
export type Density = "compact" | "cozy" | "comfortable";

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

/** Theme, in the words My settings > Preferences uses (design-system 5.12): AUTO reads System. */
export const THEME_OPTIONS: Array<{ value: Appearance; label: string }> = [
  { value: "LIGHT", label: "Light" },
  { value: "DARK",  label: "Dark" },
  { value: "AUTO",  label: "System" },
];

// Comfortable 44 (default) / Cozy 36 / Compact 32 (design-system 3.2).
const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "cozy",        label: "Cozy" },
  { value: "compact",     label: "Compact" },
];

/** The card's one description line (B4: at most two). */
export const APPEARANCE_DEFAULTS_DESCRIPTION = "The look every member starts with. A default applies to new members and anyone who hasn't chosen their own.";

/**
 * What a lock does to every member, shown under the Locks sub-heading and
 * never behind Show more: a lock switch saves at once, with no confirm.
 */
export const LOCK_CONSEQUENCE = "A lock freezes a setting for every member: their own choice is overridden on every load.";

// Each lock switch owns the canonical dot-path(s) the effective-prefs merge
// re-stamps. "theme" freezes both appearance + accent (the two paths the
// customize panel disables); the rest are single scalars/arrays the merge
// re-stamps wholesale. The paths come from the one lockable list
// (src/lib/preferences-locks.ts), which PATCH /api/org/preferences also
// validates against. The visible label is the switch's name, so a screen
// reader hears the words on the row first.
const LOCK_WORDS: Record<(typeof PREFERENCE_LOCK_GROUPS)[number]["key"], { label: string; desc: string; toast: string }> = {
  theme: { label: "Lock the theme", desc: "Members can't change light or dark. Everyone gets the default above.", toast: "Theme" },
  density: { label: "Lock density", desc: "Everyone gets the default density. Members can't change their own.", toast: "Density" },
  home: { label: "Lock Home cards", desc: "Everyone gets the default Home cards. Members can't add or remove any.", toast: "Home cards" },
};

export const LOCK_ROWS: Array<{ key: string; label: string; desc: string; toast: string; paths: string[] }> = PREFERENCE_LOCK_GROUPS.map((g) => ({
  key: g.key,
  ...LOCK_WORDS[g.key],
  paths: [...g.paths],
}));

export type AppearanceState = {
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

/** The card's state from GET /api/org/preferences (pure; tested). Every stored lock key is kept, a retired one too. */
export function appearanceStateOf(data: OrgPrefResponse): AppearanceState {
  const p = data.preference;
  return {
    appearance: p?.themeDefault?.appearance ?? "LIGHT",
    accent: p?.themeDefault?.accent ?? "workwrk",
    density: p?.densityDefault ?? "comfortable",
    lockedKeys: Array.isArray(p?.lockedKeys) ? p.lockedKeys.filter((k): k is string => typeof k === "string") : [],
  };
}

// Identity & culture > Appearance defaults (the old /settings/defaults 308s
// to /settings/identity?tab=appearance). The org theme, density and the
// three locks, whose dot-paths come from src/lib/preferences-locks.ts.
export function AppearanceDefaults() {
  const { toast } = useOsToast();
  const [state, setState] = useState<AppearanceState | null>(null);
  const [saving, setSaving] = useState(false);
  // A failed read renders ErrorState: default values here would let the next
  // switch overwrite the workspace's real defaults and drop its locks.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/org/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setState(appearanceStateOf((await res.json()) as OrgPrefResponse));
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

  // A write in flight holds every control (the old tiles were disabled
  // meanwhile): a second pick waits for the first to land.
  const pickAppearance = (appearance: Appearance) => {
    if (!state || saving) return;
    setState({ ...state, appearance });
    void patch({ themeDefault: { appearance } }, "Default appearance saved");
  };

  const pickAccent = (accent: string) => {
    if (!state || saving) return;
    setState({ ...state, accent });
    void patch({ themeDefault: { accent } }, "Default accent saved");
  };

  const pickDensity = (density: Density) => {
    if (!state || saving) return;
    setState({ ...state, density });
    void patch({ densityDefault: density }, "Default density saved");
  };

  const toggleLock = (row: { toast: string; paths: string[] }, next: boolean) => {
    if (!state || saving) return;
    // Preserve any locked keys outside this group (a per-card home.cards.<key>
    // lock set elsewhere, a retired sidebar.iconsOnly): only this group's
    // exact paths are added or removed.
    const lockedKeys = nextLockedKeys(state.lockedKeys, row.paths, next);
    setState({ ...state, lockedKeys });
    void patch(
      { lockedKeys },
      next ? `${row.toast} locked for all members` : `${row.toast} unlocked`,
    );
  };

  return (
    <AppearanceDefaultsCard
      state={state}
      loadError={loadError}
      saving={saving}
      onRetry={() => { void load(); }}
      onAppearance={pickAppearance}
      onAccent={pickAccent}
      onDensity={pickDensity}
      onLock={toggleLock}
    />
  );
}

/** Whether every path of a lock row is in the stored lockedKeys. */
export const isRowLocked = (lockedKeys: readonly string[], paths: readonly string[]) => paths.every((p) => lockedKeys.includes(p));

/** The one Appearance defaults card, drawn from its state (exported for the tests). */
export function AppearanceDefaultsCard({
  state,
  loadError,
  saving,
  onRetry,
  onAppearance,
  onAccent,
  onDensity,
  onLock,
}: {
  state: AppearanceState | null;
  loadError: string | null;
  saving: boolean;
  onRetry: () => void;
  onAppearance: (v: Appearance) => void;
  onAccent: (v: string) => void;
  onDensity: (v: Density) => void;
  onLock: (row: { toast: string; paths: string[] }, next: boolean) => void;
}) {
  return (
    <SettingsCard id="appearance-defaults" title="Appearance defaults" description={APPEARANCE_DEFAULTS_DESCRIPTION}>
      {loadError ? (
        <ErrorState compact what="the workspace defaults" hint={loadError} onRetry={onRetry} />
      ) : state === null ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <div>
            <SettingsRow
              id="identity.appearance.theme"
              label="Theme"
              helper="Light, dark, or follow each person's device"
              control={<SegmentedControl<Appearance> label="Theme" value={state.appearance} options={THEME_OPTIONS} onChange={onAppearance} />}
            />
            {/* Accent: hidden while the product offers one blue
                (src/lib/accents.ts OFFERED_ACCENTS), the same rule as
                Customize and My settings, so no swatch saves a colour
                nobody sees. */}
            {ACCENT_CHOICE_OFFERED ? (
              <SettingsRow
                id="identity.appearance.accent"
                label="Accent color"
                helper="Brand-safe swatches only. WorkwrK is the default brand blue."
                control={
                  <span className="flex flex-wrap gap-2" role="group" aria-label="Accent color">
                    {ACCENT_OPTIONS.map((a) => {
                      const active = state.accent === a.key;
                      return (
                        <button
                          key={a.key}
                          type="button"
                          aria-disabled={saving || undefined}
                          onClick={() => onAccent(a.key)}
                          title={a.label}
                          aria-label={a.label}
                          aria-pressed={active}
                          style={{
                            background: a.swatch,
                            boxShadow: active ? "0 0 0 2px var(--os-surface, var(--os-bg)), 0 0 0 4px var(--os-ink)" : "none",
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full aria-disabled:opacity-60"
                        >
                          {active ? <Check className="h-4 w-4 text-white" strokeWidth={3.5} aria-hidden /> : null}
                        </button>
                      );
                    })}
                  </span>
                }
              />
            ) : null}
            <SettingsRow
              id="identity.appearance.density"
              label="Density"
              helper="How tall table and list rows are"
              control={<SegmentedControl<Density> label="Density" value={state.density} options={DENSITY_OPTIONS} onChange={onDensity} />}
            />
          </div>

          <div id="identity.appearance.locks">
            <h3 className="text-sm font-medium text-ink">Locks</h3>
            <p className="mt-1 text-sm text-ink-2">{LOCK_CONSEQUENCE}</p>
            <SettingsMore className="mt-1">
              <p>
                While locked, a setting always resolves to the default above, so a member&apos;s change never sticks. Where My settings,
                Preferences has a control for it, that control shows the locked value instead. Unlock to hand the choice back.
              </p>
              <p>
                Members tune their own look in{" "}
                <Link href="/account/preferences?tab=appearance" className="font-medium text-brand-deep hover:underline">My settings, Preferences</Link>.
              </p>
            </SettingsMore>
            <div className="mt-2">
              {LOCK_ROWS.map((r) => (
                <SettingsRow
                  key={r.key}
                  id={`identity.lock.${r.key}`}
                  label={r.label}
                  helper={r.desc}
                  helperId={`identity-lock-${r.key}-hint`}
                  control={
                    <Switch
                      checked={isRowLocked(state.lockedKeys, r.paths)}
                      aria-disabled={saving}
                      onChange={(next) => onLock(r, next)}
                      aria-label={r.label}
                      aria-describedby={`identity-lock-${r.key}-hint`}
                    />
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
