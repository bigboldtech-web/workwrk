"use client";

/* Account · Security — personal posture + org policy.
 *
 *  GET /api/me
 *  GET /api/auth/mfa/status
 *  GET /api/settings
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  ShieldCheck, Key, Mail, Hash, CheckCircle2, AlertTriangle, Building,
  Smartphone, Activity, ChevronRight, KeyRound, LogIn, LogOut, Clock,
  RotateCcw, MonitorSmartphone, ShieldAlert, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { MfaEnrollDialog, MfaDisableDialog } from "./mfa-modal";
import { ChangePasswordDialog } from "./change-password-modal";

type SecEvent = {
  id: string;
  type: string;
  description: string;
  ipAddress: string | null;
  severity: string;
  createdAt: string;
};

// Icon + label per security event type.
const EVENT_META: Record<string, { Icon: typeof Key; label: string; warn?: boolean }> = {
  login: { Icon: LogIn, label: "Signed in" },
  logout: { Icon: LogOut, label: "Signed out" },
  password_changed: { Icon: KeyRound, label: "Password changed", warn: true },
  mfa_enabled: { Icon: ShieldCheck, label: "Two-factor enabled", warn: true },
  mfa_disabled: { Icon: ShieldAlert, label: "Two-factor disabled", warn: true },
  signed_out_all_devices: { Icon: RotateCcw, label: "Signed out of all devices", warn: true },
};

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type ApiMe = { user?: { id: string; firstName?: string; lastName?: string; email?: string; accessLevel?: string } };
type SecurityPolicy = { minPasswordLength?: number; requireUppercase?: boolean; requireNumbers?: boolean; sessionTimeout?: number; twoFactorEnabled?: boolean };

export default function AccountSecurityPage() {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [mfa, setMfa] = useState<{ mfaEnabled: boolean; emailVerified: boolean } | null>(null);
  const [orgSec, setOrgSec] = useState<SecurityPolicy | null>(null);
  const [events, setEvents] = useState<SecEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const { toast } = useOsToast();
  const { update: updateSession } = useSession();

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/me/security-activity");
      if (res.ok) setEvents((await res.json()).events ?? []);
    } catch { /* activity is best-effort context */ }
  }, []);

  async function signOutEverywhere() {
    setSigningOutAll(true);
    try {
      const res = await fetch("/api/me/sign-out-everywhere", { method: "POST" });
      if (!res.ok) throw new Error();
      toast("Signed out of all devices — sign back in to continue");
      // This session is revoked too; clear it locally and return to login.
      await signOut({ callbackUrl: "/login" });
    } catch {
      toast("Couldn't sign out other devices. Try again.");
      setSigningOutAll(false);
    }
  }

  async function resendVerification() {
    try {
      await fetch("/api/auth/request-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      toast("Verification email sent — check your inbox");
    } catch {
      toast("Couldn't send verification email");
    }
  }

  const load = useCallback(async () => {
    try {
      const [meRes, mfaRes, setRes] = await Promise.all([
        fetch("/api/me"),
        fetch("/api/auth/mfa/status"),
        fetch("/api/settings"),
      ]);
      if (!meRes.ok) throw new Error(`me ${meRes.status}`);
      setMe(await meRes.json());
      if (mfaRes.ok) {
        const m = await mfaRes.json();
        const p = m.data ?? { mfaEnabled: m.mfaEnabled ?? false, emailVerified: m.emailVerified ?? false };
        setMfa({ mfaEnabled: !!p.mfaEnabled, emailVerified: !!p.emailVerified });
      }
      if (setRes.ok) {
        const s = await setRes.json();
        setOrgSec(s.settings?.security ?? null);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
    void loadActivity();
  }, [loadActivity]);
  useEffect(() => { void load(); }, [load]);

  const score = (() => {
    if (!mfa) return 0;
    let s = 50;
    if (mfa.emailVerified) s += 25;
    if (mfa.mfaEnabled) s += 25;
    return s;
  })();
  const scoreLabel = score >= 90 ? "Strong" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Weak";
  const scoreHue = score >= 90 ? "var(--os-c-green)" : score >= 70 ? "var(--os-c-teal)" : score >= 50 ? "var(--os-c-orange)" : "var(--os-c-red)";

  return (
    <>
      <OsTitleBar
        title="Account · Security"
        Icon={ShieldCheck}
        iconGradient={GRAD.greenTeal}
        description={me === null ? "Loading…" : `${me.user?.email ?? "you"} · MFA ${mfa?.mfaEnabled ? "on" : "off"} · email ${mfa?.emailVerified ? "verified" : "unverified"}`}
        actions={
          <div className="acs__head-actions">
            <Link href="/settings" className="acs__nav-link"><Hash /> Settings</Link>
          </div>
        }
      />

      <div className="acs">
        {loadError && <div className="acs__error">{loadError}</div>}

        <section className="acs__score" style={{ ["--score-c" as unknown as string]: scoreHue }}>
          <div className="acs__score-l">
            <span className="acs__score-tag"><ShieldCheck /> Security score</span>
            <h2>{scoreLabel}</h2>
            <p>{score >= 90 ? "Excellent posture. Keep MFA enabled and rotate passwords yearly." : score >= 70 ? "Good posture. Add MFA to reach Strong." : "Address the recommendations below to improve your score."}</p>
          </div>
          <div className="acs__score-r">
            <strong>{score}</strong>
            <span>of 100</span>
          </div>
        </section>

        <section className="acs__section">
          <header><h2><Key /> Your posture</h2></header>
          <div className="acs__list">
            <CheckRow ok={!!mfa?.emailVerified} title="Email verified" desc={me?.user?.email ?? "—"} action={!mfa?.emailVerified && "Resend"} onAction={() => void resendVerification()} Icon={Mail} />
            <CheckRow ok={!!mfa?.mfaEnabled} title="Two-factor auth (TOTP)" desc={mfa?.mfaEnabled ? "Active — backup codes issued" : "Not enabled"} action={mfa ? (mfa.mfaEnabled ? "Turn off" : "Enable") : null} onAction={() => (mfa?.mfaEnabled ? setDisableOpen(true) : setEnrollOpen(true))} Icon={Smartphone} />
            <CheckRow ok={true} title="Password" desc="Change your account password" action="Change" onAction={() => setChangePwOpen(true)} Icon={KeyRound} />
            <CheckRow ok={true} title="Access level" desc={me?.user?.accessLevel ?? "EMPLOYEE"} Icon={Building} />
          </div>
        </section>

        <section className="acs__section">
          <header><h2><Activity /> Org policy</h2></header>
          <div className="acs__policy">
            <PolicyRow label="Minimum password length" value={`${orgSec?.minPasswordLength ?? 8} characters`} />
            <PolicyRow label="Requires uppercase" value={orgSec?.requireUppercase ? "Yes" : "No"} />
            <PolicyRow label="Requires numbers" value={orgSec?.requireNumbers ? "Yes" : "No"} />
            <PolicyRow label="Session timeout" value={`${orgSec?.sessionTimeout ?? 30} minutes`} />
            <PolicyRow label="MFA required org-wide" value={orgSec?.twoFactorEnabled ? "Yes" : "Optional"} highlight={orgSec?.twoFactorEnabled} />
          </div>
        </section>

        <section className="acs__section">
          <header><h2><MonitorSmartphone /> Sessions</h2></header>
          <div className="acs__sessions">
            <div className="acs__sessions-copy">
              Signed in on this device. If you&apos;ve used a shared or lost device,
              sign out everywhere — it ends every session, including this one.
            </div>
            <button type="button" className="acs__danger-btn" onClick={() => void signOutEverywhere()} disabled={signingOutAll}>
              {signingOutAll ? <Loader2 className="animate-spin" /> : <LogOut />}
              Sign out of all devices
            </button>
          </div>
        </section>

        <section className="acs__section">
          <header><h2><Clock /> Recent security activity</h2></header>
          {events === null ? (
            <div className="acs__act-empty">Loading…</div>
          ) : events.length === 0 ? (
            <div className="acs__act-empty">No recent activity yet.</div>
          ) : (
            <div className="acs__act">
              {events.map((e) => {
                const meta = EVENT_META[e.type] ?? { Icon: Activity, label: e.description };
                const Icon = meta.Icon;
                return (
                  <div key={e.id} className="acs__act-row">
                    <span className={`acs__act-icon${meta.warn ? " is-warn" : ""}`}><Icon /></span>
                    <div className="acs__act-main">
                      <div className="acs__act-desc">{meta.label}</div>
                      <div className="acs__act-sub">{e.ipAddress ? `IP ${e.ipAddress}` : "—"}</div>
                    </div>
                    <span className="acs__act-time">{relativeTime(e.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <MfaEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        onEnrolled={() => { toast("Two-factor auth enabled"); void load(); }}
      />
      <MfaDisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => { toast("Two-factor auth disabled"); void load(); }}
      />
      <ChangePasswordDialog
        open={changePwOpen}
        onOpenChange={setChangePwOpen}
        onChanged={() => {
          // Re-sync this session's token (it survives; other devices are out).
          void updateSession();
          toast("Password updated — other devices signed out");
          void loadActivity();
        }}
      />
    </>
  );
}

function CheckRow({ ok, title, desc, action, onAction, Icon }: { ok: boolean; title: string; desc: string; action?: string | false | null; onAction?: () => void; Icon: typeof Key }) {
  return (
    <div className={`acs__row${ok ? " is-ok" : " is-todo"}`}>
      <span className="acs__row-status">
        {ok ? <CheckCircle2 /> : <AlertTriangle />}
      </span>
      <span className="acs__row-icon"><Icon /></span>
      <div className="acs__row-main">
        <div className="acs__row-title">{title}</div>
        <div className="acs__row-desc">{desc}</div>
      </div>
      {action && (
        <button type="button" className="acs__row-btn" onClick={onAction}>{action} <ChevronRight /></button>
      )}
    </div>
  );
}

function PolicyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="acs__policy-row">
      <span className="acs__policy-label">{label}</span>
      <span className={`acs__policy-value${highlight ? " is-on" : ""}`}>{value}</span>
    </div>
  );
}
