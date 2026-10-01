"use client";

// /reset-password?token= (spec-account-auth `/reset-password`). The token's
// validity and the account's workspace policy are read BEFORE anyone types
// (GET /api/auth/password-policy?token=), so an invalid or spent link gets
// its own screen and the checklist shows the real rules. Setting the
// password logs the person out everywhere else (the server bumps
// tokenVersion); the success screen has a manual way on from its first
// frame, and a 4 second automatic one.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { PasswordField } from "@/components/auth/password-field";
import { parsePolicyView, passwordMeets, policyView, type PasswordPolicyView } from "@/lib/auth/password-rules";

type Phase = "checking" | "invalid" | "form" | "done";

function ResetInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token");
  const [phase, setPhase] = useState<Phase>(token ? "checking" : "invalid");
  const [email, setEmail] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PasswordPolicyView>(policyView());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`/api/auth/password-policy?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { kind?: string; valid?: boolean; email?: string; policy?: unknown } | null) => {
        if (!alive) return;
        if (!d) {
          // The check itself failed (offline, server error): let the person
          // try; the POST is the real judge of the token.
          setPhase("form");
          return;
        }
        if (d.kind !== "reset" || d.valid === false) {
          setPhase("invalid");
          return;
        }
        if (d.policy) setPolicy(parsePolicyView(d.policy));
        if (d.email) setEmail(d.email);
        setPhase("form");
      })
      .catch(() => {
        if (alive) setPhase("form");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => router.push("/login?reset=1"), 4000);
    return () => clearTimeout(t);
  }, [phase, router]);

  async function submit() {
    if (loading) return;
    setBanner(null);
    let bad = false;
    if (!passwordMeets(password, policy)) {
      setPwError("Meet every rule below.");
      bad = true;
    }
    if (confirm !== password) {
      setConfirmError("These do not match.");
      bad = true;
    }
    if (bad) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string; field?: string };
      if (res.ok) {
        setPhase("done");
        return;
      }
      if (d.code === "invalid_token") setPhase("invalid");
      else if (d.field === "password") setPwError(d.error ?? "Choose a stronger password.");
      else setBanner(d.error || "Something went wrong. Try again.");
    } catch {
      setBanner("Can't reach WorkwrK. Check your connection, then try again.");
    } finally {
      setLoading(false);
    }
  }

  const back = (
    <p>
      <Link href="/login" className="wa-link">
        Back to log in
      </Link>
    </p>
  );

  if (phase === "checking") {
    return (
      <div className="wa-card" aria-busy="true" aria-label="Checking your link">
        <div className="wa-skel" style={{ width: "55%", height: 22 }} />
        <div className="wa-skel wa-skel--tall" />
        <div className="wa-skel wa-skel--tall" />
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthCard drawing title="This reset link is not valid any more" subtitle="Links work for 60 minutes and only once." footer={back}>
        <Link href="/forgot-password" className="wa-btn wa-btn--primary wa-btn--block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  if (phase === "done") {
    return (
      <AuthCard
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Check size={20} aria-hidden style={{ color: "var(--os-success-text)" }} />
            Password changed
          </span>
        }
        // The reset bumps tokenVersion; other devices notice at their next
        // re-check (REVALIDATE_MS in src/lib/auth.ts), so promise the window.
        subtitle="Your other devices are logged out within 5 minutes."
      >
        <Link href="/login?reset=1" className="wa-btn wa-btn--primary wa-btn--block">
          Log in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle={email ? `For ${email}` : undefined} footer={back}>
      <form
        className="wa-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {banner ? (
          <AuthBanner tone="danger">
            <p>{banner}</p>
          </AuthBanner>
        ) : null}
        <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setPwError(null); }} autoComplete="new-password" policy={policy} error={pwError} autoFocus />
        <PasswordField label="Confirm password" value={confirm} onChange={(v) => { setConfirm(v); setConfirmError(null); }} autoComplete="new-password" error={confirmError} />
        <p className="wa-help">Setting a new password logs you out everywhere else.</p>
        <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined}>
          {loading ? <Dots variant="pending" label="Setting your password" /> : null}
          Set password
        </button>
      </form>
    </AuthCard>
  );
}

export function ResetForm() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
