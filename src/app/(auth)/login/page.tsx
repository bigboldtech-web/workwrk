"use client";

// Sign-in screen. Lives inside the white 2-pane auth shell. Form
// only — nav + proof pane are owned by the layout.

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";

// Map an authorize() error to what the person should read. Our authorize
// throws curated, safe messages (lockout countdown, account/workspace status),
// so those pass through as-is; anything else collapses to a generic line that
// never reveals whether the email or the password was the wrong one.
function friendlyError(err: string): string {
  if (err.startsWith("Too many failed attempts")) return err;
  if (err.startsWith("This account") || err.startsWith("This workspace")) return err;
  if (err === "Invalid authentication code")
    return "That code didn't match. Enter the current 6-digit code from your authenticator app, or one of your backup codes.";
  if (err === "Missing credentials") return "Please enter your email and password.";
  return "Invalid email or password.";
}

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mfaRequired && !mfaCode.trim()) {
      setError("Enter the code from your authenticator app.");
      return;
    }
    setLoading(true);
    setError("");
    // IMPORTANT: only include mfaCode when we actually have one. Passing
    // `mfaCode: undefined` to signIn is NOT the same as omitting it —
    // next-auth serialises the options via URLSearchParams, which turns
    // undefined into the literal string "undefined", and the server would
    // then treat that as a (wrong) code instead of "no code yet".
    const result = await signIn("credentials", {
      email,
      password,
      ...(mfaRequired ? { mfaCode: mfaCode.trim() } : {}),
      redirect: false,
    });

    if (result?.error) {
      // Password was correct but this account has 2FA on — switch to the
      // code step instead of showing an error.
      if (result.error === "MFA_REQUIRED") {
        setMfaRequired(true);
        setError("");
        setLoading(false);
        return;
      }
      setError(friendlyError(result.error));
      setLoading(false);
      return;
    }
    router.push(callbackUrl);
  }

  function resetToStart() {
    setMfaRequired(false);
    setMfaCode("");
    setPassword("");
    setError("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {mfaRequired ? "Two-step verification" : "Welcome back"}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {mfaRequired
            ? "Enter the code from your authenticator app to finish signing in."
            : "Sign in to your WorkwrK workspace."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {!mfaRequired ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-slate-700">
                Work email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
                className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-medium text-slate-700">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-[#0073EA] hover:text-[#0056B0]">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
              />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <ShieldCheck size={14} className="text-emerald-600" />
              Signing in as <span className="font-medium text-slate-700">{email}</span>
            </div>
            <label htmlFor="mfaCode" className="text-xs font-medium text-slate-700">
              Authentication code
            </label>
            <input
              id="mfaCode"
              type="text"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123 456"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={9}
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-lg tracking-[0.3em] text-slate-900 placeholder:tracking-normal placeholder:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
            />
            <p className="text-xs text-slate-400 pt-0.5">
              Lost your device? Enter one of your backup codes instead.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.18)] active:translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> {mfaRequired ? "Verifying…" : "Signing in…"}
            </>
          ) : (
            <>
              {mfaRequired ? "Verify" : "Sign in"} <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>

      {mfaRequired ? (
        <button
          type="button"
          onClick={resetToStart}
          className="text-sm text-slate-500 hover:text-slate-700 mx-auto block"
        >
          Use a different account
        </button>
      ) : (
        <p className="text-sm text-slate-600 text-center">
          New to WorkwrK?{" "}
          <Link href="/register" className="text-[#0073EA] hover:text-[#0056B0] font-medium">
            Start your free trial
          </Link>
        </p>
      )}
    </div>
  );
}
