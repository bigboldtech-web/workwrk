"use client";

// Backup codes dialog (spec-account-auth): read mode shows how many of the
// eight are unused (the codes themselves are hashed and cannot be shown
// again); regenerate mode takes a fresh authenticator code, then shows the
// new eight once, with the "I have saved these" checkbox before Done.
// Getting new codes cancels the old ones in the same write.

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { normaliseMfaCode } from "@/lib/auth/login-messages";
import { useOsToast } from "@/components/layout/os/toast";
import { AccountDialog, btn, DialogBanner, FieldError, FieldLabel, Pending, TextInput } from "./account-ui";
import { BackupCodesGrid } from "./backup-codes-grid";

type Mode = "read" | "prove" | "codes";

export function BackupCodesDialog({
  open,
  onOpenChange,
  left,
  who,
  startInRegenerate = false,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  left: number;
  who: string;
  startInRegenerate?: boolean;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>(startInRegenerate ? "prove" : "read");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const { toast } = useOsToast();

  const reset = () => {
    setMode(startInRegenerate ? "prove" : "read");
    setCode(""); setErr(null); setBanner(null); setBusy(false); setCodes([]); setSaved(false);
  };
  const close = (v: boolean) => {
    if (!v && mode === "codes" && !saved && !window.confirm("Save your backup codes first. Close anyway?")) return;
    if (!v) {
      if (mode === "codes") onDone();
      reset();
    }
    onOpenChange(v);
  };

  const regenerate = async () => {
    if (busy) return;
    const c = normaliseMfaCode(code);
    if (!/^\d{6}$/.test(c)) {
      setErr("Enter the 6 digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setErr(null);
    setBanner(null);
    const r = await apiFetch<{ backupCodes?: string[] }>("/api/auth/mfa/backup-codes", { method: "POST", json: { code: c } });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 400) setErr(r.error || "That code is not right.");
      else setBanner(r.error || "Couldn't get new codes. Try again.");
      return;
    }
    setCodes(r.data?.backupCodes ?? []);
    setMode("codes");
  };

  let footer: React.ReactNode = null;
  if (mode === "read") {
    footer = (
      <>
        <button type="button" className={btn.ghost} onClick={() => close(false)}>Close</button>
        <button type="button" className={btn.primary} onClick={() => setMode("prove")}>Get new codes</button>
      </>
    );
  } else if (mode === "prove") {
    footer = (
      <>
        <button type="button" className={btn.ghost} onClick={() => close(false)}>Cancel</button>
        <button type="button" className={btn.primary} disabled={busy} onClick={() => { void regenerate(); }}>
          {busy ? <Pending label="Getting new codes" /> : null}
          Get new codes
        </button>
      </>
    );
  } else {
    footer = (
      <button
        type="button"
        className={btn.primary}
        disabled={!saved}
        onClick={() => { toast("New backup codes saved"); onDone(); reset(); onOpenChange(false); }}
      >
        Done
      </button>
    );
  }

  return (
    <AccountDialog open={open} onOpenChange={close} title="Backup codes" width={560} footer={footer}>
      {mode === "read" ? (
        <>
          <p className="text-base text-ink">{left} of 8 codes unused</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line p-4 font-mono text-base" aria-label="Backup codes, hidden">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className={i < left ? "tracking-wider text-ink" : "tracking-wider text-ink-3 line-through"}>
                {"•".repeat(8)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-2">Codes are stored scrambled, so they cannot be shown again. Getting new codes cancels your old ones.</p>
        </>
      ) : null}
      {mode === "prove" ? (
        <form onSubmit={(e) => { e.preventDefault(); void regenerate(); }}>
          <DialogBanner>{banner}</DialogBanner>
          <FieldLabel htmlFor="backup-prove-code">6 digit code</FieldLabel>
          <TextInput
            id="backup-prove-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            invalid={!!err}
            autoFocus
            className="max-w-[200px] tracking-[0.2em]"
          />
          <p className="mt-1.5 text-sm text-ink-2">From your authenticator app. Getting new codes cancels your old ones.</p>
          <FieldError>{err}</FieldError>
        </form>
      ) : null}
      {mode === "codes" ? <BackupCodesGrid codes={codes} who={who} saved={saved} onSavedChange={setSaved} /> : null}
    </AccountDialog>
  );
}
