"use client";

// PasswordField (spec-account-auth section 3): the 36px input, the 28px eye
// toggle, and, when a policy is given, the live rule checklist read from
// src/lib/auth/password-rules.ts (the same rules the server enforces), with
// aria-live="polite" so a screen reader hears each rule being met. Used by
// /signup, /join and /reset-password; one component means the places a
// password is chosen can never disagree about the rules again (B8).

import { useId, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { passwordChecklist, type PasswordPolicyView } from "@/lib/auth/password-rules";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  policy,
  error,
  autoFocus,
  placeholder,
  labelAside,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: "current-password" | "new-password";
  /** When given, the live checklist renders under the field. */
  policy?: PasswordPolicyView | null;
  error?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  /** Something to the right of the label (the "Forgot your password?" link on /login). */
  labelAside?: React.ReactNode;
}) {
  const auto = useId();
  const inputId = id ?? `pw-${auto}`;
  const [shown, setShown] = useState(false);
  const rules = policy ? passwordChecklist(value, policy) : null;
  const describedBy = [error ? `${inputId}-err` : null, rules ? `${inputId}-rules` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="wa-field">
      <div className="wa-label-row">
        <label htmlFor={inputId} className="wa-label">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="wa-input-wrap">
        <input
          id={inputId}
          className="wa-input"
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          spellCheck={false}
          autoCapitalize="none"
        />
        <button type="button" className="wa-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {error ? (
        <p id={`${inputId}-err`} className="wa-field-error">
          {error}
        </p>
      ) : null}
      {rules ? (
        <ul id={`${inputId}-rules`} className="wa-checklist" aria-live="polite" aria-label="Password rules">
          {rules.map((r) => (
            <li key={r.key} className={r.met ? "is-met" : undefined}>
              <Check size={16} aria-hidden />
              <span>
                {r.label}
                <span className="sr-only">{r.met ? ", met" : ", not met yet"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
