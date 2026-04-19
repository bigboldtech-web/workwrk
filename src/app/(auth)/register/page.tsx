"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Invitation = {
  email: string;
  organizationName: string;
  accessLevel: string;
};

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [formData, setFormData] = useState({
    organizationName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    if (token) {
      fetch(`/api/auth/accept-invite?token=${token}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) setError(data.error);
          else {
            setInvitation(data);
            setFormData((p) => ({ ...p, email: data.email }));
          }
        })
        .catch(() => setError("Failed to load invitation"));
    }
  }, [token]);

  function update(field: keyof typeof formData, value: string) {
    setFormData((p) => ({ ...p, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const endpoint = token ? "/api/auth/accept-invite" : "/api/auth/register";
      const body = token
        ? { token, firstName: formData.firstName, lastName: formData.lastName, password: formData.password }
        : formData;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        email: invitation?.email || formData.email,
        password: formData.password,
        redirect: false,
      });
      if (result?.ok) router.push(token ? "/onboarding" : "/setup");
      else router.push("/login?registered=true");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const invited = Boolean(token);

  return (
    <div className="auth-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      <h1 className="auth-title">
        {invited ? (
          <>
            Join <span className="hi">{invitation?.organizationName || "the team"}.</span>
          </>
        ) : (
          <>
            Start your <span className="hi">14-day trial.</span>
          </>
        )}
      </h1>
      <p className="auth-sub">
        {invited
          ? invitation
            ? `You've been invited as ${invitation.accessLevel.replace(/_/g, " ")}. One quick form and you're in.`
            : "Loading your invitation details…"
          : "No credit card. Full product access. Your data in the system by end of day one."}
      </p>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {error && <div className="auth-error">{error}</div>}

        {invited && invitation && (
          <div
            style={{
              padding: "12px 14px",
              background: "rgba(212, 255, 46, 0.08)",
              border: "1px solid rgba(212, 255, 46, 0.3)",
              borderRadius: 12,
              fontSize: 13,
              color: "var(--b-lime)",
              lineHeight: 1.4,
            }}
          >
            Joining as <strong>{invitation.email}</strong>
          </div>
        )}

        {!invited && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="orgName">Company name</label>
            <input
              id="orgName"
              type="text"
              className="auth-input"
              placeholder="ScaleOps"
              value={formData.organizationName}
              onChange={(e) => update("organizationName", e.target.value)}
              required
            />
          </div>
        )}

        <div className="auth-row-2">
          <div className="auth-field">
            <label className="auth-label" htmlFor="firstName">First name</label>
            <input
              id="firstName"
              type="text"
              className="auth-input"
              placeholder="Priya"
              value={formData.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              autoComplete="given-name"
              required
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              type="text"
              className="auth-input"
              placeholder="Sharma"
              value={formData.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              autoComplete="family-name"
              required
            />
          </div>
        </div>

        {!invited && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              className="auth-input"
              placeholder="priya@company.in"
              value={formData.email}
              onChange={(e) => update("email", e.target.value)}
              autoComplete="email"
              required
            />
          </div>
        )}

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="auth-input"
            placeholder="Min. 8 characters"
            value={formData.password}
            onChange={(e) => update("password", e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <button
          type="submit"
          className="bento-btn bento-btn-lime auth-submit"
          disabled={loading || (invited && !invitation)}
        >
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden />
              {invited ? "Joining…" : "Creating account…"}
            </>
          ) : (
            <>
              {invited ? "Join team" : "Create account"} <span className="arr">→</span>
            </>
          )}
        </button>
      </form>

      <div className="auth-foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </div>

      <p className="auth-legal">
        By creating an account you agree to our{" "}
        <Link href="/terms">terms</Link> and{" "}
        <Link href="/privacy">privacy policy</Link>. Your data stays in Mumbai.
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
