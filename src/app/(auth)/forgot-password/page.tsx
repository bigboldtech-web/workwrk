"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowRight, MailCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {sent ? "Check your inbox" : "Reset your password"}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {sent
            ? "If an account exists, we've sent a reset link. It's good for 30 minutes."
            : "Enter your email. We'll send a secure reset link that expires in 30 minutes."}
        </p>
      </div>

      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm flex items-start gap-2">
          <MailCheck size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Sent to <strong>{email}</strong>. Check your inbox — and spam, just in case.
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-700">
              Work email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
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
                <Loader2 size={14} className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                Send reset link <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>
      )}

      <p className="text-sm text-slate-600 text-center">
        Remember it?{" "}
        <Link href="/login" className="text-violet-700 hover:text-violet-800 font-medium">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
