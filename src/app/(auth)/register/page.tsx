"use client";

// Sign-up screen. Two flows in one form:
//   - Invited (token in querystring): join an existing org
//   - Self-serve: spin up a new org + admin user
//
// Inside the white 2-pane auth shell.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {invited ? `Join ${invitation?.organizationName ?? "the team"}` : "Start your free trial"}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {invited
            ? invitation
              ? `Invited as ${invitation.accessLevel.replace(/_/g, " ").toLowerCase()}. One form and you're in.`
              : "Loading your invitation…"
            : "No credit card. Full access for 14 days."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {invited && invitation && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 text-violet-800 text-sm px-3 py-2 flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>Joining as <strong>{invitation.email}</strong></span>
          </div>
        )}

        {!invited && (
          <div className="space-y-1.5">
            <label htmlFor="orgName" className="text-xs font-medium text-slate-700">
              Company name
            </label>
            <input
              id="orgName"
              type="text"
              value={formData.organizationName}
              onChange={(e) => update("organizationName", e.target.value)}
              placeholder="ScaleOps"
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="firstName" className="text-xs font-medium text-slate-700">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              value={formData.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              placeholder="Priya"
              autoComplete="given-name"
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lastName" className="text-xs font-medium text-slate-700">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              value={formData.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              placeholder="Sharma"
              autoComplete="family-name"
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>
        </div>

        {!invited && (
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-700">
              Work email
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="priya@company.com"
              autoComplete="email"
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={formData.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
            className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading || (invited && !invitation)}
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.18)] active:translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {invited ? "Joining…" : "Creating account…"}
            </>
          ) : (
            <>
              {invited ? "Join team" : "Create account"} <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>

      <p className="text-sm text-slate-600 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-violet-700 hover:text-violet-800 font-medium">
          Sign in
        </Link>
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
