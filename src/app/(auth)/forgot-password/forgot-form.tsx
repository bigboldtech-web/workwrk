"use client";

// /forgot-password (spec-account-auth `/forgot-password`). The server
// answers 200 whether or not the address has an account (anti-enumeration,
// per-email and per-IP limits, token hashed at rest, 60 minute life), so the
// success copy never asserts the account exists, and the number matches the
// token's real life.

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";

function ForgotInner() {
  const sp = useSearchParams();
  const prefill = sp.get("email") ?? "";
  const [email, setEmail] = useState(prefill);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prefill) primaryRef.current?.focus();
  }, [prefill]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send(): Promise<boolean> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return false;
    }
    setLoading(true);
    setError(null);
    setOffline(false);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setError("Too many requests. Try again in 15 minutes.");
        return false;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error || "Something went wrong. Try again.");
        return false;
      }
      return true;
    } catch {
      setOffline(true);
      return false;
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard drawing title="Check your inbox" footer={<p><Link href="/login" className="wa-link">Back to log in</Link></p>}>
        <p className="wa-text">If an account uses {email.trim()}, a reset link is on its way. It works for 60 minutes.</p>
        <p className="wa-help">
          Nothing after a minute? Check spam, or{" "}
          <button
            type="button"
            className="wa-link wa-link--sm"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            try another address
          </button>
          .
        </p>
        <p className="wa-help">
          <button
            type="button"
            className="wa-link wa-link--sm"
            disabled={cooldown > 0 || loading}
            onClick={async () => {
              if (await send()) setCooldown(60);
            }}
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}
          </button>
        </p>
        {error ? (
          <AuthBanner tone="danger">
            <p>{error}</p>
          </AuthBanner>
        ) : null}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will email you a link."
      footer={
        <p>
          Remember it?{" "}
          <Link href="/login" className="wa-link">
            Log in
          </Link>
        </p>
      }
    >
      <form
        className="wa-form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (loading) return;
          if (await send()) {
            setSent(true);
            setCooldown(60);
          }
        }}
      >
        {offline ? (
          <AuthBanner tone="danger">
            <p>Can&apos;t reach WorkwrK. Check your connection, then try again.</p>
          </AuthBanner>
        ) : error ? (
          <AuthBanner tone="danger">
            <p>{error}</p>
          </AuthBanner>
        ) : null}
        <div className="wa-field">
          <label htmlFor="email" className="wa-label">
            Work email
          </label>
          <input id="email" className="wa-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus={!prefill} />
        </div>
        <button ref={primaryRef} type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined}>
          {loading ? <Dots variant="pending" label="Sending" /> : null}
          Send reset link
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotForm() {
  return (
    <Suspense>
      <ForgotInner />
    </Suspense>
  );
}
