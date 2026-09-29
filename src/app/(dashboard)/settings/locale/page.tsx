"use client";

// Locale & work week: org-level timezone / currency / fiscal-year / default
// language. These values are shared with the Identity & profile surface.
// Backed by GET /api/settings (settings.{timezone,currency,fiscalYearStart,
// language}) + PATCH { section:"general" } — both already exist; the PATCH
// is admin-gated server-side, so non-admins see this read-only.
//
// fiscalYearStart can arrive as a number (e.g. 4) OR a "MM-01" string; we
// normalize to one of four canonical "MM-01" strings for the <select>.

import { useState } from "react";
import { Globe } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useSettingsSection } from "@/hooks/use-settings-section";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { WorkWeekCard } from "./work-week-card";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "SGD"];

const FISCAL_YEARS: { value: string; label: string }[] = [
  { value: "01-01", label: "January (calendar year)" },
  { value: "04-01", label: "April (UK / India)" },
  { value: "07-01", label: "July (Australia)" },
  { value: "10-01", label: "October (US federal)" },
];

const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
];

// fiscalYearStart may be a number (1/4/7/10) or already a "MM-01" string.
// Collapse both to one of the four canonical select values; default "01-01".
function normalizeFiscal(raw: unknown): string {
  const valid = new Set(FISCAL_YEARS.map((f) => f.value));
  if (typeof raw === "number") {
    const byNumber: Record<number, string> = { 1: "01-01", 4: "04-01", 7: "07-01", 10: "10-01" };
    return byNumber[raw] ?? "01-01";
  }
  if (typeof raw === "string" && valid.has(raw)) return raw;
  return "01-01";
}

type LocaleState = {
  timezone: string;
  currency: string;
  fiscalYearStart: string;
  language: string;
};

export default function LocaleSettingsPage() {
  const { accessLevel } = useRole();
  // Admin only, the same people PATCH /api/settings { section: "general" }
  // admits (C_LEVEL was never able to open this page; the gate is "admin").
  const canEdit = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel);
  const { toast } = useOsToast();

  // The fetch-failure rule (settings-architecture 8.6): a failed GET renders
  // ErrorState with Retry, never a form of built-in defaults a Save would
  // write over the live values; the hook refuses to save until a load
  // succeeded.
  const section = useSettingsSection<LocaleState>("general", (body) => {
    const s = body.settings ?? {};
    return {
      timezone: typeof s.timezone === "string" ? s.timezone : "UTC",
      currency: typeof s.currency === "string" ? s.currency : "USD",
      fiscalYearStart: normalizeFiscal(s.fiscalYearStart),
      language: typeof s.language === "string" ? s.language : "en",
    };
  });
  const [draft, setDraft] = useState<Partial<LocaleState>>({});
  const [saving, setSaving] = useState(false);
  const state: LocaleState | null =
    section.status === "ready" && section.data ? { ...section.data, ...draft } : null;

  const set = <K extends keyof LocaleState>(key: K, value: LocaleState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!state) return;
    setSaving(true);
    const r = await section.save({
      timezone: state.timezone,
      currency: state.currency,
      fiscalYearStart: state.fiscalYearStart,
      language: state.language,
    });
    setSaving(false);
    if (!r.ok) {
      toast(r.error ?? "Couldn't save. Try again.");
      return;
    }
    setDraft({});
    toast("Locale settings saved");
  };

  const selectClass =
    "h-8 w-full max-w-sm rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-800 disabled:opacity-60";

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Globe className="h-5 w-5 text-zinc-700" />
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-zinc-900">{SETTINGS_PAGES.locale.label}</h1>
      </header>
      <p className="mb-5 max-w-2xl text-base text-zinc-500">
        Default timezone, currency, fiscal year and language for your organization. Shared with
        Identity & profile.
        {canEdit ? "" : " You need admin access to change these."}
      </p>

      {section.status === "error" ? (
        <div className="max-w-xl rounded-xl border border-zinc-200 bg-white p-5">
          <ErrorState what="locale settings" onRetry={section.retry} hint={section.error ?? undefined} compact />
        </div>
      ) : state === null ? (
        <div className="max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-5" aria-busy="true" aria-label="Locale settings">
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-8 w-full max-w-sm" />
        </div>
      ) : (
        <>
          <div className="max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Timezone</label>
              <select
                value={state.timezone}
                disabled={!canEdit}
                onChange={(e) => set("timezone", e.target.value)}
                className={selectClass}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Currency</label>
              <select
                value={state.currency}
                disabled={!canEdit}
                onChange={(e) => set("currency", e.target.value)}
                className={selectClass}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Fiscal year start</label>
              <select
                value={state.fiscalYearStart}
                disabled={!canEdit}
                onChange={(e) => set("fiscalYearStart", e.target.value)}
                className={selectClass}
              >
                {FISCAL_YEARS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Default language</label>
              <select
                value={state.language}
                disabled={!canEdit}
                onChange={(e) => set("language", e.target.value)}
                className={selectClass}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--os-brand)] px-3 text-sm font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-40"
            >
              {saving ? "Saving" : "Save changes"}
            </button>
          </div>
        </>
      )}

      {/* The organization's working calendar. It is on this page because the
          settings registry already names it here ("week start", "capacity"
          are this page's own search keywords), and it is its own card
          because it is its own record and its own save. */}
      <WorkWeekCard />

      <div className="h-10" />
    </div>
  );
}
