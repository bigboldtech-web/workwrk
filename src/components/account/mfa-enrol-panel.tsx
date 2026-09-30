"use client";

// The two step verification set-up body, in three phases (spec-account-auth
// "MFA enrolment dialog"): Scan, Backup codes, Couldn't set up. ONE body for
// the three places a person turns it on: the dialog on /account/security,
// the Security hold dialog, and `/login` step 2b. Only the transport differs:
//
//   source "session"  GET then POST /api/auth/mfa/enroll (signed in)
//   source "ticket"   POST /api/auth/mfa/enrol-at-login with the ticket the
//                     login outcome carried (no session exists yet)
//
// The secret is held in memory only until the code proves it; nothing is
// stored before that. The codes are shown once, and `onPhase` tells the
// caller when they are on screen so its Esc can confirm first.

import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { normaliseMfaCode } from "@/lib/auth/login-messages";
import { BackupCodesGrid } from "./backup-codes-grid";
import { btn, FieldError, FieldLabel, Pending, TextInput } from "./account-ui";

export type EnrolSource = { kind: "session" } | { kind: "ticket"; ticket: string };
export type EnrolPhase = "scan" | "codes" | "failed";

export function MfaEnrolPanel({
  source,
  who,
  finishLabel = "Done",
  onFinished,
  onPhase,
  onCancel,
  onEnabled,
}: {
  source: EnrolSource;
  who: string;
  finishLabel?: string;
  /** Called when the person ticks "saved" and presses the finish button. */
  onFinished: (ctx: { lastCode: string }) => void;
  onPhase?: (p: EnrolPhase) => void;
  onCancel?: () => void;
  /** Called the moment the server has turned it on (before the codes are acknowledged). */
  onEnabled?: () => void;
}) {
  const [phase, setPhase] = useState<EnrolPhase>("scan");
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [lastCode, setLastCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const go = useCallback((p: EnrolPhase) => { setPhase(p); onPhase?.(p); }, [onPhase]);

  const start = useCallback(async () => {
    setSecret(null);
    setQr(null);
    setCode("");
    setCodeError(null);
    const r = source.kind === "session"
      ? await apiFetch<{ secret?: string; qr?: string }>("/api/auth/mfa/enroll", { cache: "no-store" })
      : await apiFetch<{ secret?: string; qr?: string }>("/api/auth/mfa/enrol-at-login", { method: "POST", json: { ticket: source.ticket }, allowWhenExpired: true });
    if (!r.ok || !r.data?.secret || !r.data.qr) {
      setFailReason(r.ok ? "We could not start the set-up." : r.error);
      go("failed");
      return;
    }
    setSecret(r.data.secret);
    setQr(r.data.qr);
    go("scan");
  }, [source, go]);

  useEffect(() => {
    const t = window.setTimeout(() => { void start(); }, 0);
    return () => window.clearTimeout(t);
    // Start once per mount; "Try again" calls start() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOn = async () => {
    if (!secret || busy) return;
    const c = normaliseMfaCode(code);
    if (!/^\d{6}$/.test(c)) {
      setCodeError("Enter the 6 digit code from your app.");
      return;
    }
    setBusy(true);
    setCodeError(null);
    const r = source.kind === "session"
      ? await apiFetch<{ backupCodes?: string[] }>("/api/auth/mfa/enroll", { method: "POST", json: { secret, code: c } })
      : await apiFetch<{ backupCodes?: string[] }>("/api/auth/mfa/enrol-at-login", { method: "POST", json: { ticket: source.ticket, secret, code: c }, allowWhenExpired: true });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 400) setCodeError("That code is not right. Codes change every 30 seconds.");
      else { setFailReason(r.error); go("failed"); }
      return;
    }
    setLastCode(c);
    setCodes(r.data?.backupCodes ?? []);
    onEnabled?.();
    go("codes");
  };

  const copyKey = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 1500);
    } catch {
      setCopiedKey(false);
    }
  };

  if (phase === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-danger-text" role="alert">{failReason || "We could not set up two step verification."}</p>
        <div className="flex justify-end gap-2">
          {onCancel ? <button type="button" className={btn.ghost} onClick={onCancel}>Cancel</button> : null}
          <button type="button" className={btn.primary} onClick={() => { void start(); }}>Try again</button>
        </div>
      </div>
    );
  }

  if (phase === "codes") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink">Two step verification is on. Save these backup codes: they are shown once.</p>
        <BackupCodesGrid codes={codes} who={who} saved={saved} onSavedChange={setSaved} />
        <div className="flex justify-end">
          <button type="button" className={btn.primary} disabled={!saved} onClick={() => onFinished({ lastCode })}>
            {finishLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); void turnOn(); }}
    >
      <div className="flex flex-wrap items-start gap-4">
        {qr ? (
          // A data: URL from the server's QR encoder; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code for your authenticator app" width={160} height={160} className="h-40 w-40 shrink-0 rounded-md border border-line bg-white p-1" />
        ) : (
          <div className="h-40 w-40 shrink-0 rounded-md bg-skeleton os-skeleton-pulse" aria-label="Preparing the QR code" />
        )}
        <div className="min-w-[200px] flex-1">
          <p className="text-base text-ink">Scan this with Google Authenticator, 1Password, Authy or any authenticator app.</p>
          <p className="mt-3 text-sm text-ink-2">Can&apos;t scan? Enter this key</p>
          <div className="mt-1 flex items-center gap-1">
            <code className="break-all font-mono text-sm text-ink">{secret ?? "..."}</code>
            <button type="button" onClick={() => { void copyKey(); }} disabled={!secret} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink" aria-label="Copy key">
              <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
              {copiedKey ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="mfa-enrol-code">6 digit code</FieldLabel>
        <TextInput
          id="mfa-enrol-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          invalid={!!codeError}
          className="max-w-[200px] tracking-[0.2em]"
          autoFocus
        />
        <FieldError>{codeError}</FieldError>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? <button type="button" className={btn.ghost} onClick={onCancel}>Cancel</button> : null}
        <button type="submit" className={btn.primary} disabled={!secret || busy}>
          {busy ? <Pending label="Turning on" /> : null}
          Turn on
        </button>
      </div>
    </form>
  );
}
