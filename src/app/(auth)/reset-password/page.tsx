"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reset link invalid</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            This reset link is missing or expired. Request a fresh one.
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
        >
          Request new link <ArrowRight size={14} />
        </Link>
        <p className="text-sm text-slate-600 text-center">
          Back to{" "}
          <Link href="/login" className="text-violet-700 hover:text-violet-800 font-medium">
            sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {success ? "Password reset" : "Set a new password"}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {success
            ? "Redirecting you to sign in…"
            : "Eight characters or more. Mix letters, numbers, and a symbol for safety."}
        </p>
      </div>

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} /> Done. Taking you to sign in…
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-slate-700">
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-xs font-medium text-slate-700">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Same thing again"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.18)] active:translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Resetting…
              </>
            ) : (
              <>
                Reset password <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
