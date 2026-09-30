"use client";

// Change password dialog (spec-account-auth), moved out of the route folder
// because the Security hold dialog opens it too. 560px: Current password,
// New password with THIS org's live rule checklist (the same policy object
// POST /api/me/change-password validates against, via /api/me), Confirm.
//
// Session proof (src/lib/session-proof.ts): the route bumps tokenVersion so
// every OTHER device is logged out, and returns a signed proof; this dialog
// hands it to session.update() so THIS session adopts the new version. It
// never copies a version in any other way.

import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";
import { passwordChecklist, passwordMeets, type PasswordPolicyView } from "@/lib/auth/password-rules";
import { useOsToast } from "@/components/layout/os/toast";
import { AccountDialog, btn, DialogBanner, FieldError, FieldLabel, Pending, TextInput } from "./account-ui";
import { cn } from "@/lib/utils";

function Secret({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <TextInput
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        invalid={invalid}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        className="pe-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute end-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
      >
        {shown ? <EyeOff className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
      </button>
    </div>
  );
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
  policy,
  onChanged,
  dismissable = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  policy: PasswordPolicyView;
  onChanged?: () => void;
  dismissable?: boolean;
}) {
  const { update: updateSession } = useSession();
  const { toast } = useOsToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentErr, setCurrentErr] = useState<string | null>(null);
  const [nextErr, setNextErr] = useState<string | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A password is never kept past the dialog (never written anywhere).
  const reset = () => {
    setCurrent(""); setNext(""); setConfirm("");
    setCurrentErr(null); setNextErr(null); setConfirmErr(null); setBanner(null); setBusy(false);
  };
  const filled = !!(current || next || confirm);
  const close = (v: boolean) => {
    if (!v && filled && !busy && !window.confirm("Discard what you typed?")) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const rules = passwordChecklist(next, policy);

  const submit = async () => {
    if (busy) return;
    setCurrentErr(null); setNextErr(null); setConfirmErr(null); setBanner(null);
    if (!current) { setCurrentErr("Enter your current password."); return; }
    if (!passwordMeets(next, policy)) { setNextErr("Your new password does not meet every rule yet."); return; }
    if (next !== confirm) { setConfirmErr("The two new passwords do not match."); return; }
    setBusy(true);
    const r = await apiFetch<{ tokenVersionProof?: string | null }>("/api/me/change-password", {
      method: "POST",
      json: { currentPassword: current, newPassword: next },
    });
    if (!r.ok) {
      setBusy(false);
      if (r.status === 400 && /current password/i.test(r.error)) setCurrentErr("That is not your current password.");
      else if (r.status === 400) setNextErr(r.error);
      else setBanner(r.error || "Couldn't change your password. Try again.");
      return;
    }
    const proof = typeof r.data?.tokenVersionProof === "string" ? r.data.tokenVersionProof : null;
    // Keep THIS session: adopt the bumped tokenVersion with the signed proof.
    if (proof) await updateSession({ tokenVersionProof: proof });
    reset();
    onOpenChange(false);
    toast("Password changed. Every other device is logged out.");
    onChanged?.();
  };

  return (
    <AccountDialog
      open={open}
      onOpenChange={close}
      dismissable={dismissable}
      title="Change password"
      width={560}
      footer={
        <>
          {dismissable ? <button type="button" className={btn.ghost} onClick={() => close(false)}>Cancel</button> : null}
          <button type="button" className={btn.primary} onClick={() => { void submit(); }} disabled={busy}>
            {busy ? <Pending label="Changing password" /> : null}
            Change password
          </button>
        </>
      }
    >
      <DialogBanner>{banner}</DialogBanner>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div>
          <FieldLabel htmlFor="cp-current">Current password</FieldLabel>
          <Secret id="cp-current" value={current} onChange={setCurrent} autoComplete="current-password" invalid={!!currentErr} autoFocus />
          <FieldError>{currentErr}</FieldError>
        </div>
        <div>
          <FieldLabel htmlFor="cp-new">New password</FieldLabel>
          <Secret id="cp-new" value={next} onChange={setNext} autoComplete="new-password" invalid={!!nextErr} />
          <ul className="mt-2 flex flex-col gap-1" aria-live="polite" aria-label="Password rules">
            {rules.map((r) => (
              <li key={r.key} className={cn("flex items-center gap-1.5 text-sm", r.met ? "text-success-text" : "text-ink-2")}>
                {/* A tick only once met; an open ring before, so an empty field never reads as passing. */}
                {r.met ? <Check className="h-4 w-4" strokeWidth={2} aria-hidden /> : <Circle className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />}
                {r.label}
                <span className="sr-only">{r.met ? ", met" : ", not met yet"}</span>
              </li>
            ))}
          </ul>
          <FieldError>{nextErr}</FieldError>
        </div>
        <div>
          <FieldLabel htmlFor="cp-confirm">Confirm new password</FieldLabel>
          <Secret id="cp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!confirmErr} />
          <FieldError>{confirmErr}</FieldError>
        </div>
        <p className="text-sm text-ink-2">You stay logged in here. Every other device is logged out.</p>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </AccountDialog>
  );
}
