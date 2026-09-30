"use client";

// My settings > Preferences (spec-account-auth `/account/preferences`):
// three tabs, autosave throughout (no Save bar, so no blue button).
//
//   Appearance        Theme, Chrome (only once CHROME_CONTROL_EXPOSED), Density
//                     (default Comfortable), Reduced motion, Show upcoming
//                     features. There is no Accent row: after the one-blue
//                     decision it would change nothing a person can see. The
//                     Customize panel keeps its accent swatches for now.
//   Language & region Language, Time zone (with a device mismatch check),
//                     Week starts on, Date format, Time format
//   Sidebar           Width, Start collapsed, Quick actions in the avatar
//                     menu, Section order, Work sidebar rows
//
// Every control writes through the shell's patchPrefs (PATCH /api/preferences,
// strict at every level): optimistic, reverted on failure, a "Saved" tick on
// success and a Retry on the row when it failed. A key the workspace locked
// renders as its value plus a lock, never a greyed control. Every row names
// a real reader (settings-architecture 9.1): nothing here is decoration.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useOsShell, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/components/layout/os/shell-context";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { SECTIONS, ROWS } from "@/components/layout/os/customize-panel";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { btn } from "@/components/account/account-ui";
import { settingsTabs } from "@/lib/settings-registry";
import { CHROME_CONTROL_EXPOSED } from "@/lib/nav/labels";
import { readSidebarCards, type SidebarOptionalKey } from "@/lib/home-prefs";
import { PERSONAL_TOOLS, readToolPins } from "@/components/layout/os/personal-tools";
import type { DensityPref } from "@/lib/preferences";
import type { PreferencesPatch } from "@/lib/preferences-schema";
import {
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  TIME_FORMAT_OPTIONS,
  WEEK_START_OPTIONS,
  deviceTimeZone,
  timeZoneOptions,
} from "@/lib/account/locale-options";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Chrome = "navy" | "light";

const TABS: readonly SettingsTab[] = settingsTabs("account/preferences");

const selectCls = "h-9 max-w-[260px] rounded-md border border-line-strong bg-raised px-2 text-base text-ink";

/** Per-row save state: the tick after a write, the Retry after a failure. */
function useRowWrites() {
  const { patchPrefs } = useOsShell();
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Record<string, PreferencesPatch>>({});
  const write = useCallback(
    async (key: string, patch: PreferencesPatch) => {
      const ok = await patchPrefs(patch);
      if (ok) {
        setSavedAt((s) => ({ ...s, [key]: Date.now() }));
        setFailed((f) => { const n = { ...f }; delete n[key]; return n; });
      } else {
        setFailed((f) => ({ ...f, [key]: patch }));
      }
      return ok;
    },
    [patchPrefs],
  );
  const row = (key: string) => ({
    savedAt: savedAt[key] ?? null,
    error: failed[key] ? { message: "Couldn't save", onRetry: () => { void write(key, failed[key]); } } : null,
  });
  return { write, row };
}

export default function PreferencesPage() {
  return (
    <SettingsPage pageKey="account/preferences" tabs={TABS}>
      {(tab) => (
        <>
          <p className="-mt-2 mb-5 text-sm text-ink-2">These apply to you on every device.</p>
          {tab === "region" ? <RegionTab /> : tab === "sidebar" ? <SidebarTab /> : <AppearanceTab />}
        </>
      )}
    </SettingsPage>
  );
}

function AppearanceTab() {
  const { prefs } = useOsShell();
  const { write, row } = useRowWrites();
  const locked = new Set(prefs.lockedKeys ?? []);
  const appearance: Appearance = prefs.theme.appearance ?? "LIGHT";
  const chrome: Chrome = prefs.theme.chrome ?? "navy";
  const density: DensityPref = prefs.density ?? "comfortable";
  const ui = prefs.home.ui ?? {};
  const APPEARANCE_LABEL: Record<Appearance, string> = { LIGHT: "Light", DARK: "Dark", AUTO: "System" };
  const DENSITY_LABEL: Record<DensityPref, string> = { comfortable: "Comfortable", cozy: "Cozy", compact: "Compact" };

  return (
    <SettingsCardStack>
      <SettingsCard title="Theme" id="preferences.appearance.theme">
        <div>
          <SettingsRow
            id="preferences.appearance.theme.appearance"
            label="Theme"
            helper="Light, dark, or follow your device"
            {...row("theme")}
            lock={locked.has("theme.appearance") ? { value: APPEARANCE_LABEL[appearance] } : null}
            control={
              <SegmentedControl<Appearance>
                label="Theme"
                value={appearance}
                options={[{ value: "LIGHT", label: "Light" }, { value: "DARK", label: "Dark" }, { value: "AUTO", label: "System" }]}
                onChange={(v) => { void write("theme", { theme: { appearance: v } }); }}
              />
            }
          />
          {CHROME_CONTROL_EXPOSED ? (
            <SettingsRow
              id="preferences.appearance.chrome"
              label="Chrome"
              helper="The rail and the top bar"
              {...row("chrome")}
              lock={locked.has("theme.chrome") ? { value: chrome === "light" ? "Light" : "Navy" } : null}
              control={
                <SegmentedControl<Chrome>
                  label="Chrome"
                  value={chrome}
                  options={[{ value: "navy", label: "Navy" }, { value: "light", label: "Light" }]}
                  onChange={(v) => { void write("chrome", { theme: { chrome: v } }); }}
                />
              }
            />
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard title="Display" id="preferences.appearance.display">
        <div>
          <SettingsRow
            id="preferences.appearance.density"
            label="Density"
            helper="How tall table and list rows are"
            {...row("density")}
            lock={locked.has("density") ? { value: DENSITY_LABEL[density] } : null}
            control={
              <SegmentedControl<DensityPref>
                label="Density"
                value={density}
                options={[{ value: "comfortable", label: "Comfortable" }, { value: "cozy", label: "Cozy" }, { value: "compact", label: "Compact" }]}
                onChange={(v) => { void write("density", { density: v }); }}
              />
            }
          />
          <SettingsRow
            id="preferences.appearance.reducedMotion"
            label="Reduced motion"
            helper="Turns off animations. Off follows your device"
            {...row("motion")}
            control={<Switch checked={ui.reducedMotion === true} onChange={(v) => { void write("motion", { home: { ui: { reducedMotion: v } } }); }} aria-label="Reduced motion" />}
          />
          <SettingsRow
            id="preferences.appearance.showUpcoming"
            label="Show upcoming features"
            helper="Reveals rows we are still building, marked Coming soon"
            {...row("upcoming")}
            control={<Switch checked={ui.showUpcoming === true} onChange={(v) => { void write("upcoming", { home: { ui: { showUpcoming: v } } }); }} aria-label="Show upcoming features" />}
          />
        </div>
      </SettingsCard>
    </SettingsCardStack>
  );
}

function RegionTab() {
  const { prefs } = useOsShell();
  const { write, row } = useRowWrites();
  const locale = prefs.home.locale ?? {};
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDevice(deviceTimeZone()), 0);
    return () => window.clearTimeout(t);
  }, []);
  const zones = useMemo(() => timeZoneOptions(locale.timezone), [locale.timezone]);
  const zone = locale.timezone ?? "";
  const mismatch = !!device && !!zone && zone !== device;
  const set = (key: string, patch: NonNullable<NonNullable<PreferencesPatch["home"]>["locale"]>) => {
    void write(key, { home: { locale: patch } });
  };
  const knownOrder = ["DMY", "MDY", "YMD"].includes(locale.dateFormat ?? "");

  return (
    <SettingsCardStack>
      <div className="w-full max-w-[560px]">
        <SettingsCard title="Language & region" id="preferences.region">
          <div>
            <SettingsRow
              id="preferences.region.language"
              label="Language"
              helper="Some areas are still English only"
              {...row("language")}
              control={
                <select aria-label="Language" className={selectCls} value={locale.language ?? ""} onChange={(e) => set("language", { language: e.target.value })}>
                  {!locale.language ? <option value="">Browser default</option> : null}
                  {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {locale.language && !LANGUAGE_OPTIONS.some((o) => o.value === locale.language) ? <option value={locale.language}>{locale.language}</option> : null}
                </select>
              }
            />
            <SettingsRow
              id="preferences.region.timezone"
              label="Time zone"
              helper="Used for due dates, reminders and your timesheet"
              {...row("timezone")}
              control={
                <select aria-label="Time zone" className={selectCls} value={zone} onChange={(e) => set("timezone", { timezone: e.target.value })}>
                  {!zone ? <option value="">Use my device time zone{device ? ` (${device})` : ""}</option> : null}
                  {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </select>
              }
            />
            <SettingsRow
              id="preferences.region.weekStart"
              label="Week starts on"
              helper="Used by the planner and My work calendars"
              {...row("week")}
              control={
                <SegmentedControl<"1" | "0">
                  label="Week starts on"
                  value={locale.weekStart === 0 ? "0" : "1"}
                  options={[...WEEK_START_OPTIONS]}
                  onChange={(v) => set("week", { weekStart: Number(v) })}
                />
              }
            />
            <SettingsRow
              id="preferences.region.dateFormat"
              label="Date format"
              helper="How every date in WorkwrK is written for you"
              {...row("dateFormat")}
              control={
                <select aria-label="Date format" className={selectCls} value={knownOrder ? locale.dateFormat : ""} onChange={(e) => set("dateFormat", { dateFormat: e.target.value })}>
                  {!knownOrder ? <option value="">From your language</option> : null}
                  {DATE_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              }
            />
            <SettingsRow
              id="preferences.region.timeFormat"
              label="Time format"
              helper="Used for meetings, reminders and times of day"
              {...row("timeFormat")}
              control={
                <SegmentedControl<"24h" | "12h">
                  label="Time format"
                  value={locale.timeFormat === "12h" ? "12h" : "24h"}
                  options={[...TIME_FORMAT_OPTIONS]}
                  onChange={(v) => set("timeFormat", { timeFormat: v })}
                />
              }
            />
          </div>
        </SettingsCard>
        <p className="mt-2 text-sm text-ink-2">Changing these only affects you.</p>
      </div>

      {mismatch ? (
        <SettingsCard title="Time zone check" id="preferences.region.check">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-2">Your device says {device}. Your WorkwrK time zone is {zone}.</p>
            <button type="button" className={btn.secondary} onClick={() => device && set("timezone", { timezone: device })}>Use device time zone</button>
          </div>
        </SettingsCard>
      ) : null}
    </SettingsCardStack>
  );
}

function SidebarTab() {
  const { prefs, sidebarWidth, setSidebarWidth, sidebarCollapsed, setSidebarCollapsed } = useOsShell();
  const { isAdmin } = useViewerRole();
  const { write, row } = useRowWrites();
  const [widthSavedAt, setWidthSavedAt] = useState<number | null>(null);
  const [collapsedSavedAt, setCollapsedSavedAt] = useState<number | null>(null);
  const widthTimer = useRef<number | null>(null);
  useEffect(() => () => { if (widthTimer.current) window.clearTimeout(widthTimer.current); }, []);

  const pins = readToolPins(prefs.sidebar.quickTools);
  const order = prefs.sidebar.sectionsOrder?.length ? prefs.sidebar.sectionsOrder : SECTIONS.map((s) => s.key);
  const visibleOrder = [...order.filter((k) => SECTIONS.some((s) => s.key === k)), ...SECTIONS.map((s) => s.key).filter((k) => !order.includes(k))];
  const cards = readSidebarCards(prefs.home?.cards);

  const togglePin = (key: string, on: boolean) => {
    const next = on ? [...pins.filter((k) => k !== key), key] : pins.filter((k) => k !== key);
    void write("tools", { sidebar: { quickTools: next } });
  };
  const move = (key: string, dir: -1 | 1) => {
    const idx = visibleOrder.indexOf(key);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= visibleOrder.length) return;
    const arr = [...visibleOrder];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    void write("sections", { sidebar: { sectionsOrder: arr } });
  };
  const toggleCard = (key: SidebarOptionalKey, on: boolean) => {
    const next = on ? [...new Set([...cards, key])] : cards.filter((k) => k !== key);
    void write("cards", { home: { cards: next } });
  };

  return (
    <SettingsCardStack>
      <SettingsCard title="Sidebar" id="preferences.sidebar">
        <div>
          <SettingsRow
            id="preferences.sidebar.width"
            label="Width"
            helper="Dragging the sidebar's edge changes the same value"
            savedAt={widthSavedAt}
            control={
              <span className="inline-flex items-center gap-2">
                <input
                  type="range"
                  min={SIDEBAR_MIN_WIDTH}
                  max={SIDEBAR_MAX_WIDTH}
                  step={4}
                  value={sidebarWidth}
                  aria-label="Sidebar width"
                  onChange={(e) => {
                    setSidebarWidth(Number(e.target.value));
                    if (widthTimer.current) window.clearTimeout(widthTimer.current);
                    widthTimer.current = window.setTimeout(() => setWidthSavedAt(Date.now()), 700);
                  }}
                  className="h-9 w-40 accent-[var(--os-brand)]"
                />
                <span className="w-12 text-end text-xs font-medium text-ink-2">{sidebarWidth}px</span>
              </span>
            }
          />
          <SettingsRow
            id="preferences.sidebar.collapsed"
            label="Start collapsed"
            helper="Open WorkwrK with only the rail showing"
            savedAt={collapsedSavedAt}
            control={<Switch checked={sidebarCollapsed} onChange={(v) => { setSidebarCollapsed(v); setCollapsedSavedAt(Date.now()); }} aria-label="Start collapsed" />}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Quick actions in the avatar menu" id="preferences.sidebar.quickTools" description="Pinned tools also show in the top bar's tool strip.">
        <div>
          {PERSONAL_TOOLS.map((t, i) => (
            <SettingsRow
              key={t.key}
              label={t.label}
              {...(i === 0 ? row("tools") : {})}
              control={<Switch checked={pins.includes(t.key)} onChange={(v) => togglePin(t.key, v)} aria-label={`Pin ${t.label}`} />}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="What you see first" id="preferences.sidebar.order">
        <div>
          <div className="mb-1 text-sm font-medium text-ink-2">Section order</div>
          {visibleOrder.map((key, i) => {
            const section = SECTIONS.find((s) => s.key === key);
            if (!section) return null;
            return (
              <SettingsRow
                key={key}
                label={section.label}
                {...(i === 0 ? row("sections") : {})}
                control={
                  <span className="inline-flex gap-1">
                    <button type="button" onClick={() => move(key, -1)} disabled={i === 0} aria-label={`Move ${section.label} up`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                    <button type="button" onClick={() => move(key, 1)} disabled={i === visibleOrder.length - 1} aria-label={`Move ${section.label} down`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30">
                      <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </span>
                }
              />
            );
          })}
          <div className="mb-1 mt-4 text-sm font-medium text-ink-2">Work sidebar rows</div>
          {ROWS.map((r, i) => (
            <SettingsRow
              key={r.key}
              label={r.label}
              {...(i === 0 ? row("cards") : {})}
              control={<Switch checked={cards.includes(r.key)} onChange={(v) => toggleCard(r.key, v)} aria-label={`Show ${r.label}`} />}
            />
          ))}
        </div>
      </SettingsCard>

      <p className="text-sm text-ink-2">
        The Customize panel at the foot of the sidebar changes the same settings.
        {isAdmin ? (
          <>
            {" "}Admins set the workspace defaults in{" "}
            <Link href="/settings/identity?tab=appearance" className={btn.link}>Workspace settings, Identity &amp; culture</Link>.
          </>
        ) : null}
      </p>
    </SettingsCardStack>
  );
}
