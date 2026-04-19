"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="auth-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      <h1 className="auth-title">
        Welcome <span className="hi">back.</span>
      </h1>
      <p className="auth-sub">
        Sign in to continue running your business on the spine.
      </p>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <div className="auth-field-head">
            <label className="auth-label" htmlFor="email">Work email</label>
          </div>
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

        <div className="auth-field">
          <div className="auth-field-head">
            <label className="auth-label" htmlFor="password">Password</label>
            <Link href="/forgot-password" className="auth-forgot">
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            className="auth-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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
              Signing in…
            </>
          ) : (
            <>
              Sign in <span className="arr">→</span>
            </>
          )}
        </button>

        <div className="auth-divider">or continue with</div>

        <div className="auth-sso">
          <button
            type="button"
            className="auth-sso-btn"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </form>

      <div className="auth-foot">
        New here? <Link href="/register">Start your free trial →</Link>
      </div>

      <p className="auth-legal">
        By signing in you agree to our{" "}
        <Link href="/terms">terms</Link> and{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </div>
  );
}
