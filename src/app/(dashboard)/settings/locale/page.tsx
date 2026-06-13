"use client";

// Locale & finance — org-level timezone / currency / fiscal-year / default
// language. These values are shared with the Identity & profile surface.
// Backed by GET /api/settings (settings.{timezone,currency,fiscalYearStart,
// language}) + PATCH { section:"general" } — both already exist; the PATCH
// is admin-gated server-side, so non-admins see this read-only.
//
// fiscalYearStart can arrive as a number (e.g. 4) OR a "MM-01" string; we
// normalize to one of four canonical "MM-01" strings for the <select>.

import { useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useOsToast } from "@/components/layout/os/toast";

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
  const canEdit = ["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel);
  const { toast } = useOsToast();

  const [state, setState] = useState<LocaleState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = d?.settings ?? {};
        setState({
          timezone: typeof s.timezone === "string" ? s.timezone : "UTC",
          currency: typeof s.currency === "string" ? s.currency : "USD",
          fiscalYearStart: normalizeFiscal(s.fiscalYearStart),
          language: typeof s.language === "string" ? s.language : "en",
        });
      })
      .catch(() =>
        setState({ timezone: "UTC", currency: "USD", fiscalYearStart: "01-01", language: "en" }),
      );
  }, []);

  const set = <K extends keyof LocaleState>(key: K, value: LocaleState[K]) => {
    setState((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!state) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section: "general",
          data: {
            timezone: state.timezone,
            currency: state.currency,
            fiscalYearStart: state.fiscalYearStart,
            language: state.language,
          },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Save failed");
      }
      toast("Locale settings saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "h-8 w-full max-w-sm rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-800 disabled:opacity-60";

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Globe className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Locale & finance</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Default timezone, currency, fiscal year and language for your organization. Shared with
        Identity & profile.
        {canEdit ? "" : " You need admin access to change these."}
      </p>

      {state === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      ) : (
        <>
          <div className="max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">Timezone</label>
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
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">Currency</label>
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
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">Fiscal year start</label>
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
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">Default language</label>
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save changes
            </button>
          </div>
        </>
      )}
      <div className="h-10" />
    </div>
  );
}
