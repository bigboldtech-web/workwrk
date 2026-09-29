"use client";

// /login (spec-account-auth `/login`). The form only; AuthShell is the
// frame. page.tsx decides whether this is the staff console's sign-in (the
// admin host), which names the console and offers no way to start a
// workspace and no Google button.
//
// The hardening this page must never weaken lives on the server
// (src/lib/auth.ts): the lockout, the MFA gate, the timing equaliser and
// the no-store header. This page only words the answers:
//   - one blue primary per step; the four-dot pending loader in flight;
//   - the Google button only when NextAuth reports the provider;
//   - step 2 (two step verification) in place, the URL unchanged; a pasted
//     "123 456" or a backup code typed without its hyphen works;
//   - every ?error= and query flag through friendlyError()/loginNotice(),
//     shown once and stripped from the address bar;
//   - callbackUrl validated by safeCallbackUrl (absolute, protocol-relative
//     and marketing paths fall back to Work home, or /admin for staff);
//   - resetSessionExpired() before navigating (the expiry latch).

import { Suspense, useEffect, useRef, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetSessionExpired } from "@/lib/session-expiry";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { safeCallbackUrl } from "@/lib/nav/safe-callback";
import { friendlyError, loginNotice, normaliseMfaCode, ONE_TIME_LOGIN_FLAGS, type LoginNotice } from "@/lib/auth/login-messages";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { PasswordField } from "@/components/auth/password-field";
import { SignedInStrip } from "@/components/auth/signed-in-strip";

const LAST_EMAIL_KEY = "workwrk:last-email";

function readLastEmail(): string {
  try {
    return window.sessionStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeLastEmail(email: string) {
  try {
    window.sessionStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* private mode: prefill is a convenience only */
  }
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function LoginFormInner({ staffConsole }: { staffConsole: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const fallback = staffConsole ? "/admin" : WORK_HOME_HREF;
  const rawCallback = sp.get("callbackUrl");
  const callbackUrl = safeCallbackUrl(rawCallback, fallback);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  const verifyTouched = useRef(false);
  const autoSubmitted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Read the one-time flags once, then strip them (callbackUrl is kept).
  useEffect(() => {
    const params = new URLSearchParams(sp.toString());
    const n = loginNotice(params);
    const err = params.get("error");
    const last = readLastEmail();
    if (last) setEmail((e) => e || last);
    if (n) setNotice(n);
    else if (rawCallback && last) setNotice({ tone: "info", text: "You were logged out. Log in to pick up where you left off." });
    if (err) setError(friendlyError(err, { email: params.get("email") }));
    const hadFlag = ONE_TIME_LOGIN_FLAGS.some((k) => params.has(k));
    if (hadFlag) {
      for (const k of ONE_TIME_LOGIN_FLAGS) params.delete(k);
      const q = params.toString();
      router.replace(`/login${q ? `?${q}` : ""}`, { scroll: false });
    }
    // Run once on arrival; the flags are gone after the replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Google button exists only when the provider is really configured.
  useEffect(() => {
    if (staffConsole) return;
    let alive = true;
    void getProviders()
      .then((p) => {
        if (alive && p && Object.prototype.hasOwnProperty.call(p, "google")) setGoogle(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [staffConsole]);

  async function submit() {
    if (loading) return;
    const code = normaliseMfaCode(mfaCode);
    if (!mfaRequired && (!email.trim() || !password)) {
      setError("Enter your email and password.");
      return;
    }
    if (mfaRequired && !code) {
      setError("Enter the code from your authenticator app.");
      return;
    }
    setLoading(true);
    setError(null);
    setOffline(false);
    let result: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      // Only send mfaCode when there is one: next-auth serialises options
      // through URLSearchParams, and `undefined` would arrive as the string
      // "undefined" (the server guards against that too).
      result = await signIn("credentials", {
        email: email.trim(),
        password,
        ...(mfaRequired ? { mfaCode: code } : {}),
        redirect: false,
      });
    } catch {
      result = undefined;
    }
    if (!result) {
      setOffline(true);
      setLoading(false);
      return;
    }
    if (result.error) {
      if (result.error === "MFA_REQUIRED") {
        setMfaRequired(true);
        setError(null);
        setLoading(false);
        return;
      }
      setError(friendlyError(result.error));
      setLoading(false);
      autoSubmitted.current = false;
      return;
    }
    writeLastEmail(email.trim());
    // A fresh session. The expiry latch (spec-shell 1.10) is module state
    // that survives the client-side hop, so it is cleared here, at the one
    // place a new session is minted.
    resetSessionExpired();
    router.push(callbackUrl);
  }

  function onCodeChange(value: string) {
    setMfaCode(value);
    // Auto-submit on the sixth digit, once, for an authenticator code only.
    const code = normaliseMfaCode(value);
    if (!backupMode && !verifyTouched.current && !autoSubmitted.current && /^\d{6}$/.test(code)) {
      autoSubmitted.current = true;
      setTimeout(() => formRef.current?.requestSubmit(), 0);
    }
  }

  function resetToStart() {
    setMfaRequired(false);
    setMfaCode("");
    setPassword("");
    setBackupMode(false);
    setError(null);
    autoSubmitted.current = false;
  }

  const banner = offline ? (
    <AuthBanner tone="danger">
      <p>
        Can&apos;t reach WorkwrK. Check your connection.{" "}
        <button type="button" className="wa-link" onClick={() => void submit()}>
          Try again
        </button>
      </p>
    </AuthBanner>
  ) : error ? (
    <AuthBanner tone="danger">
      <p>{error}</p>
    </AuthBanner>
  ) : null;

  const topStrip = (
    <>
      {staffConsole ? null : <SignedInStrip continueHref={callbackUrl} logoutCallback="/login" />}
      {notice && !mfaRequired ? (
        <AuthBanner tone={notice.tone} strip>
          <p>{notice.text}</p>
        </AuthBanner>
      ) : null}
    </>
  );

  if (mfaRequired) {
    return (
      <AuthCard
        title="Two step verification"
        subtitle={
          <>
            Logging in as <strong style={{ color: "var(--os-ink)", fontWeight: 500 }}>{email}</strong>.{" "}
            <button type="button" className="wa-link" onClick={resetToStart}>
              Use a different account
            </button>
          </>
        }
      >
        <form
          ref={formRef}
          className="wa-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {banner}
          <div className="wa-field">
            <label htmlFor="mfaCode" className="wa-label">
              {backupMode ? "Backup code" : "Authentication code"}
            </label>
            <input
              id="mfaCode"
              className="wa-input wa-input--code"
              type="text"
              value={mfaCode}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder={backupMode ? "ABCD-EFGH" : "123456"}
              inputMode={backupMode ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoFocus
              maxLength={backupMode ? 11 : 9}
              aria-describedby="mfaHelp"
            />
            <p id="mfaHelp" className="wa-help">
              {backupMode ? "Enter one of the backup codes you saved when you turned on two step verification. Each works once." : "Open your authenticator app, or enter one of your backup codes."}
            </p>
          </div>
          <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined} onClick={() => { verifyTouched.current = true; }}>
            {loading ? <Dots variant="pending" label="Verifying" /> : null}
            Verify
          </button>
          <button
            type="button"
            className="wa-link wa-link--sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              setBackupMode((b) => !b);
              setMfaCode("");
              autoSubmitted.current = false;
            }}
          >
            {backupMode ? "Use your authenticator app instead" : "Use a backup code instead"}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      banner={topStrip}
      title="Log in"
      subtitle={staffConsole ? "Sign in to the WorkwrK staff console." : "Welcome back"}
      footer={
        staffConsole ? null : (
          <>
            <p>
              New to WorkwrK?{" "}
              <Link href="/signup" className="wa-link">
                Start free
              </Link>
            </p>
            <p>
              Didn&apos;t get your verification email?{" "}
              <Link href="/verify-email?resend=1" className="wa-link">
                Send a new link
              </Link>
            </p>
          </>
        )
      }
    >
      {google ? (
        <>
          <button type="button" className="wa-btn wa-btn--secondary wa-btn--block" onClick={() => void signIn("google", { callbackUrl })}>
            <GoogleGlyph />
            Continue with Google
          </button>
          <div className="wa-divider">or</div>
        </>
      ) : null}
      <form
        className="wa-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setError(null);
        }}
      >
        {banner}
        <div className="wa-field">
          <label htmlFor="email" className="wa-label">
            Work email
          </label>
          <input
            id="email"
            className="wa-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
            required
          />
        </div>
        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8 }}>
          <Link href={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`} className="wa-link wa-link--sm">
            Forgot your password?
          </Link>
        </div>
        <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined}>
          {loading ? <Dots variant="pending" label="Logging in" /> : null}
          Log in
        </button>
      </form>
    </AuthCard>
  );
}

export function LoginForm({ staffConsole = false }: { staffConsole?: boolean }) {
  return (
    <Suspense>
      <LoginFormInner staffConsole={staffConsole} />
    </Suspense>
  );
}
