"use client";

// Workspace settings > Security (spec-settings-workspace `/settings/security`,
// settings-architecture 5.9). Owner page (every Admin until the Owner and
// Admin split). How people sign in to this workspace.
//
//   Sign-in policy   ONE Save bar, section "security". Every row names its
//                    reader:
//                      passwords      src/lib/password-policy.ts at signup,
//                                     join, reset and change-password (and
//                                     the live checklist beside each)
//                      password age   the jwt revalidation stamps a hold and
//                                     src/proxy.ts allows only My settings >
//                                     Security until it is changed
//                      sessions       src/lib/auth/session-policy.ts in the
//                                     jwt callback; 12h stays the ceiling
//                      two-factor     authorize() asks the code, or enrols the
//                                     person first; ENFORCE_MFA_AT_LOGIN stays
//                                     the floor for anyone enrolled
//                      lockout        src/lib/login-throttle.ts, where 8
//                                     failures and 15 minutes are the floor
//                    Danger zone: Sign everyone out (typed SIGN OUT).
//   Provisioning     SCIM tokens (/api/scim-tokens) and the rules the SCIM
//                    routes apply: Members by default, domain lock, deprovision
//                    = deactivate and hand the work over.
//   Single sign-on   not in the tab row until a SAML sign-in is verified end
//                    to end; under "Show upcoming features" one line says so.

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SaveBar } from "@/components/settings/save-bar";
import { ConfirmDialog, Field, NumberInput, TextInput, btn } from "@/components/settings/settings-form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { useSettingsSection, type SettingsGetBody } from "@/hooks/use-settings-section";
import { DEFAULT_SIGN_IN_POLICY, SIGN_IN_BOUNDS, type SignInPolicy } from "@/lib/settings/org-policy";
import { formatRelative } from "@/lib/format/date";

type Summary = {
  mfa: { admins: number; enrolled: number; everyone: number; everyoneEnrolled: number; viewerEnrolled: boolean };
  scimBaseUrl: string;
};

const TABS: SettingsTab[] = [
  { key: "signin", label: "Sign-in policy" },
  { key: "provisioning", label: "Provisioning" },
];

export default function WorkspaceSecurityPage() {
  const [genSignal, setGenSignal] = useState(0);
  const tabs = TABS.map((t) => (t.key === "provisioning" ? { ...t, primary: { label: "Generate token", onClick: () => setGenSignal((n) => n + 1) } } : t));
  return (
    <SettingsPage pageKey="security" tabs={tabs} subtitle="How people sign in to your workspace. Changes apply at their next check, within five minutes.">
      {(tab) => (tab === "provisioning" ? <ProvisioningTab genSignal={genSignal} /> : <SignInTab />)}
    </SettingsPage>
  );
}

/* ───────────────────────── Sign-in policy ───────────────────────── */

function SignInTab() {
  const { toast } = useOsToast();
  const showUpcoming = useShowUpcoming();
  const s = useSettingsSection("security", (b: SettingsGetBody) => {
    const st = (b.settings ?? {}) as { signIn?: SignInPolicy; users?: { allowedDomains?: string[] }; signInLegacy?: { twoFactorEnabled?: boolean } };
    return { policy: st.signIn ?? DEFAULT_SIGN_IN_POLICY, domains: st.users?.allowedDomains ?? [], legacyTwoFactor: st.signInLegacy?.twoFactorEnabled === true };
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [draft, setDraft] = useState<SignInPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmMfa, setConfirmMfa] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void apiFetch<Summary>("/api/settings/security-summary", { cache: "no-store" }).then((r) => { if (r.ok) setSummary(r.data); });
  }, []);

  const base = s.data?.policy ?? null;
  const form = draft ?? base;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base);
  const set = <K extends keyof SignInPolicy>(k: K, v: SignInPolicy[K]) => { setErr(null); setDraft((d) => ({ ...(d ?? (base as SignInPolicy)), [k]: v })); };

  const doSave = useCallback(async () => {
    if (!draft || !base) return true;
    const changed = Object.fromEntries((Object.keys(draft) as (keyof SignInPolicy)[]).filter((k) => draft[k] !== base[k]).map((k) => [k, draft[k]]));
    setSaving(true);
    const r = await s.save(changed);
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "Couldn't save"); return false; }
    setDraft(null);
    toast("Sign-in policy saved");
    return true;
  }, [draft, base, s, toast]);

  // Raising the two step audience over someone who has not set it up (the
  // saver included) holds them at their next check until they enrol: ask.
  const save = useCallback(async () => {
    if (draft && base && draft.mfaRequired !== base.mfaRequired && draft.mfaRequired !== "off" && summary && !summary.mfa.viewerEnrolled) {
      setConfirmMfa(true);
      return false;
    }
    return doSave();
  }, [draft, base, summary, doSave]);

  if (s.status === "error") return <ErrorState what="the sign-in policy" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!form) return <SkeletonRows rows={8} className="max-w-[560px]" />;
  const b = SIGN_IN_BOUNDS;
  const num = (k: keyof SignInPolicy, bounds: { min: number; max: number }, suffix: string, label: string) => (
    <NumberInput value={form[k] as number} min={bounds.min} max={bounds.max} suffix={suffix} ariaLabel={label}
      onChange={(n) => set(k, (n === "" ? bounds.min : Math.min(bounds.max, Math.max(bounds.min, n))) as never)} />
  );
  const audience = form.mfaRequired === "everyone" ? summary?.mfa.everyone : summary?.mfa.admins;
  const audienceEnrolled = form.mfaRequired === "everyone" ? summary?.mfa.everyoneEnrolled : summary?.mfa.enrolled;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard title="Passwords" id="signin.passwords">
          <SettingsRow label="Minimum length" id="security.minPasswordLength" control={num("minPasswordLength", b.minPasswordLength, "characters", "Minimum length")} />
          <SettingsRow label="Require an uppercase letter" control={<Switch checked={form.requireUppercase} onChange={(v) => set("requireUppercase", v)} aria-label="Require an uppercase letter" />} />
          <SettingsRow label="Require a number" control={<Switch checked={form.requireNumbers} onChange={(v) => set("requireNumbers", v)} aria-label="Require a number" />} />
          <SettingsRow label="Require a symbol" control={<Switch checked={form.requireSymbol} onChange={(v) => set("requireSymbol", v)} aria-label="Require a symbol" />} />
          <SettingsRow label="Password expires after" helper="0 means never. A password with no recorded change date is never expired." id="security.passwordMaxAgeDays"
            control={num("passwordMaxAgeDays", b.passwordMaxAgeDays, "days", "Password expires after days")} />
        </SettingsCard>

        <SettingsCard title="Sessions" id="signin.sessions">
          <SettingsRow label="Signed out after being idle for" helper={`${b.sessionIdleMinutes.min} to ${b.sessionIdleMinutes.max} minutes. Anyone clicking or typing stays signed in.`} id="security.sessionIdleMinutes"
            control={num("sessionIdleMinutes", b.sessionIdleMinutes, "minutes", "Idle minutes")} />
          <SettingsRow label="Signed out after" helper="However active they are, people sign in again after this." id="security.sessionMaxDays"
            control={num("sessionMaxDays", b.sessionMaxDays, "days", "Session lifetime days")} />
        </SettingsCard>

        <SettingsCard title="Two step verification" id="signin.mfa">
          <Field label="Require it for" helper="Someone in this group who has not set it up is asked to, right after their password, before anything else.">
            <SegmentedControl
              label="Require two step verification for"
              value={form.mfaRequired}
              options={[{ value: "off", label: "Nobody" }, { value: "admins", label: "Admins" }, { value: "everyone", label: "Everyone" }]}
              onChange={(v) => set("mfaRequired", v)}
            />
          </Field>
          {s.data?.legacyTwoFactor && base?.mfaRequired === "off" ? (
            // An older settings page stored "two-factor required" in a key
            // nothing ever enforced (src/lib/auth/security-policy.ts). It is
            // still not enforced, on purpose: switching a rule on under
            // people who never saw it would hold them at their next click.
            // Said here, so an Owner who believes it is on can choose.
            <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-ink">
              An older setting says two step verification is required for everyone, but it was never enforced and is not now. Choose Everyone above and save to require it.
            </p>
          ) : null}
          {summary ? (
            <p className="text-sm text-ink-2">
              {form.mfaRequired === "off"
                ? `${summary.mfa.everyoneEnrolled} of ${summary.mfa.everyone} people have set it up.`
                : `${audienceEnrolled} of ${audience} ${form.mfaRequired === "everyone" ? "people" : "Owners and Admins"} have set it up.`}{" "}
              <Link href="/settings/members?filter=role:admin" className="font-medium text-brand-deep hover:underline">See who</Link>
            </p>
          ) : null}
        </SettingsCard>

        <SettingsCard title="Failed sign-ins" description="The built-in rule is 8 failures, then 15 minutes. You can lock sooner or for longer, never later." id="signin.lockout">
          <SettingsRow label="Lock the account after" control={num("lockoutThreshold", b.lockoutThreshold, "attempts", "Attempts before lockout")} />
          <SettingsRow label="Keep it locked for" control={num("lockoutMinutes", b.lockoutMinutes, "minutes", "Lockout minutes")} />
        </SettingsCard>

        <SettingsCard title="Invitation domains" id="security.domains">
          <SettingsRow
            label="Who can be invited"
            readOnlyValue={s.data?.domains.length ? s.data.domains.join(", ") : "The workspace's own domain"}
            helper={<>Invitations and new accounts from your identity provider. People already in the workspace sign in whatever their domain. <Link href="/settings/members?tab=pending" className="font-medium text-brand-deep hover:underline">Manage in Members, Invite rules</Link></>}
          />
        </SettingsCard>

        {showUpcoming ? <p className="text-sm text-ink-3">Coming soon: single sign-on with SAML and OIDC, once a sign-in is verified end to end.</p> : null}

        <SettingsCard title="Danger zone" danger id="signin.signOutAll">
          <SettingsRow
            label="Log everyone out"
            helper="Every session on every device ends within five minutes. Everyone, including you, signs in again."
            control={<button type="button" className={btn.dangerGhost} onClick={() => setSignOutOpen(true)}>Log out everywhere</button>}
          />
        </SettingsCard>
        {err ? <p role="alert" className="text-sm text-danger-text">{err}</p> : null}
      </SettingsCardStack>
      <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(null); setErr(null); }} onSave={save} />

      <ConfirmDialog open={confirmMfa} onOpenChange={setConfirmMfa} title="You have not set up two step verification" confirmLabel="Save anyway" onConfirm={async () => { setConfirmMfa(false); await doSave(); }}>
        <p>This rule covers you. Within five minutes you will be asked to set it up before you can do anything else, so have your phone ready.</p>
        <p className="text-ink-2"><Link href="/account/security?enrol=mfa" className="font-medium text-brand-deep hover:underline">Set it up now</Link> instead, then come back.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Log everyone out?"
        danger
        typed="SIGN OUT"
        confirmLabel="Log out everywhere"
        busy={signingOut}
        onConfirm={async () => {
          setSigningOut(true);
          const r = await apiFetch<{ signedOut: number }>("/api/org/sign-out-everyone", { method: "POST", json: { confirm: "SIGN OUT" } });
          setSigningOut(false);
          if (!r.ok) { toast(r.error); return; }
          setSignOutOpen(false);
          toast(`${r.data.signedOut} people will sign in again`);
        }}
      >
        <p>Everyone, including you, signs in again.</p>
      </ConfirmDialog>
    </>
  );
}

/* ───────────────────────── Provisioning (SCIM) ───────────────────────── */

type ScimToken = { id: string; name: string; tokenPrefix: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

function ProvisioningTab({ genSignal }: { genSignal: number }) {
  const { toast } = useOsToast();
  const [tokens, setTokens] = useState<ScimToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState<number | "">(365);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ScimToken | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<ScimToken[]>("/api/scim-tokens", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setTokens(Array.isArray(r.data) ? r.data : []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    void apiFetch<Summary>("/api/settings/security-summary", { cache: "no-store" }).then((r) => { if (r.ok) setSummary(r.data); });
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (genSignal <= 0) return;
    const t = setTimeout(() => { setName(""); setDays(365); setFormErr(null); setGenOpen(true); }, 0);
    return () => clearTimeout(t);
  }, [genSignal]);

  const generate = async () => {
    if (!name.trim()) { setFormErr("Name the token after the identity provider that uses it."); return; }
    setBusy(true);
    const expiresAt = typeof days === "number" && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    const r = await apiFetch<{ token: string }>("/api/scim-tokens", { method: "POST", json: { name: name.trim(), expiresAt } });
    setBusy(false);
    if (!r.ok) { setFormErr(r.error); return; }
    setGenOpen(false);
    setRevealed(r.data.token);
    void load();
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    const r = await apiFetch(`/api/scim-tokens/${revoking.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setRevoking(null);
    toast("Token revoked");
    void load();
  };

  const columns: TableColumn<ScimToken>[] = [
    { key: "name", label: "Name", title: true, width: "minmax(180px,1.4fr)", render: (t) => t.name },
    { key: "prefix", label: "Prefix", width: "140px", render: (t) => <span className="font-mono text-sm">{t.tokenPrefix}</span> },
    { key: "created", label: "Created", width: "120px", render: (t) => formatRelative(t.createdAt) },
    { key: "used", label: "Last used", width: "120px", render: (t) => (t.lastUsedAt ? formatRelative(t.lastUsedAt) : "Never") },
    { key: "expires", label: "Expires", width: "120px", render: (t) => <DateText value={t.expiresAt} fallback="Never" /> },
  ];

  return (
    <SettingsCardStack>
      <SettingsCard title="SCIM endpoint" id="security.scimUrl">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-hover px-3 py-2 font-mono text-sm">{summary?.scimBaseUrl ?? " "}</code>
          <button type="button" className={btn.secondary} disabled={!summary} onClick={() => { if (summary) void navigator.clipboard?.writeText(summary.scimBaseUrl).then(() => toast("Copied")); }}>
            <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy
          </button>
        </div>
      </SettingsCard>
      {error ? (
        <ErrorState what="provisioning tokens" hint={error} onRetry={() => { void load(); }} />
      ) : (
        <TableCard
          ariaLabel="Provisioning tokens"
          columns={columns}
          rows={tokens}
          rowKey={(t) => t.id}
          rowMenuAlwaysVisible
          rowMenuWidth={96}
          rowMenu={(t) => <button type="button" className={btn.dangerGhost} onClick={() => setRevoking(t)}>Revoke</button>}
          empty={<span>No provisioning tokens yet · <button type="button" className="text-brand-deep hover:underline" onClick={() => setGenOpen(true)}>Generate a token</button></span>}
          footer={tokens ? { total: tokens.length, noun: "tokens", from: tokens.length ? 1 : 0, to: tokens.length, hidePaging: true } : undefined}
        />
      )}
      <SettingsCard title="How provisioning works" id="security.scimRules">
        <p className="text-base text-ink">People created by your identity provider arrive as Members. Owner, Admin and Agent are set here, never by the provider. An address outside your allowed domains is refused. Removing someone there deactivates them here and hands what they owned to their manager, else to an Owner; the last Owner is never removed that way.</p>
      </SettingsCard>

      <ConfirmDialog open={genOpen} onOpenChange={setGenOpen} title="Generate a provisioning token" width={560} confirmLabel="Generate token" onConfirm={generate} busy={busy} error={formErr}>
        <Field label="Name" htmlFor="scim-name" required>
          <TextInput id="scim-name" value={name} maxLength={80} placeholder="Okta" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Expires after" helper="0 means never. Rotate tokens at least once a year.">
          <NumberInput value={days} min={0} max={3650} suffix="days" ariaLabel="Token expiry days" onChange={setDays} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!revealed} onOpenChange={(v) => { if (!v) setRevealed(null); }} title="Copy your provisioning token" width={560} confirmLabel="Done, I have saved it" onConfirm={() => setRevealed(null)}>
        <p>This is the only time the token is shown. Paste it into your identity provider now.</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-hover px-3 py-2 font-mono text-sm">{revealed}</code>
          <button type="button" className={btn.secondary} onClick={() => { if (revealed) void navigator.clipboard?.writeText(revealed).then(() => toast("Copied")); }}>
            <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy
          </button>
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={!!revoking} onOpenChange={(v) => { if (!v) setRevoking(null); }} title="Revoke this token?" danger confirmLabel="Revoke token" onConfirm={revoke} busy={busy}>
        <p>Your identity provider stops creating and removing people here at once.</p>
      </ConfirmDialog>
    </SettingsCardStack>
  );
}
