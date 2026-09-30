"use client";

// My settings > Preferences (spec-account-auth `/account/preferences`):
// three tabs, autosave throughout (no Save bar, so no blue button).
//
//   Appearance        Theme, Chrome (only once CHROME_CONTROL_EXPOSED), Density
//                     (default Comfortable), Reduced motion, Show upcoming
//                     features. There is no Accent row: after the one-blue
//                     decision it would change nothing a person can see, and
//                     the Customize panel hides its Accent row by the same
//                     rule (src/lib/accents.ts OFFERED_ACCENTS).
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
  localeCookieFor,
  timeZoneOptions,
} from "@/lib/account/locale-options";
import { PickerSelect } from "@/components/settings/picker-select";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Chrome = "navy" | "light";

const TABS: readonly SettingsTab[] = settingsTabs("account/preferences");


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
    <SettingsPage pageKey="account/preferences" tabs={TABS} subtitle="These apply to you on every device.">
      {(tab) => (tab === "region" ? <RegionTab /> : tab === "sidebar" ? <SidebarTab /> : <AppearanceTab />)}
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

const BROWSER_DEFAULT = "__browser__";
const DEVICE_ZONE = "__device__";
const FROM_LANGUAGE = "__language__";

/** The wired catalog this browser asks for, else English. */
function browserLanguage(): string {
  const asked = typeof navigator !== "undefined" ? navigator.language : null;
  return localeCookieFor(asked) ?? "en";
}
function browserLanguageLabel(): string | undefined {
  const code = browserLanguage();
  return LANGUAGE_OPTIONS.find((o) => o.value === code)?.label;
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
  // The first row of each list is always there, so a stored choice always has
  // a way back: "Browser default" stores the language this browser asks for,
  // "Use my device time zone" stores the zone this device is in (the store has
  // no unset, and an empty string would reach every Intl reader).
  const languageOptions = useMemo(() => {
    const opts: { value: string; label: string; description?: string }[] = [
      { value: BROWSER_DEFAULT, label: "Browser default", description: browserLanguageLabel() },
      ...LANGUAGE_OPTIONS.map((o) => ({ value: o.value as string, label: o.label })),
    ];
    if (locale.language && !LANGUAGE_OPTIONS.some((o) => o.value === locale.language)) opts.push({ value: locale.language, label: locale.language });
    return opts;
  }, [locale.language]);
  const zoneOptions = useMemo(
    () => [
      { value: DEVICE_ZONE, label: "Use my device time zone", description: device ?? undefined, disabled: !device },
      ...zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") })),
    ],
    [zones, device],
  );

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
                <PickerSelect
                  label="Language"
                  value={locale.language ?? BROWSER_DEFAULT}
                  options={languageOptions}
                  onChange={(v) => set("language", { language: v === BROWSER_DEFAULT ? browserLanguage() : v })}
                />
              }
            />
            <SettingsRow
              id="preferences.region.timezone"
              label="Time zone"
              helper="Used for due dates, reminders and your timesheet"
              {...row("timezone")}
              control={
                <PickerSelect
                  label="Time zone"
                  value={zone || DEVICE_ZONE}
                  options={zoneOptions}
                  onChange={(v) => { const next = v === DEVICE_ZONE ? device : v; if (next) set("timezone", { timezone: next }); }}
                />
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
                <PickerSelect
                  label="Date format"
                  value={knownOrder ? (locale.dateFormat as string) : FROM_LANGUAGE}
                  options={[...(!knownOrder ? [{ value: FROM_LANGUAGE, label: "From your language" }] : []), ...DATE_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
                  onChange={(v) => { if (v !== FROM_LANGUAGE) set("dateFormat", { dateFormat: v }); }}
                />
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

// The ten personal tools by what they do (every PERSONAL_TOOLS key appears
// in exactly one group; a tool added later lands in "Open" until placed).
const TOOL_GROUP_DEFS: { key: string; title: string; keys: readonly string[] }[] = [
  { key: "create", title: "Quick actions to create", keys: ["create-task", "create-doc", "create-whiteboard", "create-reminder"] },
  { key: "capture", title: "Quick actions to capture", keys: ["notepad", "voice"] },
];
const TOOL_GROUPS = [
  ...TOOL_GROUP_DEFS,
  {
    key: "open",
    title: "Quick actions to open",
    keys: PERSONAL_TOOLS.map((t) => t.key).filter((k) => !TOOL_GROUP_DEFS.some((g) => g.keys.includes(k))),
  },
];

function SidebarTab() {
  const { prefs, sidebarWidth, setSidebarWidth, sidebarCollapsed, setSidebarCollapsed } = useOsShell();
  const { isAdmin } = useViewerRole();
  const { write, row } = useRowWrites();
  const [collapsedSavedAt, setCollapsedSavedAt] = useState<number | null>(null);
  const [collapsedFailed, setCollapsedFailed] = useState<boolean | null>(null);
  const widthTimer = useRef<number | null>(null);
  // Width and Start collapsed show Saved only after the server kept the value,
  // and Couldn't save with a Retry when it did not (the SAVE PATHS rule).
  const saveCollapsed = async (v: boolean) => {
    const ok = await setSidebarCollapsed(v);
    if (ok) { setCollapsedSavedAt(Date.now()); setCollapsedFailed(null); } else setCollapsedFailed(v);
  };
  useEffect(() => () => { if (widthTimer.current) window.clearTimeout(widthTimer.current); }, []);

  const pins = readToolPins(prefs.sidebar.quickTools);
  const order = prefs.sidebar.sectionsOrder?.length ? prefs.sidebar.sectionsOrder : SECTIONS.map((s) => s.key);
  const visibleOrder = [...order.filter((k) => SECTIONS.some((s) => s.key === k)), ...SECTIONS.map((s) => s.key).filter((k) => !order.includes(k))];
  const cards = readSidebarCards(prefs.home?.cards);

  const togglePin = (group: string, key: string, on: boolean) => {
    const next = on ? [...pins.filter((k) => k !== key), key] : pins.filter((k) => k !== key);
    void write(`tools.${group}`, { sidebar: { quickTools: next } });
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
            {...row("width")}
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
                    const next = Number(e.target.value);
                    setSidebarWidth(next, { persist: false });
                    if (widthTimer.current) window.clearTimeout(widthTimer.current);
                    widthTimer.current = window.setTimeout(() => {
                      widthTimer.current = null;
                      void write("width", { sidebar: { width: next } });
                    }, 500);
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
            error={collapsedFailed !== null ? { message: "Couldn't save", onRetry: () => { void saveCollapsed(collapsedFailed); } } : null}
            control={<Switch checked={sidebarCollapsed} onChange={(v) => { void saveCollapsed(v); }} aria-label="Start collapsed" />}
          />
        </div>
      </SettingsCard>

      {/* Five rows a card at most (design-system 5.4): the ten tools in three
          cards by what they do, the section order and the Work sidebar rows
          in one card each. */}
      {TOOL_GROUPS.map((g, gi) => (
        <SettingsCard
          key={g.key}
          title={g.title}
          id={gi === 0 ? "preferences.sidebar.quickTools" : `preferences.sidebar.quickTools.${g.key}`}
          description={gi === 0 ? "Pinned tools show in the avatar menu and the top bar's tool strip." : undefined}
        >
          <div>
            {PERSONAL_TOOLS.filter((t) => g.keys.includes(t.key)).map((t, i) => (
              <SettingsRow
                key={t.key}
                label={t.label}
                {...(i === 0 ? row(`tools.${g.key}`) : {})}
                control={<Switch checked={pins.includes(t.key)} onChange={(v) => togglePin(g.key, t.key, v)} aria-label={`Pin ${t.label}`} />}
              />
            ))}
          </div>
        </SettingsCard>
      ))}

      <SettingsCard title="Section order" id="preferences.sidebar.order">
        <div>
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
        </div>
      </SettingsCard>

      <SettingsCard title="Work sidebar rows" id="preferences.sidebar.rows">
        <div>
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
