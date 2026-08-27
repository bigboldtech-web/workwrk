"use client";

/* Settings · Identity & company profile — org name, domain, logo, and the
 * mission/vision/about profile that grounds AI KRA generation.
 *
 * Data plane (all endpoints already exist):
 *   GET   /api/settings                     → { organization:{name,domain,logo}, settings:{companyProfile} }
 *   PATCH /api/settings { section:"general", data:{ name, domain } }   ← org name + domain
 *   PATCH /api/settings { companyProfile:{…} }                         ← mission/vision/about/industry/values
 *   POST  /api/settings/logo  (FormData: logo)  DELETE /api/settings/logo   ← org logo
 *
 * Locale (timezone/currency/fiscal/language) lives on /settings/locale and
 * is intentionally NOT duplicated here — one writer per field, no drift.
 *
 * Admin-gated by the layout (requireOrgAdminOrRedirect); we also mirror the
 * guard client-side so the controls read-only if a non-admin ever lands here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2, Globe, Image as ImageIcon, Upload, Trash2, Sparkles, Loader2,
} from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useOsToast } from "@/components/layout/os/toast";

// Mirror the /api/settings/logo endpoint's server-side validation so we can
// reject bad files before the round-trip (endpoint allows these + 2MB cap).
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX = 2 * 1024 * 1024; // 2MB

type IdentityState = {
  name: string;
  domain: string;
  logo: string | null;
  mission: string;
  vision: string;
  about: string;
  industry: string;
  values: string; // comma-separated in the UI; stored as string[]
};

export default function IdentitySettingsPage() {
  const { accessLevel } = useRole();
  const canEdit = ["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel);
  const { toast } = useOsToast();

  const [state, setState] = useState<IdentityState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) { setState(blank()); return; }
      const d = await res.json();
      const org = d?.organization ?? {};
      const profile = d?.settings?.companyProfile ?? {};
      setState({
        name: typeof org.name === "string" ? org.name : "",
        domain: typeof org.domain === "string" ? org.domain : "",
        logo: typeof org.logo === "string" ? org.logo : null,
        mission: typeof profile.mission === "string" ? profile.mission : "",
        vision: typeof profile.vision === "string" ? profile.vision : "",
        about: typeof profile.about === "string" ? profile.about : "",
        industry: typeof profile.industry === "string" ? profile.industry : "",
        values: Array.isArray(profile.values) ? profile.values.join(", ") : "",
      });
    } catch { setState(blank()); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof IdentityState>(k: K, v: IdentityState[K]) =>
    setState((s) => (s ? { ...s, [k]: v } : s));

  async function save() {
    if (!state || !canEdit) return;
    setSaving(true);
    try {
      // 1. Org name + domain via the section the API actually accepts.
      const gen = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "general",
          data: { name: state.name.trim(), domain: state.domain.trim() },
        }),
      });
      if (!gen.ok) throw new Error(await errText(gen));

      // 2. Company profile via the top-level branch (runs sequentially so it
      //    reads the settings the step above just wrote — no lost update).
      const values = state.values.split(",").map((v) => v.trim()).filter(Boolean);
      const prof = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyProfile: {
            mission: state.mission.trim(),
            vision: state.vision.trim(),
            about: state.about.trim(),
            industry: state.industry.trim(),
            values,
          },
        }),
      });
      if (!prof.ok) throw new Error(await errText(prof));

      toast("Identity saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { toast("Use a PNG, JPEG, WebP, or SVG"); return; }
    if (file.size > LOGO_MAX) { toast("Logo must be under 2MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await errText(res));
      const d = await res.json();
      set("logo", typeof d?.logo === "string" ? d.logo : null);
      toast("Logo updated");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (!canEdit) return;
    setUploading(true);
    try {
      const res = await fetch("/api/settings/logo", { method: "DELETE" });
      if (!res.ok) throw new Error(await errText(res));
      set("logo", null);
      toast("Logo removed");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove logo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">
          Identity &amp; company profile
        </h1>
      </header>
      <p className="mb-5 max-w-2xl text-[14px] text-zinc-500">
        Your organization&apos;s name, logo, and the mission/vision that grounds AI.
        Timezone, currency and fiscal year live under{" "}
        <a href="/settings/locale" className="text-[var(--os-brand,#0073EA)] hover:underline">Locale &amp; finance</a>.
        {canEdit ? "" : " You need admin access to change these."}
      </p>

      {state === null ? (
        <div className="flex items-center gap-2 text-[14px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      ) : (
        <>
          {/* Brand -------------------------------------------------------- */}
          <section className="max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <SectionHead icon={<Building2 className="h-4 w-4 text-zinc-500" />} title="Brand" />

            {/* Logo */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">Organization logo</label>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                  {state.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={state.logo} alt="Organization logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-zinc-300" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || uploading}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {state.logo ? "Replace" : "Upload"}
                  </button>
                  {state.logo && (
                    <button
                      type="button"
                      disabled={!canEdit || uploading}
                      onClick={removeLogo}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[13px] font-medium text-[#E2445C] hover:bg-zinc-50 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={LOGO_ACCEPT}
                    className="hidden"
                    onChange={onPickLogo}
                  />
                </div>
              </div>
              <p className="mt-1.5 text-[12px] text-zinc-400">PNG, JPEG, WebP or SVG · up to 2MB · saved instantly.</p>
            </div>

            <TextField
              label="Organization name" value={state.name} disabled={!canEdit}
              placeholder="Acme Inc."
              hint="Shown in the sidebar and notifications."
              onChange={(v) => set("name", v)}
            />
            <TextField
              label="Primary domain" value={state.domain} disabled={!canEdit}
              placeholder="acme.com"
              hint="Used to match teammates signing in with a company email."
              onChange={(v) => set("domain", v)}
              icon={<Globe className="h-3.5 w-3.5 text-zinc-400" />}
            />
          </section>

          {/* Company profile --------------------------------------------- */}
          <section className="mt-5 max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <SectionHead
              icon={<Sparkles className="h-4 w-4 text-zinc-500" />}
              title="Company profile"
            />
            <div className="-mt-1 flex items-start gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--os-brand,#0073EA)_8%,transparent)] px-3 py-2 text-[12.5px] text-zinc-600">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--os-brand,#0073EA)]" />
              <span>This profile feeds AI KRA &amp; KPI generation. The richer it is, the more relevant the suggested accountabilities.</span>
            </div>

            <TextField
              label="Industry" value={state.industry} disabled={!canEdit}
              placeholder="e.g. SaaS · Manufacturing · Healthcare"
              onChange={(v) => set("industry", v)}
            />
            <AreaField
              label="Mission" value={state.mission} disabled={!canEdit}
              placeholder="Why the company exists — the change you're here to make."
              onChange={(v) => set("mission", v)}
            />
            <AreaField
              label="Vision" value={state.vision} disabled={!canEdit}
              placeholder="Where the company is headed over the next few years."
              onChange={(v) => set("vision", v)}
            />
            <AreaField
              label="About" value={state.about} disabled={!canEdit}
              placeholder="What the company does, who it serves, and how."
              onChange={(v) => set("about", v)}
            />
            <TextField
              label="Core values" value={state.values} disabled={!canEdit}
              placeholder="Ownership, Craft, Candor"
              hint="Comma-separated. Used as context for AI-generated KRAs."
              onChange={(v) => set("values", v)}
            />
          </section>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--os-brand)] px-3 text-[13px] font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-40"
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

/* -------------------------------------------------------------------------- */

function blank(): IdentityState {
  return { name: "", domain: "", logo: null, mission: "", vision: "", about: "", industry: "", values: "" };
}

async function errText(res: Response): Promise<string> {
  if (res.status === 403) return "Admin access required";
  const d = await res.json().catch(() => null);
  return (d && typeof d.error === "string" && d.error) || "Couldn't save";
}

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <h2 className="text-[14px] font-semibold text-zinc-800">{title}</h2>
    </div>
  );
}

function TextField({
  label, value, onChange, placeholder, hint, disabled, icon,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; disabled?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-zinc-700">{label}</label>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">{icon}</span>}
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`h-8 w-full rounded-md border border-zinc-200 bg-white ${icon ? "pl-8" : "px-2.5"} pr-2.5 text-[13.5px] text-zinc-800 outline-none focus:border-[var(--os-brand,#0073EA)] disabled:opacity-60`}
        />
      </div>
      {hint && <p className="mt-1 text-[12px] text-zinc-400">{hint}</p>}
    </div>
  );
}

function AreaField({
  label, value, onChange, placeholder, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-zinc-700">{label}</label>
      <textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-[13.5px] leading-relaxed text-zinc-800 outline-none focus:border-[var(--os-brand,#0073EA)] disabled:opacity-60"
      />
    </div>
  );
}
