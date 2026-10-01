"use client";

// Workspace settings > Identity & culture (spec-settings-workspace
// `/settings/identity`, settings-architecture 5.2). Four tabs:
//
//   Profile              Save bar, ONE PATCH { section: "profile" }; the
//                        logo autosaves on pick (POST / DELETE
//                        /api/settings/logo), outside the Save bar
//   Culture              Save bar, ONE PATCH { section: "culture" }
//                        (companyProfile: mission, vision, about, values,
//                        splash), read by the splash, the loader captions
//                        and AI KRA generation
//   Appearance defaults  autosave per row (the old /settings/defaults)
//   Danger zone          Owner only: Transfer ownership, Delete workspace
//
// A failed GET replaces the form with ErrorState (useSettingsSection), so a
// Save can never write empty strings over live values.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { Image as ImageIcon } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SaveBar } from "@/components/settings/save-bar";
import { ChipsInput, ConfirmDialog, Field, NativeSelect, Pending, TextArea, TextInput, btn } from "@/components/settings/settings-form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { AdminOnly } from "@/components/access";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { useSettingsSection, type SettingsGetBody } from "@/hooks/use-settings-section";
import { SETTINGS_PAGES, settingsTabs } from "@/lib/settings-registry";
import { normalizeDomain } from "@/lib/settings/org-policy";
import { SPLASH_POLICIES } from "@/lib/settings/org-settings-sections";
import { AppearanceDefaults } from "./appearance-defaults";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { WORKSPACE_RENAMED_EVENT } from "@/components/layout/os/settings-shell";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX = 2 * 1024 * 1024;

const IDENTITY_TABS: readonly SettingsTab[] = settingsTabs("identity");

const BUSINESS_TYPES = ["Services", "Product", "Retail", "Manufacturing", "Non-profit", "Other"];
const TEAM_SIZES = ["1 to 10", "11 to 50", "51 to 200", "201 to 1000", "1000+"];
const INDUSTRIES = [
  "Software", "Professional services", "Manufacturing", "Retail and ecommerce", "Healthcare", "Education",
  "Financial services", "Real estate", "Media and marketing", "Hospitality", "Logistics", "Non-profit", "Other",
];
const SPLASH_LABELS: Record<(typeof SPLASH_POLICIES)[number], string> = {
  "every-open": "Every app open",
  "first-open-daily": "First open each day",
  off: "Off",
};

type Viewer = { isOwner: boolean; mayManageOwnerPages: boolean };

export default function IdentitySettingsPage() {
  return (
    <SettingsPage
      pageKey="identity"
      tabs={IDENTITY_TABS}
      subtitle="Your workspace name, your mission, and the defaults everyone starts with."
    >
      {(tab) =>
        tab === "appearance" ? <AppearanceDefaults /> : tab === "culture" ? <CultureTab /> : tab === "danger" ? <DangerTab /> : <ProfileTab />
      }
    </SettingsPage>
  );
}

/* ───────────────────────── Profile ───────────────────────── */

interface ProfileForm {
  name: string;
  domain: string;
  industry: string;
  businessType: string;
  teamSize: string;
}

function selectProfile(b: SettingsGetBody): { form: ProfileForm; logo: string | null } {
  const s = (b.settings ?? {}) as Record<string, unknown>;
  const cp = (s.companyProfile ?? {}) as { industry?: string };
  return {
    form: {
      name: b.organization?.name ?? "",
      domain: b.organization?.domain ?? "",
      industry: (typeof s.industry === "string" && s.industry) || cp.industry || "",
      businessType: typeof s.businessType === "string" ? s.businessType : "",
      teamSize: typeof s.teamSize === "string" ? s.teamSize : "",
    },
    logo: b.organization?.logo ?? null,
  };
}

// What the retired /setup wizard stored, in the words this page uses, so an
// existing workspace never reads a raw code ("smb", "1-10") in a select.
const LEGACY_WORDS: Record<string, string> = {
  startup: "Startup",
  smb: "Small business",
  mid_market: "Mid-market",
  enterprise: "Enterprise",
  "1-10": "1 to 10",
  "11-50": "11 to 50",
  "51-200": "51 to 200",
  "201-500": "201 to 500",
  "500+": "500+",
};

function withCurrent(list: string[], current: string): { value: string; label: string }[] {
  const opts = [{ value: "", label: "Not set" }, ...list.map((v) => ({ value: v, label: v }))];
  if (current && !list.includes(current)) opts.push({ value: current, label: LEGACY_WORDS[current] ?? current });
  return opts;
}

function ProfileTab() {
  const s = useSettingsSection("profile", selectProfile);
  const { data: session } = useSession();
  const sessionOrgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  const showUpcoming = useShowUpcoming();
  const { toast } = useOsToast();
  const [draft, setDraft] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<{ field?: keyof ProfileForm; message: string } | null>(null);
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = s.data?.form ?? null;
  const form = draft ?? base;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const shownLogo = logo === undefined ? (s.data?.logo ?? null) : logo;
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setErr(null);
    setDraft((d) => ({ ...(d ?? base ?? { name: "", domain: "", industry: "", businessType: "", teamSize: "" }), [k]: v }));
  };

  const save = useCallback(async () => {
    if (!draft) return true;
    if (!draft.name.trim()) { setErr({ field: "name", message: "Workspace name is required" }); return false; }
    if (draft.domain.trim() && !normalizeDomain(draft.domain)) { setErr({ field: "domain", message: "Enter a domain like acme.com" }); return false; }
    setSaving(true);
    const r = await s.save({
      name: draft.name.trim(),
      domain: draft.domain.trim() ? normalizeDomain(draft.domain) : null,
      industry: draft.industry.trim(),
      businessType: draft.businessType,
      teamSize: draft.teamSize,
    });
    setSaving(false);
    if (!r.ok) { setErr({ message: r.error ?? "Couldn't save" }); return false; }
    setDraft(null);
    toast("Profile saved");
    window.dispatchEvent(new Event("workwrk:prefs-changed"));
    // The settings crumb reads the workspace name; tell it the new one. Not
    // session.update(): that re-anchors the token to the account's home
    // workspace, which is not always the one this tab acts in.
    if (sessionOrgId && base && draft.name.trim() !== base.name) {
      window.dispatchEvent(new CustomEvent(WORKSPACE_RENAMED_EVENT, { detail: { organizationId: sessionOrgId, name: draft.name.trim() } }));
    }
    return true;
  }, [draft, s, toast, base, sessionOrgId]);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { toast("Use a PNG, JPEG, WebP or SVG"); return; }
    if (file.size > LOGO_MAX) { toast("The logo must be under 2 MB"); return; }
    setUploading(true);
    const fd = new FormData();
    fd.append("logo", file);
    const r = await apiFetch<{ logo?: string }>("/api/settings/logo", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) { toast(r.error || "Upload failed"); return; }
    setLogo(typeof r.data?.logo === "string" ? r.data.logo : null);
    toast("Logo updated");
  }
  async function removeLogo() {
    setUploading(true);
    const r = await apiFetch("/api/settings/logo", { method: "DELETE" });
    setUploading(false);
    if (!r.ok) { toast(r.error || "Couldn't remove the logo"); return; }
    setLogo(null);
    toast("Logo removed");
  }

  if (s.status === "error") return <ErrorState what="the workspace profile" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!form) return <SkeletonRows rows={6} className="max-w-[560px]" />;

  const domainChanged = !!base && form.domain.trim() !== base.domain;
  return (
    <>
      <SettingsCardStack>
        <SettingsCard title="Workspace" id="identity.workspace">
          <Field label="Logo" helper="PNG, JPG, SVG or WebP, up to 2 MB. Saved as soon as you pick it." id="identity.logo">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-line bg-hover">
                {shownLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shownLogo} alt="Workspace logo" className="h-full w-full object-contain" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-ink-3" strokeWidth={1.5} aria-hidden />
                )}
              </span>
              <button type="button" className={btn.secondary} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Pending label="Uploading" /> : null}
                {shownLogo ? "Replace" : "Upload"}
              </button>
              {shownLogo ? (
                <button type="button" className={btn.secondary} disabled={uploading} onClick={() => { void removeLogo(); }}>Remove</button>
              ) : null}
              <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="hidden" onChange={(e) => { void onPickLogo(e); }} />
            </div>
          </Field>
          <Field label="Workspace name" htmlFor="id-name" required error={err?.field === "name" ? err.message : null} id="identity.name">
            <TextInput id="id-name" value={form.name} maxLength={120} className="max-w-[360px]" invalid={err?.field === "name"} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field
            label="Primary email domain"
            htmlFor="id-domain"
            id="identity.domain"
            error={err?.field === "domain" ? err.message : null}
            helper={domainChanged ? "Existing invitations keep the old domain." : "Used by invitations and the allowed sign-in domains."}
          >
            <span className="flex max-w-[280px] items-center gap-1.5">
              <span className="text-base text-ink-2">@</span>
              <TextInput id="id-domain" value={form.domain} placeholder="acme.com" invalid={err?.field === "domain"} onChange={(e) => set("domain", e.target.value)} />
            </span>
          </Field>
        </SettingsCard>

        <SettingsCard title="About the business" description="The industry grounds AI drafts (KRAs, SOPs) in what your company actually does." id="identity.business">
          <Field label="Industry" htmlFor="id-industry" id="identity.industry">
            <TextInput id="id-industry" list="id-industries" value={form.industry} maxLength={200} className="max-w-[360px]" onChange={(e) => set("industry", e.target.value)} />
            <datalist id="id-industries">
              {INDUSTRIES.map((i) => <option key={i} value={i} />)}
            </datalist>
          </Field>
          {/* Stored, but nothing reads them yet (settings-architecture 9.1):
              behind Show upcoming features, with that said, until a reader
              exists. The stored values are kept and saved untouched. */}
          {showUpcoming ? (
            <>
              <Field label="Business type" htmlFor="id-btype" id="identity.businessType" helper="Not used anywhere yet.">
                <NativeSelect id="id-btype" value={form.businessType} options={withCurrent(BUSINESS_TYPES, form.businessType)} onChange={(v) => set("businessType", v)} />
              </Field>
              <Field label="Team size" htmlFor="id-tsize" id="identity.teamSize" helper="Not used anywhere yet.">
                <NativeSelect id="id-tsize" value={form.teamSize} options={withCurrent(TEAM_SIZES, form.teamSize)} onChange={(v) => set("teamSize", v)} />
              </Field>
            </>
          ) : null}
        </SettingsCard>

        <SettingsCard title="Branding" id="identity.branding">
          <SettingsRow
            label="Custom branding"
            helper="Your logo and name on the sign-in screen and in emails."
            control={<Link href="/settings/billing" className="text-sm font-medium text-brand-deep hover:underline">Available on Enterprise</Link>}
          />
        </SettingsCard>
        <p className="text-sm text-ink-2">
          Time zone, currency and the fiscal year are on{" "}
          <Link href="/settings/locale" className="font-medium text-brand-deep hover:underline">{SETTINGS_PAGES.locale.label}</Link>.
        </p>
        {err && !err.field ? <p role="alert" className="text-sm text-danger-text">{err.message}</p> : null}
      </SettingsCardStack>
      <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(null); setErr(null); }} onSave={save} />
    </>
  );
}

/* ───────────────────────── Culture ───────────────────────── */

interface CultureForm {
  mission: string;
  vision: string;
  about: string;
  values: string[];
  splash: (typeof SPLASH_POLICIES)[number];
}

function selectCulture(b: SettingsGetBody): CultureForm {
  const cp = ((b.settings ?? {}) as { companyProfile?: Record<string, unknown> }).companyProfile ?? {};
  const splash = cp.splash;
  return {
    mission: typeof cp.mission === "string" ? cp.mission : "",
    vision: typeof cp.vision === "string" ? cp.vision : "",
    about: typeof cp.about === "string" ? cp.about : "",
    values: Array.isArray(cp.values) ? (cp.values as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [],
    // Unset reads as what the product does for it: /api/boot (the one thing
    // that drives the splash) falls back to "first-open-daily".
    splash: splash === "every-open" || splash === "off" ? splash : "first-open-daily",
  };
}

function CultureTab() {
  const s = useSettingsSection("culture", selectCulture);
  const { toast } = useOsToast();
  const [draft, setDraft] = useState<CultureForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = s.data;
  const form = draft ?? base;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const set = <K extends keyof CultureForm>(k: K, v: CultureForm[K]) => {
    setErr(null);
    setDraft((d) => ({ ...(d ?? (base as CultureForm)), [k]: v }));
  };

  const save = useCallback(async () => {
    if (!draft) return true;
    setSaving(true);
    const r = await s.save({
      mission: draft.mission.trim(),
      vision: draft.vision.trim(),
      about: draft.about.trim(),
      values: draft.values.map((v) => v.trim()).filter(Boolean),
      // Only when it was changed here: a mission edit never rewrites the
      // splash policy.
      ...(base && draft.splash !== base.splash ? { splash: draft.splash } : {}),
    });
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "Couldn't save"); return false; }
    setDraft(null);
    toast("Culture saved");
    window.dispatchEvent(new Event("workwrk:prefs-changed"));
    return true;
  }, [draft, base, s, toast]);

  if (s.status === "error") return <ErrorState what="the culture settings" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!form) return <SkeletonRows rows={6} className="max-w-[560px]" />;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard title="Mission and vision" id="identity.mission">
          <Field label="Mission" htmlFor="cu-mission" helper="Why the company exists. Shown on the welcome splash." id="culture.mission">
            <TextArea id="cu-mission" value={form.mission} maxLength={600} onChange={(e) => set("mission", e.target.value)} />
          </Field>
          <Field label="Vision" htmlFor="cu-vision" id="culture.vision">
            <TextArea id="cu-vision" value={form.vision} maxLength={2000} onChange={(e) => set("vision", e.target.value)} />
          </Field>
          <Field label="About" htmlFor="cu-about" helper="What the company does and who it serves. Grounds AI drafts." id="culture.about">
            <TextArea id="cu-about" value={form.about} maxLength={4000} onChange={(e) => set("about", e.target.value)} />
          </Field>
        </SettingsCard>
        <SettingsCard title="Values and the welcome splash" id="identity.values">
          <Field label="Core values" helper="Values show on the welcome splash and when someone gives kudos." id="culture.values">
            <ChipsInput values={form.values} onChange={(v) => set("values", v)} max={12} reorder ariaLabel="Core values" placeholder="Add a value and press Enter" />
          </Field>
          <Field label="Welcome splash" id="culture.splash">
            <SegmentedControl
              label="Welcome splash"
              value={form.splash}
              options={SPLASH_POLICIES.map((v) => ({ value: v, label: SPLASH_LABELS[v] }))}
              onChange={(v) => set("splash", v)}
            />
          </Field>
        </SettingsCard>
        {err ? <p role="alert" className="text-sm text-danger-text">{err}</p> : null}
      </SettingsCardStack>
      <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(null); setErr(null); }} onSave={save} />
    </>
  );
}

/* ───────────────────────── Danger zone ───────────────────────── */

function DangerTab() {
  const { update: updateSession } = useSession();
  const { toast } = useOsToast();
  const s = useSettingsSection("profile", (b) => ({
    orgName: b.organization?.name ?? "",
    viewer: ((b as { viewer?: Viewer }).viewer ?? { isOwner: false, mayManageOwnerPages: false }) as Viewer,
  }));
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [target, setTarget] = useState<PickPerson | null>(null);
  const [removeMe, setRemoveMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<string[]>([]);

  useEffect(() => {
    if (!transferOpen) return;
    void apiFetch<{ admins: { name: string }[] }>("/api/org/admins").then((r) => {
      if (r.ok) setOwners(r.data.admins.map((a) => a.name));
    });
  }, [transferOpen]);

  const remaining = useMemo(() => {
    const names = [...owners];
    if (target) names.push(`${target.firstName ?? ""} ${target.lastName ?? ""}`.trim());
    return names.filter(Boolean);
  }, [owners, target]);

  if (s.status === "error") return <ErrorState what="the workspace" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!s.data) return <SkeletonRows rows={3} className="max-w-[560px]" />;
  const { orgName, viewer } = s.data;
  if (!viewer.mayManageOwnerPages) {
    return <AdminOnly page="Danger zone" managedBy="Owners" back={{ fallbackHref: "/settings", label: "Back to Overview" }} />;
  }

  async function transfer() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ tokenVersionProof?: string | null }>("/api/settings/ownership", { method: "POST", json: { userId: target.id, removeMe } });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.data?.tokenVersionProof) await updateSession({ tokenVersionProof: r.data.tokenVersionProof });
    setTransferOpen(false);
    setTarget(null);
    toast("Ownership updated");
  }

  async function del() {
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/organizations/delete", { method: "POST", json: { confirmName: orgName, confirmPhrase: "DELETE" } });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDeleteOpen(false);
    // Out of the workspace at once (it was the workspace menu's behaviour):
    // into another workspace this person belongs to, else signed out. The
    // session check would move them within five minutes anyway.
    const orgs = await apiFetch<{ memberships?: { isCurrent: boolean; organization: { id: string; name: string } }[] }>("/api/me/orgs", { cache: "no-store" });
    const other = orgs.ok ? (orgs.data?.memberships ?? []).find((m) => !m.isCurrent)?.organization : undefined;
    if (other) {
      toast(`The workspace is scheduled for deletion. Switching you to ${other.name}`);
      const sw = await apiFetch("/api/me/switch-org", { method: "POST", json: { organizationId: other.id } });
      if (sw.ok) {
        await updateSession();
        window.location.href = WORK_HOME_HREF;
        return;
      }
    }
    toast("The workspace is scheduled for deletion");
    void signOut({ callbackUrl: "/login" });
  }

  return (
    <SettingsCardStack>
      <SettingsCard title="Danger zone" danger id="identity.danger">
        <SettingsRow
          id="identity.transfer"
          label="Transfer ownership"
          helper={viewer.isOwner ? "Make someone else an Owner of this workspace." : "Only an Owner can make someone else an Owner."}
          control={viewer.isOwner ? <button type="button" className={btn.dangerGhost} onClick={() => { setError(null); setTransferOpen(true); }}>Transfer ownership</button> : null}
        />
        <SettingsRow
          id="identity.delete"
          label="Delete workspace"
          helper="Everyone is signed out. WorkwrK support can restore it for 30 days; after that it is gone for good."
          control={<button type="button" className={btn.dangerGhost} onClick={() => { setError(null); setDeleteOpen(true); }}>Delete workspace</button>}
        />
      </SettingsCard>

      <ConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="Transfer ownership"
        width={560}
        confirmLabel="Make Owner"
        onConfirm={transfer}
        busy={busy}
        error={error}
      >
        <Field label="New Owner">
          <PeoplePickerField
            ariaLabel="New Owner"
            value={target ? [target.id] : []}
            people={target ? [target] : []}
            placeholder="Pick a person"
            onChange={(_ids, picked) => setTarget(picked[0] ?? null)}
          />
        </Field>
        <label className="flex items-center gap-2 text-base text-ink">
          <input type="checkbox" checked={removeMe} onChange={(e) => setRemoveMe(e.target.checked)} className="h-4 w-4" />
          Also remove me as an Owner (I stay an Admin)
        </label>
        {target ? (
          <p className="text-sm text-ink-2">
            Owners and Admins after this: {remaining.join(", ")}.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete workspace"
        danger
        typed={orgName}
        confirmLabel="Delete workspace"
        onConfirm={del}
        busy={busy}
        error={error}
      >
        <p>This schedules <span className="font-semibold">{orgName}</span> for deletion: every Space, List, task, doc, table and person in it.</p>
        <p className="text-ink-2">Everyone is signed out within minutes. For 30 days WorkwrK support can restore it; after that it is deleted for good.</p>
      </ConfirmDialog>
    </SettingsCardStack>
  );
}
