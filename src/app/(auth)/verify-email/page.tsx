"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "ok" | "already" | "error">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMsg("This link is missing its token. Request a new verification email.");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState("error");
          setMsg(data.error);
        } else if (data.alreadyVerified) {
          setState("already");
        } else {
          setState("ok");
        }
      })
      .catch(() => {
        setState("error");
        setMsg("Couldn't reach the server. Try again in a moment.");
      });
  }, [token]);

  return (
    <div className="auth-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      {state === "loading" && (
        <>
          <h1 className="auth-title">Verifying…</h1>
          <p className="auth-sub">Give us a second — checking your token.</p>
          <div className="auth-form">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="auth-spinner" aria-hidden />
              <span style={{ color: "#a0a0a0", fontSize: 13 }}>Talking to the server</span>
            </div>
          </div>
        </>
      )}

      {state === "ok" && (
        <>
          <h1 className="auth-title">
            Email <span className="hi">verified.</span>
          </h1>
          <p className="auth-sub">
            You're in. Jump straight to your workspace or sign in if you haven't already.
          </p>
          <div className="auth-form">
            <Link href="/dashboard" className="bento-btn bento-btn-lime auth-submit">
              Open dashboard <span className="arr">→</span>
            </Link>
          </div>
          <div className="auth-foot">
            Not signed in? <Link href="/login">Log in</Link>
          </div>
        </>
      )}

      {state === "already" && (
        <>
          <h1 className="auth-title">
            Already <span className="hi">verified.</span>
          </h1>
          <p className="auth-sub">This email has been confirmed previously. No action needed.</p>
          <div className="auth-form">
            <Link href="/dashboard" className="bento-btn bento-btn-lime auth-submit">
              Open dashboard <span className="arr">→</span>
            </Link>
          </div>
        </>
      )}

      {state === "error" && (
        <>
          <h1 className="auth-title">
            Link <span className="hi">expired or invalid.</span>
          </h1>
          <p className="auth-sub">{msg}</p>
          <div className="auth-form">
            <Link href="/login" className="bento-btn bento-btn-lime auth-submit">
              Back to sign in <span className="arr">→</span>
            </Link>
          </div>
          <div className="auth-foot">
            Need a new link? <Link href="/forgot-password">Request one</Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
