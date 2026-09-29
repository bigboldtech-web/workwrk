"use client";

/* Account · Security: personal posture + org policy.
 *
 *  GET /api/me
 *  GET /api/auth/mfa/status
 *  GET /api/settings
 */

import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  ShieldCheck,
  Key,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Building,
  Smartphone,
  Activity,
  ChevronRight,
  KeyRound,
  LogIn,
  LogOut,
  Clock,
  RotateCcw,
  MonitorSmartphone,
  ShieldAlert,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { SETTINGS_PAGES } from "@/lib/settings-registry";

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
  password_reset: { Icon: KeyRound, label: "Password reset from an emailed link", warn: true },
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
      toast("Signed out of all devices. Sign back in to continue.");
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
      toast("Verification email sent. Check your inbox.");
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

  return (
    <>
      <OsPageHeader title={SETTINGS_PAGES["account/security"].label} />

      <div className="acs">
        {loadError && <div className="acs__error">{loadError}</div>}


        <section className="acs__section">
          <header><h2><Key /> Your posture</h2></header>
          <div className="acs__list">
            <CheckRow ok={!!mfa?.emailVerified} title="Email verified" desc={me?.user?.email ?? "No email on file"} action={!mfa?.emailVerified && "Resend"} onAction={() => void resendVerification()} Icon={Mail} />
            <CheckRow ok={!!mfa?.mfaEnabled} title="Two-factor auth (TOTP)" desc={mfa?.mfaEnabled ? "Active, backup codes issued" : "Not enabled"} action={mfa ? (mfa.mfaEnabled ? "Turn off" : "Enable") : null} onAction={() => (mfa?.mfaEnabled ? setDisableOpen(true) : setEnrollOpen(true))} Icon={Smartphone} />
            <CheckRow ok={true} title="Password" desc="Change your account password" action="Change" onAction={() => setChangePwOpen(true)} Icon={KeyRound} />
            <CheckRow ok={true} title="Access level" desc={me?.user?.accessLevel ?? "EMPLOYEE"} Icon={Building} />
          </div>
        </section>

        <section className="acs__section">
          <header><h2><Activity /> Password rules</h2></header>
          <div className="acs__policy">
            <PolicyRow label="Minimum password length" value={`${orgSec?.minPasswordLength ?? 8} characters`} />
            <PolicyRow label="Requires uppercase" value={orgSec?.requireUppercase ? "Yes" : "No"} />
            <PolicyRow label="Requires numbers" value={orgSec?.requireNumbers ? "Yes" : "No"} />
            {/* Session timeout and "MFA required org-wide" are gone: nothing
                read or enforced either value (the real idle window and the
                two-step gate live in the sign-in code), so showing them as
                policy was untrue. The Workspace Security page brings the
                real sign-in policy with S5. */}
          </div>
        </section>

        <section className="acs__section">
          <header><h2><MonitorSmartphone /> Sessions</h2></header>
          <div className="acs__sessions">
            <div className="acs__sessions-copy">
              Signed in on this device. If you&apos;ve used a shared or lost device,
              sign out everywhere. It ends every session, including this one.
            </div>
            <button type="button" className="acs__danger-btn" onClick={() => void signOutEverywhere()} disabled={signingOutAll}>
              {signingOutAll ? <Dots variant="pending" /> : <LogOut />}
              Sign out of all devices
            </button>
          </div>
        </section>

        <section className="acs__section">
          <header><h2><Clock /> Recent security activity</h2></header>
          {events === null ? (
            <SkeletonLines lines={3} />
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
                      <div className="acs__act-sub">{e.ipAddress ? `IP ${e.ipAddress}` : "IP not recorded"}</div>
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
        onChanged={(tokenVersionProof) => {
          // Re-sync this session's token (it survives; other devices are out).
          // The proof is what lets THIS token take the new version.
          void updateSession({ tokenVersionProof });
          toast("Password updated. Other devices signed out.");
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
