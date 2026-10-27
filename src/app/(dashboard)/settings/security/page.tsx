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
//                                     jwt callback; 30 days stays the
//                                     ceiling, stored in minutes, said in
//                                     plain words beside the field
//                      two-factor     authorize() asks the code, or enrols the
//                                     person first; ENFORCE_MFA_AT_LOGIN stays
//                                     the floor for anyone enrolled
//                      lockout        src/lib/login-throttle.ts, where 8
//                                     failures and 15 minutes are the floor
//                    Danger zone: Log everyone out (typed SIGN OUT).
//   Provisioning     SCIM tokens (/api/scim-tokens) and the rules the SCIM
//                    routes apply: Members by default, domain lock, deprovision
//                    = deactivate and hand the work over.
//   Single sign-on   not in the tab row until a SAML sign-in is verified end
//                    to end; under "Show upcoming features" one line says so,
//                    the Passwords card's last line.
//
// Settings clean-up Phase 7 (B5, B6, B12): a row hint is one line and the
// rest of a long one sits behind its Show more, but what a control does to
// people (Log everyone out, Removing someone there) stays shown; a number
// field is named by the words beside it; nothing floats between the cards.
// A failed read of the two step counts never skips the confirm a raise asks
// (mfaConfirmKind), and a failed read of the SCIM address says so.
// Phase 7 review: Save is held while the counts are read again before a
// raise (L2), and both ways to Generate token start the form afresh (L3).

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Copy, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SaveBar } from "@/components/settings/save-bar";
import { ConfirmDialog, Field, NumberInput, TextInput, btn, useTypedNumbers } from "@/components/settings/settings-form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { draftAfterSave, useSettingsSection, type SettingsGetBody } from "@/hooks/use-settings-section";
import { DEFAULT_SIGN_IN_POLICY, SIGN_IN_BOUNDS, minutesInWords, type SignInPolicy } from "@/lib/settings/org-policy";
import { formatRelative } from "@/lib/format/date";
import {
  INVITE_DOMAINS_DESCRIPTION,
  INVITE_DOMAINS_HINT,
  LOG_OUT_EVERYONE_HINT,
  MFA_CONFIRM_COPY,
  PROVISIONING_LINE,
  PROVISIONING_MORE,
  SSO_UPCOMING,
  ScimEndpoint,
  mfaConfirmKind,
} from "./security-ui";

type Summary = {
  mfa: { admins: number; enrolled: number; everyone: number; everyoneEnrolled: number; viewerEnrolled: boolean };
  scimBaseUrl: string;
};

type NumKey = keyof typeof SIGN_IN_BOUNDS;
// The row label each number field goes by, for the "fix these first" line.
const NUM_LABEL: Record<NumKey, string> = {
  minPasswordLength: "Minimum length",
  passwordMaxAgeDays: "Password expires after",
  sessionIdleMinutes: "Signed out after being idle for",
  sessionMaxDays: "Signed out after",
  lockoutThreshold: "Lock the account after",
  lockoutMinutes: "Keep it locked for",
};

const TABS: SettingsTab[] = [
  { key: "signin", label: "Sign-in policy" },
  { key: "provisioning", label: "Provisioning" },
];

export default function WorkspaceSecurityPage() {
  const [genSignal, setGenSignal] = useState(0);
  const tabs = TABS.map((t) => (t.key === "provisioning" ? { ...t, primary: { label: "Generate token", onClick: () => setGenSignal((n) => n + 1) } } : t));
  return (
    <SettingsPage pageKey="security" tabs={tabs}>
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
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [draft, setDraft] = useState<SignInPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The two step confirm, and which words it says: the saver has not set it
  // up, or that could not be checked (kept while it closes, so its title
  // never changes under the closing dialog).
  const [confirmMfa, setConfirmMfa] = useState(false);
  const [mfaKind, setMfaKind] = useState<"notEnrolled" | "unknown">("notEnrolled");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // The counts being read again before a raise asks: Save is held (the bar
  // shows it busy), and a second press, Cmd+S or the leave guard's Save
  // while it is out is refused by the ref, which a render cannot lag.
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  // What is typed into a number field stays as typed; the draft takes only
  // in-range numbers, and Save waits until every field holds one.
  const nums = useTypedNumbers();

  const loadSummary = useCallback(async (): Promise<Summary | null> => {
    setSummaryFailed(false);
    const r = await apiFetch<Summary>("/api/settings/security-summary", { cache: "no-store" });
    if (!r.ok) { setSummaryFailed(true); return null; }
    setSummary(r.data);
    return r.data;
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void loadSummary(); }, 0);
    return () => clearTimeout(t);
  }, [loadSummary]);

  const base = s.data?.policy ?? null;
  const form = draft ?? base;
  // A field left empty or out of range is unsaved work too: the bar stays
  // up (and the guard armed) so it is fixed or discarded, never forgotten.
  const dirty = (!!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base)) || nums.blocked;
  const numbersReady = () => {
    if (nums.check()) return true;
    setErr(`Fix the fields marked in red before saving: ${nums.heldKeys.map((k) => NUM_LABEL[k as NumKey] ?? k).join(", ")}.`);
    return false;
  };
  const set = <K extends keyof SignInPolicy>(k: K, v: SignInPolicy[K]) => { setErr(null); setDraft((d) => ({ ...(d ?? (base as SignInPolicy)), [k]: v })); };

  // Plain functions, not memoized: the typed-number state they consult is
  // rebuilt each render, and the Save bar wraps whatever it is given.
  const doSave = async () => {
    if (!numbersReady()) return false;
    if (!draft || !base) return true;
    const changed = Object.fromEntries((Object.keys(draft) as (keyof SignInPolicy)[]).filter((k) => draft[k] !== base[k]).map((k) => [k, draft[k]]));
    setSaving(true);
    const r = await s.save(changed);
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "Couldn't save"); return false; }
    // Anything typed while the save was out stays, unsaved: the draft
    // (draftAfterSave) and a number field's text (nums.saved).
    setDraft((d) => draftAfterSave(d, draft));
    nums.saved();
    // The policy reaches each signed-in person at their session's next check
    // (REVALIDATE_MS in src/lib/auth.ts, five minutes).
    toast("Sign-in policy saved", { description: "It applies to everyone at their next check, within five minutes." });
    return true;
  };

  // Raising the two step audience over someone who has not set it up (the
  // saver included) holds them at their next check until they enrol: ask.
  // With no counts read, they are read again first, and a read that still
  // fails asks too, saying it could not check (mfaConfirmKind): before, a
  // failed read skipped the question as if the saver had set it up.
  const save = async () => {
    if (checkingRef.current) return false;
    if (!numbersReady()) return false;
    const raising = mfaConfirmKind(draft, base, null) !== "none";
    let read = summary;
    if (raising && !read) {
      checkingRef.current = true;
      setChecking(true);
      try {
        read = await loadSummary();
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    }
    const kind = raising ? mfaConfirmKind(draft, base, read) : "none";
    if (kind !== "none") {
      setMfaKind(kind);
      setConfirmMfa(true);
      return false;
    }
    return doSave();
  };

  if (s.status === "error") return <ErrorState what="the sign-in policy" hint={s.error ?? undefined} onRetry={s.retry} />;
  if (!form) return <SkeletonRows rows={8} />;
  const b = SIGN_IN_BOUNDS;
  // A row's control, helper and Show more: the helper gives way to the range
  // sentence while the field holds something that cannot be saved. The field
  // is named by the words beside it, its row's label and then its unit, so a
  // spoken name starts with what is on screen ("Signed out after days").
  const num = (k: NumKey, suffix: string, label: string, helper?: ReactNode, more?: ReactNode) => {
    const f = nums.field(k, form[k], b[k], (n) => set(k, n));
    return {
      control: <NumberInput {...f.input} suffix={suffix} ariaLabel={`${label} ${suffix}`} />,
      helper: f.error ? <span role="alert" className="text-danger-text">{f.error}</span> : helper,
      more,
    };
  };
  const audience = form.mfaRequired === "everyone" ? summary?.mfa.everyone : summary?.mfa.admins;
  const audienceEnrolled = form.mfaRequired === "everyone" ? summary?.mfa.everyoneEnrolled : summary?.mfa.enrolled;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard title="Passwords" id="signin.passwords">
          <SettingsRow label="Minimum length" id="security.minPasswordLength" {...num("minPasswordLength", "characters", "Minimum length")} />
          <SettingsRow label="Require an uppercase letter" control={<Switch checked={form.requireUppercase} onChange={(v) => set("requireUppercase", v)} aria-label="Require an uppercase letter" />} />
          <SettingsRow label="Require a number" control={<Switch checked={form.requireNumbers} onChange={(v) => set("requireNumbers", v)} aria-label="Require a number" />} />
          <SettingsRow label="Require a symbol" control={<Switch checked={form.requireSymbol} onChange={(v) => set("requireSymbol", v)} aria-label="Require a symbol" />} />
          <SettingsRow label="Password expires after" id="security.passwordMaxAgeDays"
            {...num("passwordMaxAgeDays", "days", "Password expires after", "0 means never. A password with no recorded change date is never expired.")} />
          {/* Inside the card it belongs to, never a line between cards (B12). */}
          {showUpcoming ? <p className="m-0 text-sm text-ink-2">{SSO_UPCOMING}</p> : null}
        </SettingsCard>

        <SettingsCard title="Sessions" id="signin.sessions">
          {/* What people feel stays on the line (now, and that activity keeps
              them in); how the field counts is behind Show more (B6). */}
          <SettingsRow label="Signed out after being idle for" id="security.sessionIdleMinutes"
            {...num(
              "sessionIdleMinutes",
              "minutes",
              "Signed out after being idle for",
              `Now ${minutesInWords(form.sessionIdleMinutes)}. Anyone clicking or typing stays signed in.`,
              <p className="m-0">{`Set in minutes, from ${minutesInWords(b.sessionIdleMinutes.min)} to ${minutesInWords(b.sessionIdleMinutes.max)} (${b.sessionIdleMinutes.max.toLocaleString("en-US")} minutes). One day is 1,440 minutes.`}</p>,
            )} />
          <SettingsRow label="Signed out after" id="security.sessionMaxDays"
            {...num("sessionMaxDays", "days", "Signed out after", `${b.sessionMaxDays.min} to ${b.sessionMaxDays.max} days. However active they are, people sign in again after this.`)} />
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
            // A warning line in the card, the outcome line's look with its
            // sign, never a filled box inside the card (B4).
            <p role="note" className="m-0 flex items-start gap-2 text-sm text-ink">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0">An older setting says two step verification is required for everyone, but it was never enforced and is not now. Choose Everyone above and save to require it.</span>
            </p>
          ) : null}
          {summary ? (
            <p className="text-sm text-ink-2">
              {form.mfaRequired === "off"
                ? `${summary.mfa.everyoneEnrolled} of ${summary.mfa.everyone} people have set it up.`
                : `${audienceEnrolled} of ${audience} ${form.mfaRequired === "everyone" ? "people" : "Owners and Admins"} have set it up.`}{" "}
              <Link href="/settings/members?filter=role:admin" className="font-medium text-brand-deep hover:underline">See who</Link>
            </p>
          ) : summaryFailed ? (
            // The counts did not load: said, with its retry, never a line
            // that quietly disappears.
            <p className="text-sm text-ink-2">
              Couldn&apos;t count who has set it up ·{" "}
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { void loadSummary(); }}>Try again</button>
            </p>
          ) : null}
        </SettingsCard>

        <SettingsCard title="Failed sign-ins" description="The built-in rule is 8 failures, then 15 minutes. You can lock sooner or for longer, never later." id="signin.lockout">
          <SettingsRow label="Lock the account after" {...num("lockoutThreshold", "attempts", "Lock the account after")} />
          <SettingsRow label="Keep it locked for" {...num("lockoutMinutes", "minutes", "Keep it locked for")} />
        </SettingsCard>

        {/* The card's description says what the list governs, the row's one
            line what it never does, and where it is changed is the card's
            action (B4, B5), not a link wrapped into a two line hint. */}
        <SettingsCard
          title="Invitation domains"
          id="security.domains"
          description={INVITE_DOMAINS_DESCRIPTION}
          actions={<Link href="/settings/members?tab=pending" className={btn.link}>Manage in Members, Invite rules</Link>}
        >
          <SettingsRow
            label="Who can be invited"
            readOnlyValue={s.data?.domains.length ? s.data.domains.join(", ") : "The workspace's own domain"}
            helper={INVITE_DOMAINS_HINT}
          />
        </SettingsCard>

        <SettingsCard title="Danger zone" danger id="signin.signOutAll">
          <SettingsRow
            label="Log everyone out"
            helper={LOG_OUT_EVERYONE_HINT}
            control={<button type="button" className={btn.dangerGhost} onClick={() => setSignOutOpen(true)}>Log out everywhere</button>}
          />
        </SettingsCard>
        {err ? <p role="alert" className="text-sm text-danger-text">{err}</p> : null}
      </SettingsCardStack>
      <SaveBar dirty={dirty} saving={saving || checking} onDiscard={() => { setDraft(null); setErr(null); nums.reset(); }} onSave={save} />

      <ConfirmDialog open={confirmMfa} onOpenChange={setConfirmMfa} title={MFA_CONFIRM_COPY[mfaKind].title} confirmLabel="Save anyway" onConfirm={async () => { setConfirmMfa(false); await doSave(); }}>
        <p>{MFA_CONFIRM_COPY[mfaKind].body}</p>
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
  const [summaryFailed, setSummaryFailed] = useState(false);
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
  const loadSummary = useCallback(async () => {
    setSummaryFailed(false);
    const r = await apiFetch<Summary>("/api/settings/security-summary", { cache: "no-store" });
    if (r.ok) setSummary(r.data);
    else setSummaryFailed(true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); void loadSummary(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadSummary]);
  // Every way in starts the form afresh: the header's Generate token and
  // the empty table's link (it used to reopen the last try's name and error).
  const openGenerate = useCallback(() => { setName(""); setDays(365); setFormErr(null); setGenOpen(true); }, []);
  useEffect(() => {
    if (genSignal <= 0) return;
    const t = setTimeout(openGenerate, 0);
    return () => clearTimeout(t);
  }, [genSignal, openGenerate]);

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
        <ScimEndpoint
          url={summary?.scimBaseUrl ?? null}
          failed={summaryFailed}
          onRetry={() => { void loadSummary(); }}
          onCopy={(url) => { void navigator.clipboard?.writeText(url).then(() => toast("Copied")); }}
        />
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
          empty={<span>No provisioning tokens yet · <button type="button" className="text-brand-deep hover:underline" onClick={openGenerate}>Generate a token</button></span>}
          footer={tokens ? { total: tokens.length, noun: "tokens", from: tokens.length ? 1 : 0, to: tokens.length, hidePaging: true } : undefined}
        />
      )}
      {/* What happens to people is the card's two line description; the
          rules on roles, domains and the last Owner open under Show more (B6). */}
      <SettingsCard
        title="How provisioning works"
        id="security.scimRules"
        description={PROVISIONING_LINE}
        more={PROVISIONING_MORE.map((line) => <p key={line} className="m-0">{line}</p>)}
      />

      <ConfirmDialog open={genOpen} onOpenChange={setGenOpen} title="Generate a provisioning token" width={560} confirmLabel="Generate token" onConfirm={generate} busy={busy} error={formErr}>
        <Field label="Name" htmlFor="scim-name" required>
          <TextInput id="scim-name" value={name} maxLength={80} placeholder="Okta" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Expires after" helper="0 means never. Rotate tokens at least once a year.">
          <NumberInput value={days} min={0} max={3650} suffix="days" ariaLabel="Token expiry days" onChange={setDays} />
        </Field>
      </ConfirmDialog>
      {/* Shown once: only Done closes it, never Esc or a click outside (final Settings review, L6). */}
      <ConfirmDialog open={!!revealed} onOpenChange={(v) => { if (!v) setRevealed(null); }} title="Copy your provisioning token" width={560} confirmLabel="Done, I have saved it" onConfirm={() => setRevealed(null)} dismissable={false}>
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
