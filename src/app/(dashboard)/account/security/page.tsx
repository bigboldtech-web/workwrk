"use client";

// My settings > Security (spec-account-auth `/account/security`).
//
//   How you log in       Password (age from User.passwordChangedAt), Two step
//                        verification (Turn on, or a menu with Show backup
//                        codes / Get new backup codes / Turn off, and no Turn
//                        off at all when the org requires it for this role),
//                        Backup codes (count only), Email verified
//   Where you are logged in   Log out everywhere (a confirm, this device too;
//                        where this WorkwrK offers AI apps, the hint and the
//                        confirm add "and disconnects your AI apps",
//                        docs/plans/mcp-server.md 11.2, read from the
//                        connected-apps route's 200, never naming them where
//                        they are hidden)
//   Recent security activity  the last 20 events, plain words, no row action
//   Presence             Show me as + Clear after, writing User.presenceStatus
//                        and presenceUntil through the shell (the avatar menu
//                        writes the same two columns)
//
// Gone, on purpose: the invented "security score" (a number nothing measured),
// the "Access level" row shown as a passed check, and the read-only "Org
// policy" card whose session timeout and org-wide two step values nothing
// enforced. The live rules print inside the Change password dialog, and
// Owners and Admins get one link to where the policy is edited: the How you
// log in card's action (settings-cleanup B12), never a caption between cards.
//
// The two step verification menu (Show backup codes, Get new backup codes,
// Turn off) is a popover layer, so Esc closes it alone; closing it hands
// focus back to its button, so the dialog a choice opens returns focus there
// too; and below 640px, where the row stacks and puts its button at the left,
// it opens from the button's left edge, never off the screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, LogIn, LogOut, KeyRound, MoreHorizontal, RotateCcw, ShieldAlert, ShieldCheck, Repeat, Activity } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useLayer, useOsShell, DEFAULT_PRESENCE, DND_PRESENCE, type PresenceStatus } from "@/components/layout/os/shell-context";
import { useBoot, useViewerRole } from "@/components/layout/os/boot-context";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack, useHashPulse } from "@/components/settings/settings-card";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { PickerSelect } from "@/components/settings/picker-select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { btn, Pending } from "@/components/account/account-ui";
import { useMe, type MeRecord } from "@/components/account/use-me";
import { useVerifyCooldown } from "@/components/account/use-verify-cooldown";
import { MfaEnrolDialog } from "@/components/account/mfa-enrol-dialog";
import { MfaDisableDialog } from "@/components/account/mfa-disable-dialog";
import { BackupCodesDialog } from "@/components/account/backup-codes-dialog";
import { ChangePasswordDialog } from "@/components/account/change-password-dialog";
import { SignOutEverywhereDialog } from "@/components/account/sign-out-everywhere-dialog";
import { useAiAppsOffered } from "@/components/account/connected-apps-card";
import { MCP_LOGOUT_COPY } from "@/lib/mcp/mcp-copy";
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
          <SettingsCard><SkeletonRows rows={4} /></SettingsCard>
          <SettingsCard><SkeletonRows rows={1} /></SettingsCard>
          <SettingsCard><SkeletonRows rows={5} /></SettingsCard>
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
  // Log out everywhere also disconnects the person's AI apps; said only where they are offered.
  const appsOffered = useAiAppsOffered();

  const [enrolOpen, setEnrolOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState<null | "read" | "new">(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Closing the menu from inside it (a choice, Esc) puts focus back on its
  // button, so the dialog a choice opens finds it there and returns it there.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButton.current?.focus({ preventScroll: true });
  }, []);
  // A popover layer: the shell's Esc closes it alone, never the page.
  useLayer(menuOpen, { kind: "popover", close: closeMenu });
  // The row's menu closes on a click anywhere else (and on Esc, above).
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
    ? me.policy.mfaRequired ? `On, using an authenticator app. Required by ${me.policy.mfaOrgName ?? me.organization.name}` : "On, using an authenticator app"
    : me.policy.mfaRequired ? <span className="text-warning-text">Off. Required by {me.policy.mfaOrgName ?? me.organization.name}</span> : "Off";
  const who = me.email;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard
          title="How you log in"
          id="security.login"
          actions={canOpenPolicy ? <Link href="/settings/security?tab=signin" className={btn.link}>Workspace sign-in policy</Link> : null}
        >
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
                      ref={menuButton}
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
                      <div role="menu" aria-label="Two step verification options" className="absolute end-0 top-9 z-20 w-56 rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop,0_8px_24px_rgba(0,0,0,0.12))] max-[640px]:end-auto max-[640px]:start-0">
                        <MenuRow onClick={() => { closeMenu(); setCodesOpen("read"); }}>Show backup codes</MenuRow>
                        <MenuRow onClick={() => { closeMenu(); setCodesOpen("new"); }}>Get new backup codes</MenuRow>
                        {!me.policy.mfaRequired ? (
                          <MenuRow destructive onClick={() => { closeMenu(); setDisableOpen(true); }}>Turn off</MenuRow>
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

        <SettingsCard title="Where you are logged in" id="security.sessions">
          <SettingsRow
            label="Log out everywhere"
            helper={`Ends every session, on every device, including this one${appsOffered ? `, ${MCP_LOGOUT_COPY.alsoDisconnects}` : ""}`}
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
      <SignOutEverywhereDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen} disconnectsApps={appsOffered} />
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

  const pulse = useHashPulse("security.activity");
  const columns: TableColumn<SecEvent>[] = [
    {
      key: "what",
      label: "What",
      width: "minmax(140px,1fr)",
      cellClassName: "py-2",
      render: (e) => {
        const Icon = EVENT_ICON[e.type] ?? Activity;
        return (
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <Icon className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            {SECURITY_EVENT_LABEL[e.type] ?? e.description}
          </span>
        );
      },
    },
    { key: "where", label: "Where", width: "minmax(100px,180px)", cellClassName: "py-2 text-ink-2 [overflow-wrap:anywhere]", render: (e) => e.ipAddress || "Unknown" },
    {
      key: "when",
      label: "When",
      width: "minmax(96px,140px)",
      cellClassName: "py-2 whitespace-nowrap text-ink-2",
      render: (e) => <span title={formatDateTitle(e.createdAt, prefs)}>{formatRelative(e.createdAt, prefs)}</span>,
    },
  ];

  // A titled TableCard like every other settings table (final Settings
  // review, M4: it was a hand-built table inside a card). It keeps the card's
  // anchor and its landing (useHashPulse). The three tracks fit a 390
  // phone's card, so When is never out of sight; a long address wraps in its
  // own cell and the row grows to hold it.
  return (
    <TableCard<SecEvent>
      id="security.activity"
      className={pulse ? "border-brand" : undefined}
      title="Recent security activity"
      columns={columns}
      rows={state.status === "loading" ? null : state.status === "error" ? [] : state.events}
      rowsGrow
      skeletonRows={5}
      rowKey={(e) => e.id}
      empty={
        state.status === "error" ? (
          <span>
            Couldn&apos;t load your activity ·{" "}
            <button type="button" className="text-brand-deep hover:underline" onClick={() => { void load(); }}>Try again</button>
          </span>
        ) : (
          "Nothing yet · Events show up here when you log in or change your password"
        )
      }
      footer={
        state.status === "ready" && state.events.length > 0
          ? { total: state.events.length, noun: "events", from: 1, to: state.events.length, hideTotal: true, hidePaging: true, leading: <span className="text-ink-2">Showing the last {state.events.length} events</span> }
          : undefined
      }
    />
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

  return (
    <SettingsCard title="Presence" id="security.presence" description="What teammates see on your avatar dot. The avatar menu changes the same status.">
      <div>
        <SettingsRow
          label="Show me as"
          helper={choice === "custom" ? `${presenceStatus.emoji ? `${presenceStatus.emoji} ` : ""}${presenceStatus.label}` : undefined}
          savedAt={savedAt}
          error={error}
          control={
            <PickerSelect
              label="Show me as"
              value={choice}
              options={PRESENCE_CHOICES.map((p) => ({ value: p.value, label: p.label }))}
              onChange={(v) => { void apply(v as PresenceChoice, clearAfter ?? "never"); }}
            />
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
              <PickerSelect
                label="Clear after"
                value={clearAfter ?? (presenceStatus.expiresAt ? "current" : "never")}
                options={[
                  ...(clearAfter === null && presenceStatus.expiresAt ? [{ value: "current", label: `Until ${formatDate(presenceStatus.expiresAt, prefs, "datetime")}` }] : []),
                  ...clearOptions.map((o) => ({ value: o.value, label: o.label })),
                ]}
                onChange={(v) => {
                  if (v === "current") return;
                  const next = v as PresenceClearAfter;
                  setClearAfter(next);
                  void apply(choice, next);
                }}
              />
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
