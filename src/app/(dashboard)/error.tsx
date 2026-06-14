"use client";

// Dashboard error boundary — catches any thrown render/data error inside the
// app shell so a single broken page (e.g. a Space whose data fails to load)
// no longer traps the user on an unrecoverable "could not be loaded" screen.
// Always offers a retry plus guaranteed-good escape routes.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, LayoutGrid, RotateCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the server/pm2 logs and the browser console for triage.
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-red-50 flex items-center justify-center mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h1 className="text-[20px] font-semibold text-zinc-900">
          This page couldn&apos;t load
        </h1>
        <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed">
          Something went wrong while rendering this page. You can retry, or jump
          to somewhere that always works.
        </p>
        {error?.digest ? (
          <p className="mt-2 text-[11px] text-zinc-400">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--os-brand)] text-white text-[13px] font-medium hover:bg-[var(--os-brand-hover)]"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Try again
          </button>
          <Link
            href="/spaces"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 text-zinc-800 text-[13px] hover:bg-zinc-50"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            All spaces
          </Link>
          <Link
            href="/today"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 text-zinc-800 text-[13px] hover:bg-zinc-50"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
