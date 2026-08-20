"use client";

/* MFA enroll + disable dialogs — wired to the real /api/auth/mfa/enroll engine.
 *
 *  GET    /api/auth/mfa/enroll        → { secret, qr, otpauth }
 *  POST   /api/auth/mfa/enroll {secret, code} → { enabled, backupCodes, message }
 *  DELETE /api/auth/mfa/enroll?code=  → { disabled }
 *
 * Rendered via the shared Radix Dialog (portals to <body>, outside
 * `.workwrk-os`), so this file uses literal brand hex #0073EA / #E2445C and
 * Tailwind utilities rather than the scoped --os-* vars.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Copy, Check, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

const CODE_RE = /^\d{6}$/;

/* ---------- Enroll ---------- */

export function MfaEnrollDialog({
  open,
  onOpenChange,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEnrolled: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "scan" | "backup" | "error">("loading");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const begin = useCallback(async () => {
    setPhase("loading");
    setErr(null);
    setCode("");
    try {
      const res = await fetch("/api/auth/mfa/enroll");
      const body = await res.json().catch(() => ({}));
      const data = body?.data ?? body;
      if (!res.ok) {
        setErr(body?.error ?? data?.error ?? "Couldn't start enrollment.");
        setPhase("error");
        return;
      }
      setSecret(data.secret);
      setQr(data.qr);
      setPhase("scan");
    } catch {
      setErr("Network error. Try again.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (open) void begin();
  }, [open, begin]);

  async function verify() {
    if (!CODE_RE.test(code.trim())) {
      setErr("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/mfa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      const data = body?.data ?? body;
      if (!res.ok) {
        setErr(body?.error ?? data?.error ?? "Incorrect code. Try the next 30-second cycle.");
        return;
      }
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setPhase("backup");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function copyBackup() {
    void navigator.clipboard.writeText(backupCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function finish() {
    onOpenChange(false);
    onEnrolled();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="block max-w-[420px] gap-0 p-0">
        <div className="px-6 pt-6 pb-5">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <ShieldCheck className="h-4 w-4 text-[#0073EA]" />
            {phase === "backup" ? "Save your backup codes" : "Set up two-factor auth"}
          </DialogTitle>

          {phase === "loading" && (
            <div className="mt-6 flex items-center justify-center gap-2 py-8 text-[14px] text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing your secret…
            </div>
          )}

          {phase === "error" && (
            <div className="mt-4">
              <div className="flex items-start gap-2 rounded-lg border border-[#E2445C]/30 bg-[#E2445C]/10 px-3.5 py-3 text-[13.5px] leading-relaxed text-[#E2445C]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{err}</span>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-zinc-200 px-3.5 py-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  Close
                </button>
                <button type="button" onClick={() => void begin()} className="rounded-lg bg-[#0073EA] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#0060B9]">
                  Retry
                </button>
              </div>
            </div>
          )}

          {phase === "scan" && (
            <>
              <DialogDescription className="mt-1.5">
                Scan this QR code with Google Authenticator, 1Password, Authy, or any
                TOTP app — then enter the 6-digit code it shows.
              </DialogDescription>

              {qr && (
                <div className="mt-4 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="TOTP QR code" className="h-40 w-40 rounded-lg border border-zinc-200 bg-white p-1.5 dark:border-zinc-700" />
                </div>
              )}

              <div className="mt-3">
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Or enter this key manually</div>
                <code className="block break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] font-mono text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
                  {secret}
                </code>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Verification code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === "Enter") void verify(); }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[15px] tracking-[0.3em] tabular-nums text-zinc-800 outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>

              {err && (
                <div className="mt-3 flex items-start gap-2 text-[13px] text-[#E2445C]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-zinc-200 px-3.5 py-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  Cancel
                </button>
                <button type="button" onClick={() => void verify()} disabled={submitting || !CODE_RE.test(code)} className="inline-flex items-center gap-2 rounded-lg bg-[#0073EA] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#0060B9] disabled:cursor-not-allowed disabled:opacity-50">
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Verify & enable
                </button>
              </div>
            </>
          )}

          {phase === "backup" && (
            <>
              <DialogDescription className="mt-1.5">
                Two-factor auth is on. Store these one-time backup codes somewhere safe —
                each works once if you lose your authenticator, and they&rsquo;re shown only now.
              </DialogDescription>

              <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
                {backupCodes.map((c) => (
                  <code key={c} className="text-center text-[14px] font-mono tracking-wide text-zinc-700 dark:text-zinc-200">{c}</code>
                ))}
              </div>

              <div className="mt-4 flex justify-between gap-2">
                <button type="button" onClick={copyBackup} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 py-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy codes"}
                </button>
                <button type="button" onClick={finish} className="rounded-lg bg-[#0073EA] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0060B9]">
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Disable ---------- */

export function MfaDisableDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDisabled: () => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setCode(""); setErr(null); }
  }, [open]);

  async function disable() {
    const trimmed = code.trim();
    if (!trimmed) { setErr("Enter a code to confirm."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/auth/mfa/enroll?code=${encodeURIComponent(trimmed)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      const data = body?.data ?? body;
      if (!res.ok) {
        setErr(body?.error ?? data?.error ?? "Invalid code.");
        return;
      }
      onOpenChange(false);
      onDisabled();
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="block max-w-[400px] gap-0 p-0">
        <div className="px-6 pt-6 pb-5">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <AlertTriangle className="h-4 w-4 text-[#E2445C]" />
            Turn off two-factor auth
          </DialogTitle>
          <DialogDescription className="mt-1.5">
            Enter a current 6-digit code from your authenticator app (or one of your
            backup codes) to confirm.
          </DialogDescription>

          <div className="mt-4">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void disable(); }}
              autoComplete="one-time-code"
              placeholder="6-digit or backup code"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[14px] tracking-wide text-zinc-800 outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          {err && (
            <div className="mt-3 flex items-start gap-2 text-[13px] text-[#E2445C]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-zinc-200 px-3.5 py-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button type="button" onClick={() => void disable()} disabled={submitting || !code.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#E2445C] px-3.5 py-2 text-[14px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Turn off 2FA
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
