"use client";

// PlannerConnectBanner — a dismissible prompt shown ABOVE the Planner grid when
// no calendar is connected. The Planner is NOT gated on Google: the grid renders
// your scheduled tasks and work items for everyone (they come straight from
// /api/planner/events). Connecting Google Calendar simply layers your real
// meetings on top. Microsoft Outlook is the next integration.

import { CalendarClock, X } from "lucide-react";

export function PlannerConnectBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-3 mb-1 shrink-0 rounded-xl border border-[#0073EA]/20 bg-[#0073EA]/[0.06] dark:bg-[#0073EA]/10 px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="shrink-0 w-8 h-8 rounded-lg bg-[#0073EA]/10 flex items-center justify-center">
        <CalendarClock className="w-4 h-4 text-[#0073EA]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">Connect your calendar</div>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-snug">
          Your tasks and work already show here. Connect Google Calendar to layer in your meetings.
        </p>
      </div>

      {/* OAuth API route — needs a real full-page navigation, not next/link. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/integrations/google-calendar/connect"
        className="shrink-0 h-8 px-3 rounded-lg bg-[#0073EA] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 hover:bg-[#0060B9]"
      >
        <GoogleMark /> Connect Google Calendar
      </a>
      <button
        type="button"
        disabled
        title="Microsoft Outlook is coming soon"
        className="shrink-0 h-8 px-3 rounded-lg border border-zinc-200 dark:border-[#2A2F38] text-[12.5px] font-medium text-zinc-400 dark:text-zinc-500 inline-flex items-center gap-1.5 cursor-not-allowed"
      >
        <OutlookMark /> Outlook
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 bg-zinc-100 dark:bg-white/10 rounded px-1 py-0.5">Soon</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 w-7 h-7 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path fill="#fff" d="M12 11v2.6h6.3c-.3 1.6-1.9 4.7-6.3 4.7-3.8 0-6.9-3.1-6.9-7s3.1-7 6.9-7c2.2 0 3.6.9 4.4 1.7l2-1.9C17.1 2.9 14.8 2 12 2 6.9 2 2.8 6.1 2.8 12S6.9 22 12 22c5.9 0 9.8-4.1 9.8-9.9 0-.7-.1-1.2-.2-1.7H12z"/>
    </svg>
  );
}

function OutlookMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <rect x="3" y="6" width="12" height="12" rx="2" fill="#0A66C2"/>
      <path d="M21 8v8l-5-2.5V10.5L21 8z" fill="#0A66C2" opacity="0.6"/>
    </svg>
  );
}
