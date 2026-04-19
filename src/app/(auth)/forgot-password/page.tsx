"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      <h1 className="auth-title">
        {sent ? <>Check your <span className="hi">inbox.</span></> : <>Reset <span className="hi">your password.</span></>}
      </h1>
      <p className="auth-sub">
        {sent
          ? "If an account with that email exists, we've sent a reset link. It's good for 30 minutes."
          : "Enter your email. We'll send a secure reset link that expires in 30 minutes."}
      </p>

      {sent ? (
        <div className="auth-form">
          <div
            style={{
              padding: "14px 16px",
              background: "rgba(212, 255, 46, 0.08)",
              border: "1px solid rgba(212, 255, 46, 0.3)",
              borderRadius: 12,
              fontSize: 13.5,
              color: "var(--b-lime)",
              lineHeight: 1.5,
            }}
          >
            ✓ Sent to <strong>{email}</strong>. Check your inbox — and spam folder, just in case.
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {error && <div className="auth-error">{error}</div>}
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              className="auth-input"
              placeholder="priya@company.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button
            type="submit"
            className="bento-btn bento-btn-lime auth-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="auth-spinner" aria-hidden />
                Sending…
              </>
            ) : (
              <>
                Send reset link <span className="arr">→</span>
              </>
            )}
          </button>
        </form>
      )}

      <div className="auth-foot">
        Remember it? <Link href="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
