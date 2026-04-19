"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck, ShieldOff, Copy, Check, AlertTriangle, KeyRound, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";

type Status = { mfaEnabled: boolean; emailVerified: boolean };

type EnrollData = { secret: string; qr: string; otpauth: string };

export default function AccountSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const [enroll, setEnroll] = useState<EnrollData | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/status", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setStatus({ mfaEnabled: !!j.mfaEnabled, emailVerified: !!j.emailVerified });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function startEnrollment() {
    setEnrollError(null);
    const res = await fetch("/api/auth/mfa/enroll", { cache: "no-store" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setEnrollError(j.error || "Could not start enrollment.");
      return;
    }
    const data = (await res.json()) as EnrollData;
    setEnroll(data);
    setEnrollCode("");
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    const code = enrollCode.trim().replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      setEnrollError("Enter the 6-digit code from your authenticator.");
      return;
    }
    setEnrolling(true);
    setEnrollError(null);
    try {
      const res = await fetch("/api/auth/mfa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: enroll.secret, code }),
      });
      const j = await res.json();
      if (!res.ok) {
        setEnrollError(j.error || "Could not confirm code.");
        return;
      }
      setBackupCodes(j.backupCodes ?? []);
      setEnroll(null);
      setEnrollCode("");
      await loadStatus();
    } finally {
      setEnrolling(false);
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    const code = disableCode.trim().replace(/\s/g, "");
    if (!code) {
      setDisableError("Enter a current 6-digit code or a backup code.");
      return;
    }
    setDisabling(true);
    setDisableError(null);
    try {
      const res = await fetch(`/api/auth/mfa/enroll?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisableError(j.error || "Could not disable MFA.");
        return;
      }
      setDisableCode("");
      await loadStatus();
    } finally {
      setDisabling(false);
    }
  }

  function copy(text: string, marker: string) {
    navigator.clipboard.writeText(text);
    setCopied(marker);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Account · security"
        title="Security"
        subtitle="Two-factor authentication and sign-in protection for your own account."
      />

      {backupCodes && backupCodes.length > 0 && (
        <div className="sec-reveal">
          <div className="sec-reveal-head">
            <AlertTriangle size={16} />
            <span>Save your backup codes — shown only once</span>
          </div>
          <p className="sec-reveal-body">
            Each of these codes works in place of a 6-digit code exactly one time. Store them in
            your password manager. You can regenerate them by disabling and re-enabling MFA.
          </p>
          <div className="sec-codes">
            {backupCodes.map((c) => (
              <code key={c} className="sec-code">{c}</code>
            ))}
          </div>
          <div className="sec-reveal-actions">
            <button
              type="button"
              className="sec-btn-ghost"
              onClick={() => copy(backupCodes.join("\n"), "backup")}
            >
              {copied === "backup" ? <Check size={12} /> : <Copy size={12} />}
              {copied === "backup" ? "Copied" : "Copy all"}
            </button>
            <button
              type="button"
              className="sec-btn-ghost"
              onClick={() => setBackupCodes(null)}
            >
              I've saved them
            </button>
          </div>
        </div>
      )}

      <section className="sec-card">
        <div className="sec-card-head">
          <div className="sec-card-title">
            {status?.mfaEnabled ? (
              <ShieldCheck size={16} style={{ color: "#d4ff2e" }} />
            ) : (
              <ShieldOff size={16} style={{ color: "#a0a0a0" }} />
            )}
            <span>Two-factor authentication</span>
          </div>
          <span className={`sec-chip${status?.mfaEnabled ? " is-on" : ""}`}>
            {loading ? "…" : status?.mfaEnabled ? "Enabled" : "Not enabled"}
          </span>
        </div>
        <p className="sec-card-sub">
          Adds a time-based code requirement on top of your password. Works with any TOTP
          app — Google Authenticator, 1Password, Authy, Bitwarden, Raycast.
        </p>

        {!loading && !status?.mfaEnabled && !enroll && (
          <button type="button" className="sec-cta" onClick={startEnrollment}>
            <KeyRound size={14} /> Turn on 2FA
          </button>
        )}

        {enroll && (
          <div className="sec-enroll">
            <ol className="sec-steps">
              <li>
                <strong>Scan this QR</strong> with your authenticator app, or paste the secret
                manually.
              </li>
              <li>
                <strong>Enter the 6-digit code</strong> it shows back to confirm.
              </li>
            </ol>

            <div className="sec-qr-row">
              {enroll.qr ? (
                <Image
                  src={enroll.qr}
                  alt="TOTP QR code"
                  width={180}
                  height={180}
                  unoptimized
                  className="sec-qr"
                />
              ) : null}
              <div className="sec-secret-block">
                <label className="sec-label">Manual entry secret</label>
                <div className="sec-secret-row">
                  <code className="sec-secret">{enroll.secret}</code>
                  <button
                    type="button"
                    className="sec-btn-ghost"
                    onClick={() => copy(enroll.secret, "secret")}
                  >
                    {copied === "secret" ? <Check size={12} /> : <Copy size={12} />}
                    {copied === "secret" ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="sec-hint">
                  Any TOTP app works. Scan the QR if you can — it's faster and less error-prone.
                </p>
              </div>
            </div>

            <form onSubmit={confirmEnrollment} className="sec-inline-form">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="6-digit code"
                className="sec-input-code"
                value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <button type="submit" className="sec-cta" disabled={enrolling}>
                {enrolling ? "Confirming…" : "Confirm and enable"}
              </button>
              <button
                type="button"
                className="sec-btn-ghost"
                onClick={() => {
                  setEnroll(null);
                  setEnrollCode("");
                  setEnrollError(null);
                }}
              >
                Cancel
              </button>
            </form>
            {enrollError && <p className="sec-error">{enrollError}</p>}
          </div>
        )}

        {!loading && status?.mfaEnabled && !backupCodes && (
          <form onSubmit={disableMfa} className="sec-inline-form sec-danger">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Current 6-digit code or backup code"
              className="sec-input-code sec-input-wide"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              required
            />
            <button type="submit" className="sec-cta sec-cta-danger" disabled={disabling}>
              <RefreshCw size={14} /> {disabling ? "Disabling…" : "Disable 2FA"}
            </button>
            {disableError && <p className="sec-error">{disableError}</p>}
          </form>
        )}
      </section>

      <section className="sec-card">
        <div className="sec-card-head">
          <div className="sec-card-title">
            <ShieldCheck size={16} style={{ color: "#4a9eff" }} />
            <span>Email verification</span>
          </div>
          <span className={`sec-chip${status?.emailVerified ? " is-on" : ""}`}>
            {loading ? "…" : status?.emailVerified ? "Verified" : "Not verified"}
          </span>
        </div>
        <p className="sec-card-sub">
          A verified email is required for password reset flows. If yours is still unverified, open
          the link we emailed you on signup, or request a new one.
        </p>
        {!loading && !status?.emailVerified && (
          <button
            type="button"
            className="sec-btn-ghost"
            onClick={async () => {
              await fetch("/api/auth/request-verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              }).catch(() => {});
              alert("We sent a fresh verification link to your email.");
            }}
          >
            Resend verification email
          </button>
        )}
      </section>

      <style>{`
        .sec-card {
          background: #0a0a0a;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .sec-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .sec-card-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 600;
          color: #fafafa;
          letter-spacing: -0.01em;
        }
        .sec-card-sub {
          font-size: 13px;
          color: #a0a0a0;
          line-height: 1.55;
          margin: 0;
          max-width: 620px;
        }
        .sec-chip {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 100px;
          color: #a0a0a0;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .sec-chip.is-on {
          color: #d4ff2e;
          background: rgba(212,255,46,0.08);
          border-color: rgba(212,255,46,0.3);
        }
        .sec-cta {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: #d4ff2e;
          color: #0a0a0a;
          border: 0;
          border-radius: 100px;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .sec-cta:disabled { opacity: 0.55; cursor: not-allowed; }
        .sec-cta-danger {
          background: #ff3d8a;
          color: #fafafa;
        }
        .sec-btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 100px;
          color: #a0a0a0;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
        }
        .sec-btn-ghost:hover { color: #fafafa; border-color: rgba(255,255,255,0.2); }
        .sec-enroll {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 18px;
          background: #141414;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
        }
        .sec-steps {
          margin: 0;
          padding-left: 18px;
          color: #a0a0a0;
          font-size: 13px;
          line-height: 1.6;
        }
        .sec-steps strong { color: #fafafa; }
        .sec-qr-row {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .sec-qr {
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          background: #fff;
          padding: 6px;
        }
        .sec-secret-block { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 6px; }
        .sec-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #707070;
        }
        .sec-secret-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .sec-secret {
          flex: 1;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          color: #d4ff2e;
          padding: 8px 12px;
          background: #1a1a1a;
          border: 1px solid rgba(212,255,46,0.2);
          border-radius: 8px;
          word-break: break-all;
        }
        .sec-hint { font-size: 11px; color: #707070; margin: 4px 0 0; }
        .sec-inline-form {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .sec-danger { margin-top: 4px; }
        .sec-input-code {
          padding: 9px 12px;
          background: #1a1a1a;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          color: #fafafa;
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          letter-spacing: 0.1em;
          width: 140px;
        }
        .sec-input-wide { width: 260px; }
        .sec-input-code:focus {
          outline: none;
          border-color: #d4ff2e;
          box-shadow: 0 0 0 3px rgba(212,255,46,0.12);
        }
        .sec-error {
          width: 100%;
          color: #ff3d8a;
          font-size: 12px;
          margin: 4px 0 0;
        }
        .sec-reveal {
          background: rgba(212,255,46,0.06);
          border: 1px solid rgba(212,255,46,0.35);
          border-radius: 16px;
          padding: 20px;
        }
        .sec-reveal-head {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #d4ff2e;
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 6px;
        }
        .sec-reveal-body {
          font-size: 13px;
          color: #a0a0a0;
          line-height: 1.5;
          margin: 0 0 12px;
        }
        .sec-codes {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }
        .sec-code {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12.5px;
          padding: 8px 10px;
          background: #0a0a0a;
          border: 1px solid rgba(212,255,46,0.25);
          border-radius: 8px;
          color: #d4ff2e;
          text-align: center;
          letter-spacing: 0.06em;
        }
        .sec-reveal-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
