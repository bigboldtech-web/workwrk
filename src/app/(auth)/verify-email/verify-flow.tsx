"use client";

// /verify-email (spec-account-auth `/verify-email`): exactly one state at a
// time, the message rendered once.
//   ?token=      verifying, then verified, already verified, expired, or
//                not valid (made up, replaced by a newer link, or used and
//                since spent). "Not valid" never claims the link expired:
//                the person most likely to see it already confirmed, so it
//                leads with Log in and keeps Send a new link beside it.
//   ?resend=1    "Send a verification email": one field, the anti-enumeration
//                answer, where /login's "Send a new link" lands
// "Send a new link" posts POST /api/auth/request-verify: with { email }
// signed out (the unauthenticated branch), empty signed in (the session's
// own address). It never points at the password reset page (B11).

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";

type Phase = "verifying" | "verified" | "already" | "expired" | "invalid" | "ask" | "offline";

function lastEmail(): string {
  try {
    return window.sessionStorage.getItem("workwrk:last-email") ?? "";
  } catch {
    return "";
  }
}

function VerifyInner() {
  const sp = useSearchParams();
  const token = sp.get("token");
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [phase, setPhase] = useState<Phase>(token ? "verifying" : "ask");
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      setEmail((e) => e || lastEmail());
      return;
    }
    let alive = true;
    fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; alreadyVerified?: boolean; email?: string; code?: string };
        if (!alive) return;
        if (d.email) {
          setConfirmed(d.email);
          setEmail(d.email);
        }
        if (r.ok && d.alreadyVerified) setPhase("already");
        else if (r.ok) setPhase("verified");
        else if (d.code === "expired") setPhase("expired");
        else setPhase("invalid");
      })
      .catch(() => {
        if (alive) setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  async function sendLink() {
    if (sending) return;
    const needsEmail = !signedIn || phase === "ask";
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    setSending(true);
    try {
      await fetch("/api/auth/request-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsEmail || email.trim() ? { email: email.trim() } : {}),
      });
      setSent(true);
    } catch {
      setFieldError("Can't reach WorkwrK. Check your connection, then try again.");
    } finally {
      setSending(false);
    }
  }

  const back = (
    <p>
      <Link href="/login" className="wa-link">
        Back to log in
      </Link>
    </p>
  );
  const onward = signedIn ? (
    <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary wa-btn--block">
      Continue to WorkwrK
    </a>
  ) : (
    <Link href="/login?verified=1" className="wa-btn wa-btn--primary wa-btn--block">
      Log in
    </Link>
  );

  if (phase === "verifying") {
    return (
      <div className="wa-card" role="status" aria-live="polite" style={{ alignItems: "center", flexDirection: "row", gap: 8, color: "var(--os-ink-2)" }}>
        <Dots variant="pending" label="Checking your link" />
        <span>Checking your link</span>
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <AuthCard title="Confirm your email" footer={back}>
        <AuthBanner tone="danger">
          <p>
            Can&apos;t reach WorkwrK. Check your connection.{" "}
            <button type="button" className="wa-link" onClick={() => { setPhase("verifying"); setAttempt((n) => n + 1); }}>
              Try again
            </button>
          </p>
        </AuthBanner>
      </AuthCard>
    );
  }
  if (phase === "verified") {
    return (
      <AuthCard drawing title="Email verified" subtitle={confirmed ? `${confirmed} is confirmed.` : "Your address is confirmed."}>
        {onward}
      </AuthCard>
    );
  }
  if (phase === "already") {
    return (
      <AuthCard drawing title="Already verified" subtitle="Nothing more to do.">
        {onward}
      </AuthCard>
    );
  }

  const sentLine = sent ? (
    <AuthBanner tone="success">
      <p>Sent. Check your inbox.</p>
    </AuthBanner>
  ) : null;
  const button = (
    <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={sending || undefined}>
      {sending ? <Dots variant="pending" label="Sending" /> : null}
      Send a new link
    </button>
  );

  if (phase === "invalid") {
    // The route cannot tell a made-up token from one that is spent, and
    // request-verify answers ok without sending for a confirmed address, so
    // the sent line says exactly that instead of a bare "Sent".
    const askForEmail = !signedIn;
    return (
      <AuthCard drawing title="This link is not valid or was already used" subtitle={signedIn ? "If you already confirmed your email, carry on. If not, send yourself a new link." : "If you already confirmed your email, log in. If not, send yourself a new link."}>
        {signedIn ? (
          <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary wa-btn--block">
            Continue to WorkwrK
          </a>
        ) : (
          <Link href="/login" className="wa-btn wa-btn--primary wa-btn--block">
            Log in
          </Link>
        )}
        <form className="wa-form" noValidate onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
          {askForEmail ? (
            <div className="wa-field">
              <label htmlFor="email" className="wa-label">
                Work email
              </label>
              <input id="email" className="wa-input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} placeholder="you@company.com" autoComplete="email" aria-invalid={fieldError ? true : undefined} />
            </div>
          ) : null}
          {fieldError ? <p className="wa-field-error">{fieldError}</p> : null}
          {sent ? (
            <AuthBanner tone="success">
              <p>If that address still needs confirming, a new link is on its way. Already confirmed? Just log in.</p>
            </AuthBanner>
          ) : (
            <button type="submit" className="wa-btn wa-btn--secondary wa-btn--block" data-pending={sending || undefined}>
              {sending ? <Dots variant="pending" label="Sending" /> : null}
              Send a new link
            </button>
          )}
        </form>
      </AuthCard>
    );
  }

  if (phase === "expired") {
    const askForEmail = !signedIn && !confirmed;
    return (
      <AuthCard drawing title="This link has expired" subtitle="Verification links work for 24 hours." footer={back}>
        <form className="wa-form" noValidate onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
          {askForEmail ? (
            <div className="wa-field">
              <label htmlFor="email" className="wa-label">
                Work email
              </label>
              <input id="email" className="wa-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={fieldError ? true : undefined} />
            </div>
          ) : null}
          {fieldError ? <p className="wa-field-error">{fieldError}</p> : null}
          {sentLine ?? button}
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Send a verification email" subtitle="We will send a new link to your address." footer={back}>
      <form className="wa-form" noValidate onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
        <div className="wa-field">
          <label htmlFor="email" className="wa-label">
            Work email
          </label>
          <input id="email" className="wa-input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} placeholder="you@company.com" autoComplete="email" autoFocus aria-invalid={fieldError ? true : undefined} />
          {fieldError ? <p className="wa-field-error">{fieldError}</p> : null}
        </div>
        {sentLine ?? button}
      </form>
    </AuthCard>
  );
}

export function VerifyFlow() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
