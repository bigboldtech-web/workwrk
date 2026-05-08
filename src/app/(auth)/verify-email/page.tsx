"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

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

  if (state === "loading") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Verifying…</h1>
          <p className="text-sm text-slate-500 mt-1.5">Checking your token.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Talking to the server
        </div>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email verified</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            You're in. Jump straight to your workspace.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} /> All set.
        </div>
        <Link
          href="/dashboard"
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
        >
          Open dashboard <ArrowRight size={14} />
        </Link>
        <p className="text-sm text-slate-600 text-center">
          Not signed in?{" "}
          <Link href="/login" className="text-violet-700 hover:text-violet-800 font-medium">
            Log in
          </Link>
        </p>
      </div>
    );
  }

  if (state === "already") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Already verified</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            This email has been confirmed previously. No action needed.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
        >
          Open dashboard <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Link expired or invalid</h1>
        <p className="text-sm text-slate-500 mt-1.5">{msg}</p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm flex items-center gap-2">
        <AlertCircle size={16} /> {msg}
      </div>
      <Link
        href="/login"
        className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
      >
        Back to sign in <ArrowRight size={14} />
      </Link>
      <p className="text-sm text-slate-600 text-center">
        Need a new link?{" "}
        <Link href="/forgot-password" className="text-violet-700 hover:text-violet-800 font-medium">
          Request one
        </Link>
      </p>
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
