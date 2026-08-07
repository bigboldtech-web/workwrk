// Dashboard-scoped 404 — keeps users inside the OS shell instead of
// falling through to the marketing 404 when they navigate to a route
// that hasn't shipped yet. Renders only the canvas slot; the rail +
// secondary sidebar come from the (dashboard)/layout.tsx wrapper.

import Link from "next/link";
import { Compass, Home, ArrowRight } from "lucide-react";
import { GoBackButton } from "@/components/system/go-back-button";

export default function DashboardNotFound() {
  return (
    <div className="min-h-full flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-zinc-100 flex items-center justify-center mb-4">
          <Compass className="w-6 h-6 text-zinc-500" />
        </div>
        <h1 className="text-[17px] font-semibold text-zinc-900">
          We haven&apos;t built this yet
        </h1>
        <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed">
          The page you&apos;re looking for isn&apos;t in the workspace.
          It may be coming soon or moved to a different path.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/today"
            className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full bg-zinc-900 text-white text-[13px] font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <Home className="w-3.5 h-3.5" />
            Back home
          </Link>
          <Link
            href="/spaces"
            className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full border border-zinc-200 text-zinc-700 text-[13px] hover:bg-zinc-50"
          >
            Browse spaces
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <GoBackButton className="inline-flex items-center h-8 px-3.5 rounded-full border border-zinc-200 text-zinc-700 text-[13px] hover:bg-zinc-50" />
        </div>
      </div>
    </div>
  );
}
