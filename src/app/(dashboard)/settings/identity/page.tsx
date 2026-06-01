"use client";

/* Settings · Identity — org identity form (name, logo, fiscal year, timezone, currency).
 *
 *  GET   /api/settings
 *  PATCH /api/settings
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building, Save, Globe, Calendar as CalendarIcon, Coins, Image as ImageIcon,
  Hash, CheckCircle2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Identity = {
  orgName?: string;
  legalName?: string;
  logoUrl?: string;
  domain?: string;
  timezone?: string;
  currency?: string;
  fiscalYearStart?: string;
  language?: string;
  industry?: string;
};

const TIMEZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "SGD"];
const FY_OPTIONS = [
  { value: "01-01", label: "January (calendar year)" },
  { value: "04-01", label: "April (UK / India)" },
  { value: "07-01", label: "July (Australia)" },
  { value: "10-01", label: "October (US federal)" },
];

export default function IdentitySettingsPage() {
  const [data, setData] = useState<Identity | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) { setData({}); return; }
      const s = await res.json();
      const id = s?.settings?.identity ?? {};
      setData({
        orgName: id.orgName ?? s?.settings?.orgName ?? "",
        legalName: id.legalName ?? "",
        logoUrl: id.logoUrl ?? "",
        domain: id.domain ?? "",
        timezone: id.timezone ?? "UTC",
        currency: id.currency ?? "USD",
        fiscalYearStart: id.fiscalYearStart ?? "01-01",
        language: id.language ?? "en",
        industry: id.industry ?? "",
      });
    } catch { setData({}); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: data }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Admin access required" : "Couldn't save"); return; }
      setLastSaved(new Date());
      toast("Identity saved");
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  function update<K extends keyof Identity>(k: K, v: Identity[K]) {
    setData((d) => ({ ...(d ?? {}), [k]: v }));
  }

  return (
    <>
      <OsTitleBar
        title="Identity"
        Icon={Building}
        iconGradient={GRAD.indigoBlue}
        description={data?.orgName ? `${data.orgName}${lastSaved ? ` · saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : "Configure org identity"}
        actions={
          <div className="idn__head-actions">
            <Link href="/settings" className="idn__nav-link"><Hash /> Settings</Link>
            <button type="button" className="idn__btn-primary" onClick={save} disabled={saving || data === null}>
              <Save /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

      <div className="idn">
        {data === null ? (
          <div className="idn__loading">Loading…</div>
        ) : (
          <>
            <section className="idn__section">
              <header><h2><Building /> Brand</h2></header>
              <div className="idn__grid">
                <Field label="Org name" hint="Shown in the sidebar and notifications.">
                  <input type="text" value={data.orgName ?? ""} onChange={(e) => update("orgName", e.target.value)} placeholder="Acme Inc." />
                </Field>
                <Field label="Legal name" hint="Used on contracts, invoices, payslips.">
                  <input type="text" value={data.legalName ?? ""} onChange={(e) => update("legalName", e.target.value)} placeholder="Acme Inc., LLC" />
                </Field>
                <Field label="Domain" hint="Primary domain. Restricts auth.">
                  <input type="text" value={data.domain ?? ""} onChange={(e) => update("domain", e.target.value)} placeholder="acme.com" />
                </Field>
                <Field label="Industry">
                  <input type="text" value={data.industry ?? ""} onChange={(e) => update("industry", e.target.value)} placeholder="e.g. SaaS / Manufacturing" />
                </Field>
                <Field label="Logo URL" hint="Use a square PNG/SVG.">
                  <input type="text" value={data.logoUrl ?? ""} onChange={(e) => update("logoUrl", e.target.value)} placeholder="https://…/logo.png" />
                </Field>
              </div>
              {data.logoUrl && (
                <div className="idn__preview">
                  <span className="idn__preview-label"><ImageIcon /> Preview</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.logoUrl} alt="logo preview" />
                </div>
              )}
            </section>

            <section className="idn__section">
              <header><h2><Globe /> Locale</h2></header>
              <div className="idn__grid">
                <Field label="Timezone" hint="Used for scheduling and reports.">
                  <select value={data.timezone ?? "UTC"} onChange={(e) => update("timezone", e.target.value)}>
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Field>
                <Field label="Currency" hint="Primary display currency.">
                  <select value={data.currency ?? "USD"} onChange={(e) => update("currency", e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Fiscal year start" hint="Drives the accounting calendar.">
                  <select value={data.fiscalYearStart ?? "01-01"} onChange={(e) => update("fiscalYearStart", e.target.value)}>
                    {FY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Default language">
                  <select value={data.language ?? "en"} onChange={(e) => update("language", e.target.value)}>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="hi">Hindi</option>
                    <option value="ja">Japanese</option>
                  </select>
                </Field>
              </div>
            </section>

            <section className="idn__section idn__section--summary">
              <header><h2><CheckCircle2 /> Summary</h2></header>
              <div className="idn__summary">
                <div className="idn__summary-row"><Building /> <strong>{data.orgName || "Untitled"}</strong>{data.legalName && <span>· {data.legalName}</span>}</div>
                <div className="idn__summary-row"><Globe /> {data.timezone ?? "UTC"} · {data.language ?? "en"}</div>
                <div className="idn__summary-row"><Coins /> {data.currency ?? "USD"}</div>
                <div className="idn__summary-row"><CalendarIcon /> Fiscal year: {FY_OPTIONS.find((o) => o.value === data.fiscalYearStart)?.label ?? "—"}</div>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="idn__field">
      <span className="idn__field-label">{label}</span>
      {children}
      {hint && <span className="idn__field-hint">{hint}</span>}
    </label>
  );
}
