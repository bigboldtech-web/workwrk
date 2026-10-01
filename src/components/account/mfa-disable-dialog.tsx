"use client";

// MFA turn off dialog (spec-account-auth): 400px, one field that takes a
// 6 digit code or a backup code (spaces and hyphens stripped, the same rule
// as the enrol dialog), the code in the request BODY. A 403 means the org
// started requiring it since the page loaded: the dialog closes and the row
// refreshes into its "Required by {Org}" state.

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { normaliseMfaCode } from "@/lib/auth/login-messages";
import { useOsToast } from "@/components/layout/os/toast";
import { AccountDialog, btn, DialogBanner, FieldError, FieldLabel, Pending, TextInput } from "./account-ui";

export function MfaDisableDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useOsToast();

  const reset = () => { setCode(""); setErr(null); setBanner(null); setBusy(false); };
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const submit = async () => {
    if (busy) return;
    const c = normaliseMfaCode(code);
    if (!/^\d{6}$/.test(c) && !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) {
      setErr("Enter a 6 digit code or one of your backup codes.");
      return;
    }
    setBusy(true);
    setErr(null);
    setBanner(null);
    const r = await apiFetch("/api/auth/mfa/enroll", { method: "DELETE", json: { code: c } });
    setBusy(false);
    if (r.ok) {
      toast("Two step verification is off");
      close(false);
      onDone();
      return;
    }
    if (r.status === 400) setErr("That code is not right.");
    else if (r.status === 403) {
      toast(r.error || "Your workspace requires two step verification");
      close(false);
      onDone();
    } else setBanner(r.error || "Couldn't turn it off. Try again.");
  };

  return (
    <AccountDialog
      open={open}
      onOpenChange={close}
      title="Turn off two step verification"
      width={400}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={() => close(false)}>Cancel</button>
          <button type="button" className={btn.danger} onClick={() => { void submit(); }} disabled={busy}>
            {busy ? <Pending label="Turning off" /> : null}
            Turn off
          </button>
        </>
      }
    >
      <p className="text-sm text-warning-text">Your account will be protected by your password alone.</p>
      <DialogBanner>{banner}</DialogBanner>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FieldLabel htmlFor="mfa-off-code">6 digit code or backup code</FieldLabel>
        <TextInput
          id="mfa-off-code"
          autoComplete="one-time-code"
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          invalid={!!err}
          autoFocus
          className="tracking-[0.2em]"
        />
        <p className="mt-1.5 text-sm text-ink-2">From your authenticator app, or one of your backup codes.</p>
        <FieldError>{err}</FieldError>
      </form>
    </AccountDialog>
  );
}
