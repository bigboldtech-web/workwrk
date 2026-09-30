"use client";

// My settings > Security (spec-account-auth `/account/security`).
//
//   How you log in       Password (age from User.passwordChangedAt), Two step
//                        verification (Turn on, or a menu with Show backup
//                        codes / Get new backup codes / Turn off, and no Turn
//                        off at all when the org requires it for this role),
//                        Backup codes (count only), Email verified
//   Where you are logged in   Log out everywhere (a confirm, this device too)
//   Recent security activity  the last 20 events, plain words, no row action
//   Presence             Show me as + Clear after, writing User.presenceStatus
//                        and presenceUntil through the shell (the avatar menu
//                        writes the same two columns)
//
// Gone, on purpose: the invented "security score" (a number nothing measured),
// the "Access level" row shown as a passed check, and the read-only "Org
// policy" card whose session timeout and org-wide two step values nothing
// enforced. The live rules print inside the Change password dialog, and
// Owners and Admins get one link to where the policy is edited.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, LogIn, LogOut, KeyRound, MoreHorizontal, RotateCcw, ShieldAlert, ShieldCheck, Repeat, Activity } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell, DEFAULT_PRESENCE, DND_PRESENCE, type PresenceStatus } from "@/components/layout/os/shell-context";
import { useBoot, useViewerRole } from "@/components/layout/os/boot-context";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SkeletonRows } from "@/components/ui/skeleton";
import { btn, Pending } from "@/components/account/account-ui";
import { useMe, type MeRecord } from "@/components/account/use-me";
import { useVerifyCooldown } from "@/components/account/use-verify-cooldown";
import { MfaEnrolDialog } from "@/components/account/mfa-enrol-dialog";
import { MfaDisableDialog } from "@/components/account/mfa-disable-dialog";
import { BackupCodesDialog } from "@/components/account/backup-codes-dialog";
import { ChangePasswordDialog } from "@/components/account/change-password-dialog";
import { SignOutEverywhereDialog } from "@/components/account/sign-out-everywhere-dialog";
import { passwordAgeOf } from "@/lib/auth/security-policy";
import { formatDate, formatDateTitle, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { PRESENCE_CHOICES, presenceChoiceOf, presenceClearAfterOptions, presenceExpiryFor, type PresenceChoice, type PresenceClearAfter } from "@/lib/account/presence-choices";
import { SECURITY_EVENT_LABEL } from "@/lib/account/security-events";

type SecEvent = { id: string; type: string; description: string; ipAddress: string | null; createdAt: string };

const EVENT_ICON: Record<string, typeof LogIn> = {
  login: LogIn,
  logout: LogOut,
  password_changed: KeyRound,
  password_reset: KeyRound,
  mfa_enabled: ShieldCheck,
  mfa_disabled: ShieldAlert,
  mfa_backup_codes_regenerated: ShieldCheck,
  signed_out_all_devices: RotateCcw,
  "org.switch.in": Repeat,
};

export default function AccountSecurityPage() {
  const me = useMe();
  return (
    <SettingsPage pageKey="account/security" subtitle={me.status === "ready" ? me.me.email : undefined}>
      {me.status === "loading" ? (
        <SettingsCardStack>
          <div className="w-full max-w-[560px] rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={4} /></div>
          <div className="w-full max-w-[560px] rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={1} /></div>
          <div className="w-full rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={5} /></div>
        </SettingsCardStack>
      ) : me.status === "error" ? (
        <OsEmptyView variant="error" title="Couldn't load your security settings" hint={me.error} action={{ label: "Try again", onClick: me.retry }} />
      ) : (
        <SecurityBody me={me.me} refresh={me.refresh} />
      )}
    </SettingsPage>
  );
}

function SecurityBody({ me, refresh }: { me: MeRecord; refresh: () => Promise<void> }) {
  const params = useSearchParams();
  const prefs = useDatePrefs();
  const { isOwner, isAdmin } = useViewerRole();
  const { boot } = useBoot();
  // settings-architecture 4.4: Owners, and Admins holding the security scope.
  // Until scoped admins exist (adminScopes empty) every Admin holds every
  // scope, which is the gate /settings/security itself applies today.
  const scopes = boot.viewer.adminScopes ?? [];
  const canOpenPolicy = isOwner || (isAdmin && (scopes.length === 0 || scopes.includes("security")));
  const verify = useVerifyCooldown(me.email);

  const [enrolOpen, setEnrolOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState<null | "read" | "new">(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The row's menu closes on a click anywhere else (and on Esc, below).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // ?enrol=mfa (the Security hold's and the login card's pointer) opens the
  // enrolment once.
  useEffect(() => {
    if (params?.get("enrol") === "mfa" && !me.mfaEnabled) {
      const t = window.setTimeout(() => setEnrolOpen(true), 0);
      return () => window.clearTimeout(t);
    }
  }, [params, me.mfaEnabled]);

  const age = passwordAgeOf(me.passwordChangedAt, me.policy.passwordMaxAgeDays);
  // An expired password opens the dialog once per session.
  useEffect(() => {
    if (age.kind !== "expired") return;
    try {
      if (window.sessionStorage.getItem("workwrk:password-expired-shown")) return;
      window.sessionStorage.setItem("workwrk:password-expired-shown", "1");
    } catch { /* storage unavailable: still open it */ }
    const t = window.setTimeout(() => setPasswordOpen(true), 0);
    return () => window.clearTimeout(t);
  }, [age.kind]);

  let passwordLine: React.ReactNode = "Not recorded yet";
  if (age.kind === "expired") passwordLine = <span className="text-danger-text">Expired</span>;
  else if (age.kind === "soon") passwordLine = <span className="text-warning-text">Expires in {age.daysLeft} day{age.daysLeft === 1 ? "" : "s"}</span>;
  else if (age.kind === "ok") passwordLine = <span title={formatDateTitle(age.changedAt, prefs)}>Last changed {formatRelative(age.changedAt, prefs)}</span>;

  const mfaLine = me.mfaEnabled
    ? me.policy.mfaRequired ? `On, using an authenticator app. Required by ${me.organization.name}` : "On, using an authenticator app"
    : me.policy.mfaRequired ? <span className="text-warning-text">Off. Required by {me.organization.name}</span> : "Off";
  const who = me.email;

  return (
    <>
      <SettingsCardStack>
        <div className="w-full max-w-[560px]">
          <SettingsCard title="How you log in" id="security.login">
            <div>
              <SettingsRow
                id="security.password"
                label="Password"
                helper={passwordLine}
                control={<button type="button" className={btn.secondary} onClick={() => setPasswordOpen(true)}>Change password</button>}
              />
              <SettingsRow
                id="security.mfa"
                label="Two step verification"
                helper={mfaLine}
                control={
                  me.mfaEnabled ? (
                    <div className="relative" ref={menuRef}>
                      <button
                        type="button"
                        className={btn.secondary}
                        aria-label="Two step verification options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((o) => !o)}
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </button>
                      {menuOpen ? (
                        <div role="menu" className="absolute end-0 top-9 z-20 w-56 rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop,0_8px_24px_rgba(0,0,0,0.12))]" onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}>
                          <MenuRow onClick={() => { setMenuOpen(false); setCodesOpen("read"); }}>Show backup codes</MenuRow>
                          <MenuRow onClick={() => { setMenuOpen(false); setCodesOpen("new"); }}>Get new backup codes</MenuRow>
                          {!me.policy.mfaRequired ? (
                            <MenuRow destructive onClick={() => { setMenuOpen(false); setDisableOpen(true); }}>Turn off</MenuRow>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <button type="button" className={btn.secondary} onClick={() => setEnrolOpen(true)}>Turn on</button>
                  )
                }
              />
              {me.mfaEnabled ? (
                <SettingsRow
                  id="security.backup"
                  label="Backup codes"
                  helper={`${me.backupCodesLeft} of 8 unused`}
                  control={<button type="button" className={btn.secondary} onClick={() => setCodesOpen("new")}>Get new codes</button>}
                />
              ) : null}
              <SettingsRow
                id="security.email"
                label="Email verified"
                helper={
                  me.emailVerifiedAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-4 w-4 text-success-text" strokeWidth={2} aria-hidden />
                      Verified on {formatDate(me.emailVerifiedAt, prefs, "date")}
                    </span>
                  ) : (
                    <span className="text-warning-text">Not verified</span>
                  )
                }
                control={
                  me.emailVerifiedAt ? undefined : (
                    <button type="button" className={btn.secondary} onClick={() => { void verify.send(); }} disabled={verify.disabled}>
                      {verify.busy ? <Pending label="Sending" /> : null}
                      {verify.sent ? "Sent" : "Send verification email"}
                    </button>
                  )
                }
              />
            </div>
          </SettingsCard>
          {canOpenPolicy ? (
            <p className="mt-2 text-sm text-ink-2">
              <Link href="/settings/security?tab=signin" className={btn.link}>Workspace sign-in policy</Link>
            </p>
          ) : null}
        </div>

        <SettingsCard title="Where you are logged in" id="security.sessions">
          <SettingsRow
            label="Log out everywhere"
            helper="Ends every session, on every device, including this one"
            control={<button type="button" className={btn.dangerGhost} onClick={() => setLogoutAllOpen(true)}>Log out everywhere</button>}
          />
        </SettingsCard>

        <ActivityCard />

        <PresenceCard />
      </SettingsCardStack>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} policy={me.policy.password} onChanged={() => { void refresh(); }} />
      <MfaEnrolDialog open={enrolOpen} onOpenChange={setEnrolOpen} who={who} onDone={() => { void refresh(); }} />
      <MfaDisableDialog open={disableOpen} onOpenChange={setDisableOpen} onDone={() => { void refresh(); }} />
      {codesOpen ? (
        <BackupCodesDialog
          open
          onOpenChange={(v) => { if (!v) setCodesOpen(null); }}
          left={me.backupCodesLeft}
          who={who}
          startInRegenerate={codesOpen === "new"}
          onDone={() => { void refresh(); }}
        />
      ) : null}
      <SignOutEverywhereDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen} />
    </>
  );
}

function MenuRow({ children, onClick, destructive }: { children: React.ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-9 w-full items-center rounded-md px-3 text-start text-base hover:bg-hover ${destructive ? "text-danger-text" : "text-ink"}`}
    >
      {children}
    </button>
  );
}

function ActivityCard() {
  const prefs = useDatePrefs();
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; events: SecEvent[] }>({ status: "loading", events: [] });
  const load = useCallback(async () => {
    setState({ status: "loading", events: [] });
    const r = await apiFetch<{ events?: SecEvent[] }>("/api/me/security-activity", { cache: "no-store" });
    setState(r.ok ? { status: "ready", events: r.data?.events ?? [] } : { status: "error", events: [] });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return (
    <SettingsCard title="Recent security activity" wide="security.activity" id="security.activity">
      {state.status === "loading" ? (
        <SkeletonRows rows={5} />
      ) : state.status === "error" ? (
        <p className="text-sm text-ink-2">
          Couldn&apos;t load your activity.{" "}
          <button type="button" className={btn.link} onClick={() => { void load(); }}>Try again</button>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-base">
            <thead>
              <tr className="h-11 text-sm text-ink-2">
                <th className="px-2 text-start font-medium">What</th>
                <th className="px-2 text-start font-medium">Where</th>
                <th className="px-2 text-start font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {state.events.length === 0 ? (
                <tr className="border-t border-line-soft">
                  <td colSpan={3} className="h-[var(--os-row-h,44px)] px-2 text-ink-2">Nothing yet · Events show up here when you log in or change your password</td>
                </tr>
              ) : (
                state.events.map((e) => {
                  const Icon = EVENT_ICON[e.type] ?? Activity;
                  return (
                    <tr key={e.id} className="h-[var(--os-row-h,44px)] border-t border-line-soft hover:bg-hover">
                      <td className="px-2">
                        <span className="inline-flex items-center gap-2 text-ink">
                          <Icon className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
                          {SECURITY_EVENT_LABEL[e.type] ?? e.description}
                        </span>
                      </td>
                      <td className="px-2 text-ink-2">{e.ipAddress || "Unknown"}</td>
                      <td className="px-2 text-ink-2" title={formatDateTitle(e.createdAt, prefs)}>{formatRelative(e.createdAt, prefs)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {state.events.length > 0 ? <p className="mt-2 text-sm text-ink-3">Showing the last {state.events.length} events</p> : null}
        </div>
      )}
    </SettingsCard>
  );
}

function PresenceCard() {
  const { presenceStatus, setPresenceStatus, openStatusModal } = useOsShell();
  const prefs = useDatePrefs();
  const choice = presenceChoiceOf(presenceStatus);
  // null until the person picks one here: the select then shows the stored
  // expiry ("Until ...") rather than a default that contradicts it.
  const [clearAfter, setClearAfter] = useState<PresenceClearAfter | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState<null | { c: PresenceChoice; after: PresenceClearAfter }>(null);
  const clearOptions = useMemo(() => presenceClearAfterOptions(), []);

  // Saved only once the server kept it; a refusal reverts the dot and offers
  // Retry on the row (the SAVE PATHS rule).
  const apply = async (c: PresenceChoice, after: PresenceClearAfter) => {
    if (c === "custom") { openStatusModal(); return; }
    const now = new Date();
    const base: PresenceStatus =
      c === "active" ? DEFAULT_PRESENCE : c === "dnd" ? DND_PRESENCE : { emoji: "\u{1F319}", label: "Away", expiresAt: null };
    const ok = await setPresenceStatus({ ...base, expiresAt: c === "active" ? null : presenceExpiryFor(after, now) });
    if (ok) { setSavedAt(Date.now()); setFailed(null); } else setFailed({ c, after });
  };
  const error = failed ? { message: "Couldn't save", onRetry: () => { void apply(failed.c, failed.after); } } : null;
  const selectCls = "h-9 rounded-md border border-line-strong bg-raised px-2 text-base text-ink";

  return (
    <SettingsCard title="Presence" id="security.presence" description="What teammates see on your avatar dot. The avatar menu changes the same status.">
      <div>
        <SettingsRow
          label="Show me as"
          helper={choice === "custom" ? `${presenceStatus.emoji ? `${presenceStatus.emoji} ` : ""}${presenceStatus.label}` : undefined}
          savedAt={savedAt}
          error={error}
          control={
            <select
              aria-label="Show me as"
              value={choice}
              onChange={(e) => { void apply(e.target.value as PresenceChoice, clearAfter ?? "never"); }}
              className={selectCls}
            >
              {PRESENCE_CHOICES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          }
        />
        {/* Clear after only means something for Away and Do not disturb here;
            a custom status carries its own expiry, set where it is written,
            and Active never expires. So no row that changes nothing. */}
        {choice === "away" || choice === "dnd" ? (
          <SettingsRow
            label="Clear after"
            helper={presenceStatus.expiresAt ? `Clears ${formatDate(presenceStatus.expiresAt, prefs, "datetime")}` : "Stays until you change it"}
            control={
              <select
                aria-label="Clear after"
                value={clearAfter ?? (presenceStatus.expiresAt ? "current" : "never")}
                onChange={(e) => {
                  if (e.target.value === "current") return;
                  const next = e.target.value as PresenceClearAfter;
                  setClearAfter(next);
                  void apply(choice, next);
                }}
                className={selectCls}
              >
                {clearAfter === null && presenceStatus.expiresAt ? <option value="current">Until {formatDate(presenceStatus.expiresAt, prefs, "datetime")}</option> : null}
                {clearOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            }
          />
        ) : choice === "custom" ? (
          <SettingsRow
            label="Clear after"
            helper={presenceStatus.expiresAt ? `Clears ${formatDate(presenceStatus.expiresAt, prefs, "datetime")}` : "Stays until you change it"}
            control={<button type="button" className={btn.secondary} onClick={openStatusModal}>Edit status</button>}
          />
        ) : null}
      </div>
    </SettingsCard>
  );
}
