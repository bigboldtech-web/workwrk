"use client";

// Workspace settings > Locale & work week (spec-settings-workspace
// `/settings/locale`, settings-architecture 5.15): the org half of the
// locale chain. ONE Save bar, ONE PATCH { section: "locale" }.
//
//   Region            time zone (the full IANA list, "Use my device's time
//                     zone" first), currency (the full ISO 4217 list), default
//                     language (the 18 wired catalogs)
//   Dates and the week week start, date format, time format
//   The working week  fiscal year start as a NUMBER (the old "MM-01" string
//                     migrates on read), then the working calendar card
//                     (work days, day length, holidays; its own record and
//                     its own save, read by Workload and Timesheets)
//
// Readers: settings.timezone (the crons, digests, due-date bucketing),
// settings.currency (every money format), settings.fiscalYearStart (fiscal
// periods, review cadences), and language, week start, date and time format
// through getEffectivePreferences (org under the person's own choice), which
// feeds next-intl and the date helpers.
//
// Every value is a SettingsRow, the label and its one line hint at the left
// and the control at the right, as the Work week card below and My settings
// > Preferences > Language & region draw theirs (final Settings review, H2:
// three cards stacked each label over a left-aligned control). Each label
// is a <label for> its control's trigger, so a click on its words opens the
// picker. The pointer to each person's own choices is the Region card's
// description.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SaveBar } from "@/components/settings/save-bar";
import { PickerSelect } from "@/components/settings/picker-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { draftAfterSave, useSettingsSection, type SettingsGetBody } from "@/hooks/use-settings-section";
import { localeNames, locales } from "@/i18n/config";
import { MONTH_NAMES, localeSettingsOf, type DateFormat, type LocaleSettings, type TimeFormat, type WeekStart } from "@/lib/settings/org-policy";
import { WorkWeekCard } from "./work-week-card";

const DEVICE = "__device__";

/**
 * Each picker's trigger id, for its row's <label htmlFor>: a click on the
 * label's words opens the picker, as a native field's label would (Phase 5
 * review, L4). Not the registry anchors (locale.timezone and so on), which
 * are the rows' ids.
 */
const LOCALE_FIELD_IDS = { timezone: "locale-timezone", currency: "locale-currency", language: "locale-language", fiscal: "locale-fiscal-year" } as const;

/** The fiscal year's twelve start months, valued "1" to "12" (the stored number as text). */
const FISCAL_MONTHS = MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }));

function supported(kind: "timeZone" | "currency"): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn(kind) : [];
  } catch {
    return [];
  }
}

function currencyLabel(code: string): string {
  let name = code;
  let symbol = "";
  try {
    name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {}
  try {
    symbol = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  } catch {}
  return `${code}${symbol && symbol !== code ? ` ${symbol}` : ""} · ${name}`;
}

const SAMPLE = new Date(2026, 11, 31, 15, 30);
function dateExample(f: DateFormat): string {
  const d = "31", m = "12", y = "2026";
  return f === "MDY" ? `${m}/${d}/${y}` : f === "YMD" ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}
function timeExample(f: TimeFormat): string {
  // hourCycle, never hour12: false (Node 20 renders midnight as "24:00" with it).
  return SAMPLE.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: f === "12h" ? "h12" : "h23" });
}

export default function LocaleSettingsPage() {
  return (
    <SettingsPage pageKey="locale">
      <LocaleForm />
      <div className="mt-6">
        <WorkWeekCard />
      </div>
    </SettingsPage>
  );
}

function LocaleForm() {
  const s = useSettingsSection("locale", (b: SettingsGetBody) => {
    const settings = (b.settings ?? {}) as Record<string, unknown>;
    // The server already normalised these (settings.locale), with the
    // currency fallback the rest of the product uses.
    const fromServer = settings.locale as LocaleSettings | undefined;
    return fromServer && typeof fromServer === "object" && "weekStart" in fromServer ? fromServer : localeSettingsOf(settings);
  });
  const { toast } = useOsToast();
  const [draft, setDraft] = useState<LocaleSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = s.data;
  const form = draft ?? base;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const set = <K extends keyof LocaleSettings>(k: K, v: LocaleSettings[K]) => {
    setErr(null);
    setDraft((d) => ({ ...(d ?? (base as LocaleSettings)), [k]: v }));
  };

  const zones = useMemo(() => supported("timeZone"), []);
  const currencies = useMemo(() => supported("currency"), []);
  const device = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
  }, []);

  const zoneOptions = useMemo(() => {
    const list = form && !zones.includes(form.timezone) ? [form.timezone, ...zones] : zones;
    return [
      ...(device ? [{ value: DEVICE, label: `Use my device's time zone (${device})` }] : []),
      ...list.map((z) => ({ value: z, label: z.replace(/_/g, " "), keywords: z })),
    ];
  }, [zones, device, form]);
  const currencyOptions = useMemo(() => {
    const list = form && !currencies.includes(form.currency) ? [form.currency, ...currencies] : currencies;
    return list.map((c) => ({ value: c, label: currencyLabel(c), keywords: c }));
  }, [currencies, form]);
  const languageOptions = useMemo(() => {
    const opts = locales.map((l) => ({ value: l as string, label: localeNames[l] }));
    if (form && !opts.some((o) => o.value === form.language)) opts.push({ value: form.language, label: form.language });
    return opts;
  }, [form]);

  const save = useCallback(async () => {
    if (!draft) return true;
    setSaving(true);
    const r = await s.save({
      timezone: draft.timezone,
      currency: draft.currency,
      fiscalYearStart: draft.fiscalYearStart,
      language: draft.language,
      weekStart: draft.weekStart,
      dateFormat: draft.dateFormat,
      timeFormat: draft.timeFormat,
    });
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "Couldn't save"); return false; }
    // Anything typed while the save was out stays, unsaved (draftAfterSave).
    setDraft((d) => draftAfterSave(d, draft));
    toast("Locale saved");
    window.dispatchEvent(new Event("workwrk:prefs-changed"));
    return true;
  }, [draft, s, toast]);

  if (s.status === "error") return <ErrorState what="the locale settings" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!form) return <SkeletonRows rows={6} />;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard
          title="Region"
          id="locale.region"
          description={
            <>
              People can pick their own language, formats and week start in{" "}
              <Link href="/account/preferences?tab=region" className="font-medium text-brand-deep underline underline-offset-2">My settings</Link>.
            </>
          }
        >
          <div>
            <SettingsRow
              id="locale.timezone"
              label={<label htmlFor={LOCALE_FIELD_IDS.timezone}>Time zone</label>}
              helper="Reminders, digests and due dates run on this clock."
              control={
                <PickerSelect
                  id={LOCALE_FIELD_IDS.timezone}
                  label="Time zone"
                  value={form.timezone}
                  options={zoneOptions}
                  onChange={(v) => set("timezone", v === DEVICE && device ? device : v)}
                  width={320}
                />
              }
            />
            <SettingsRow
              id="locale.currency"
              label={<label htmlFor={LOCALE_FIELD_IDS.currency}>Currency</label>}
              helper="Every amount in the workspace is shown in this currency."
              control={<PickerSelect id={LOCALE_FIELD_IDS.currency} label="Currency" value={form.currency} options={currencyOptions} onChange={(v) => set("currency", v)} width={320} />}
            />
            <SettingsRow
              id="locale.language"
              label={<label htmlFor={LOCALE_FIELD_IDS.language}>Default language</label>}
              control={<PickerSelect id={LOCALE_FIELD_IDS.language} label="Default language" value={form.language} options={languageOptions} onChange={(v) => set("language", v)} />}
            />
          </div>
        </SettingsCard>

        <SettingsCard title="Dates and the week" id="locale.dates">
          <div>
            <SettingsRow
              id="locale.weekStart"
              label="Week starts on"
              control={
                <SegmentedControl<WeekStart>
                  label="Week starts on"
                  value={form.weekStart}
                  options={[{ value: "MON", label: "Monday" }, { value: "SUN", label: "Sunday" }]}
                  onChange={(v) => set("weekStart", v)}
                />
              }
            />
            <SettingsRow
              id="locale.dateFormat"
              label="Date format"
              helper={`For example ${dateExample(form.dateFormat)}`}
              control={
                <SegmentedControl<DateFormat>
                  label="Date format"
                  value={form.dateFormat}
                  options={[{ value: "DMY", label: "DMY" }, { value: "MDY", label: "MDY" }, { value: "YMD", label: "YMD" }]}
                  onChange={(v) => set("dateFormat", v)}
                />
              }
            />
            <SettingsRow
              id="locale.timeFormat"
              label="Time format"
              helper={`For example ${timeExample(form.timeFormat)}`}
              control={
                <SegmentedControl<TimeFormat>
                  label="Time format"
                  value={form.timeFormat}
                  options={[{ value: "24h", label: "24 hour" }, { value: "12h", label: "12 hour" }]}
                  onChange={(v) => set("timeFormat", v)}
                />
              }
            />
          </div>
        </SettingsCard>

        <SettingsCard title="The working year" id="locale.fiscal">
          {/* A PickerSelect like the three Region pickers (B9), at the row's
              right; twelve fixed months need no search box. The value is
              still the month NUMBER (1 to 12), as settings.fiscalYearStart
              stores it and recurring goals read it. */}
          <div>
            <SettingsRow
              id="locale.fiscalYearStart"
              label={<label htmlFor={LOCALE_FIELD_IDS.fiscal}>Fiscal year starts in</label>}
              helper="Fiscal quarters and review periods count from this month."
              control={
                <PickerSelect
                  id={LOCALE_FIELD_IDS.fiscal}
                  label="Fiscal year starts in"
                  noSearch
                  value={String(form.fiscalYearStart)}
                  options={FISCAL_MONTHS}
                  onChange={(v) => set("fiscalYearStart", Number(v))}
                  width={220}
                />
              }
            />
          </div>
        </SettingsCard>
        {err ? <p role="alert" className="text-sm text-danger-text">{err}</p> : null}
      </SettingsCardStack>
      <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(null); setErr(null); }} onSave={save} />
    </>
  );
}
