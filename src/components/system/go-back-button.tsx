"use client";

// Shared ghost "Go back" control for 404 / error pages. Server components
// (root not-found.tsx exports metadata) can't hold an onClick, so this tiny
// client island owns the call. Direct links / new tabs have no history —
// fall back to a real destination instead of a silent no-op.

import { useRouter } from "next/navigation";

export function GoBackButton({ className, fallbackHref = "/today" }: { className?: string; fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className={
        className ??
        "inline-flex items-center h-9 px-4 rounded-full border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-[14px] hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }
    >
      Go back
    </button>
  );
}
