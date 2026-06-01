"use client";

/* Account · Security — personal posture + org policy.
 *
 *  GET /api/me
 *  GET /api/auth/mfa/status
 *  GET /api/settings
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, Key, Mail, Hash, CheckCircle2, AlertTriangle, Clock, Building,
  Smartphone, Activity, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type ApiMe = { user?: { id: string; firstName?: string; lastName?: string; email?: string; accessLevel?: string } };
type SecurityPolicy = { minPasswordLength?: number; requireUppercase?: boolean; requireNumbers?: boolean; sessionTimeout?: number; twoFactorEnabled?: boolean };

export default function AccountSecurityPage() {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [mfa, setMfa] = useState<{ mfaEnabled: boolean; emailVerified: boolean } | null>(null);
  const [orgSec, setOrgSec] = useState<SecurityPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useOsToast();

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
  }, []);
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
            <CheckRow ok={!!mfa?.emailVerified} title="Email verified" desc={me?.user?.email ?? "—"} action={!mfa?.emailVerified && "Resend"} onAction={() => toast("Verification email sent")} Icon={Mail} />
            <CheckRow ok={!!mfa?.mfaEnabled} title="Two-factor auth (TOTP)" desc={mfa?.mfaEnabled ? "Active — backup codes available" : "Not enabled"} action={!mfa?.mfaEnabled ? "Enable" : "Manage"} onAction={() => toast(mfa?.mfaEnabled ? "Open MFA management" : "Open TOTP enrollment")} Icon={Smartphone} />
            <CheckRow ok={true} title="Active sessions" desc="2 active sessions" action="Manage" onAction={() => toast("Open session list")} Icon={Clock} />
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
      </div>
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
