"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-card">
        <Link href="/" className="auth-brand" aria-label="WorkwrK home">
          <span className="auth-brand-dot" />
          workwrk
        </Link>
        <h1 className="auth-title">
          Reset link <span className="hi">invalid.</span>
        </h1>
        <p className="auth-sub">
          This reset link is missing or expired. Request a fresh one and we&apos;ll
          send you a new email.
        </p>
        <div className="auth-form">
          <Link href="/forgot-password" className="bento-btn bento-btn-lime auth-submit">
            Request new link <span className="arr">→</span>
          </Link>
        </div>
        <div className="auth-foot">
          Back to <Link href="/login">sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      <h1 className="auth-title">
        {success ? <>Password <span className="hi">reset.</span></> : <>Set a <span className="hi">new password.</span></>}
      </h1>
      <p className="auth-sub">
        {success
          ? "Redirecting you to sign in…"
          : "Eight characters or more. Mix letters, numbers, and at least one symbol."}
      </p>

      {!success && (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className="auth-input"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              className="auth-input"
              placeholder="Same thing again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <button type="submit" className="bento-btn bento-btn-lime auth-submit" disabled={loading}>
            {loading ? (
              <>
                <span className="auth-spinner" aria-hidden />
                Resetting…
              </>
            ) : (
              <>
                Reset password <span className="arr">→</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
