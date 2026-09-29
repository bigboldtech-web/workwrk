"use client";

// The sign-up form, in its two modes (spec-account-auth section 0):
//   mode "join"    /join?token=X: accept an invitation into an existing org
//   mode "signup"  /signup: spin up a new org and its first admin
//
// It was one page at /register that switched on ?token; /register now 308s
// to /signup, and /register?token=X to /join?token=X, so every invitation
// email already sent keeps working. A1 rebuilds both pages on AuthShell /
// AuthCard / PasswordField; this split keeps today's form and flow exactly
// (the same two APIs, the same sign-in, the same landings) under the two
// URLs the marketing site and the invitation links use.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Dots } from "@/components/ui/dots";

type Invitation = {
  email: string;
  organizationName: string;
  accessLevel: string;
  firstName?: string | null;
  lastName?: string | null;
};

function RegisterFormInner({ mode }: { mode: "signup" | "join" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryToken = searchParams.get("token");
  // /signup never accepts an invitation (that is /join's one job); a token
  // that lands here is sent on to /join with the rest of the query.
  const token = mode === "join" ? queryToken : null;
  useEffect(() => {
    if (mode === "signup" && queryToken) router.replace(`/join?${searchParams.toString()}`);
  }, [mode, queryToken, router, searchParams]);

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
      fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) setError(data.error);
          else {
            setInvitation(data);
            // A People CSV import carried the names: the form starts filled.
            setFormData((p) => ({ ...p, email: data.email, firstName: p.firstName || data.firstName || "", lastName: p.lastName || data.lastName || "" }));
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
      if (result?.ok) router.push(token ? "/welcome" : "/setup");
      else router.push("/login?registered=true");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const invited = mode === "join";

  // A link that cannot be used (spent, expired, unknown) is a dead end with
  // one way on, not a form that looks fillable under an error. A1 splits
  // this into its four failure screens with a "send me a new link" action.
  if (invited && token && error && !invitation) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">This invitation can&apos;t be used</h1>
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-base px-3 py-2">{error}</div>
        <p className="text-base text-slate-500">
          Ask the person who invited you to send a new invitation. If you already joined, log in instead.
        </p>
        <p className="text-base text-slate-600">
          <Link href="/login" className="text-[#0073EA] hover:text-[#0056B0] font-medium">Log in</Link>
        </p>
      </div>
    );
  }

  if (invited && !token) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">This invitation link is incomplete</h1>
        <p className="text-base text-slate-500">
          Open the link from your invitation email again, or ask the person who invited you to send a new one.
        </p>
        <p className="text-base text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="text-[#0073EA] hover:text-[#0056B0] font-medium">Log in</Link>
        </p>
        {/* Someone given the bare /join address (it used to fall through to
            the self-serve form) still has a way to start their own workspace. */}
        <p className="text-base text-slate-600">
          Starting a new workspace?{" "}
          <Link href="/signup" className="text-[#0073EA] hover:text-[#0056B0] font-medium">Create account</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {invited ? `Join ${invitation?.organizationName ?? "your team"}` : "Start your workspace"}
        </h1>
        <p className="text-base text-slate-500 mt-1.5">
          {invited
            ? invitation
              ? `Invited as ${invitation.accessLevel.replace(/_/g, " ").toLowerCase()}. One form and you're in.`
              : "Opening your invitation"
            : "No credit card. Full access for 14 days."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-base px-3 py-2">
            {error}
          </div>
        )}

        {invited && invitation && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-base px-3 py-2 flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>Joining as <strong>{invitation.email}</strong></span>
          </div>
        )}

        {!invited && (
          <div className="space-y-1.5">
            <label htmlFor="orgName" className="text-sm font-medium text-slate-700">
              Company name
            </label>
            <input
              id="orgName"
              type="text"
              value={formData.organizationName}
              onChange={(e) => update("organizationName", e.target.value)}
              placeholder="ScaleOps"
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="firstName" className="text-sm font-medium text-slate-700">
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
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lastName" className="text-sm font-medium text-slate-700">
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
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
            />
          </div>
        </div>

        {!invited && (
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
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
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
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
            className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#0073EA]/20 focus:border-[#0073EA] transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading || (invited && !invitation)}
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.18)] active:translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? <Dots variant="pending" /> : null}
          {invited ? `Join ${invitation?.organizationName ?? "your team"}` : "Start free"}
          {loading ? null : <ArrowRight size={14} />}
        </button>
      </form>

      <p className="text-base text-slate-600 text-center">
        {invited ? "Not you?" : "Already have a workspace?"}{" "}
        <Link href="/login" className="text-[#0073EA] hover:text-[#0056B0] font-medium">
          Log in
        </Link>
      </p>
    </div>
  );
}

export function RegisterForm({ mode }: { mode: "signup" | "join" }) {
  return (
    <Suspense>
      <RegisterFormInner mode={mode} />
    </Suspense>
  );
}
