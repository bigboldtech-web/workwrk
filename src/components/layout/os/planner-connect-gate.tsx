"use client";

// PlannerConnectGate — shown when no calendar is connected. The Planner is a
// calendar view: it only makes sense once your real meetings (and your team's)
// flow in from Google or Microsoft Outlook. Google connect is live; Outlook is
// the next integration.

import { CalendarClock, ArrowRight } from "lucide-react";

export function PlannerConnectGate() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-[420px] max-w-full text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-[#0073EA]/10 flex items-center justify-center">
          <CalendarClock className="w-6 h-6 text-[#0073EA]" />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold text-zinc-900 dark:text-zinc-100">Connect your calendar</h2>
        <p className="mt-1.5 text-[13.5px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          The Planner lays your meetings next to your work so you can plan your day in one place. Connect a calendar to turn it on.
        </p>

        <div className="mt-6 space-y-2.5">
          {/* OAuth API route — needs a real full-page navigation, not next/link. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/integrations/google-calendar/connect"
            className="w-full h-11 rounded-xl bg-[#0073EA] text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 hover:bg-[#0060B9]"
          >
            <GoogleMark /> Connect Google Calendar <ArrowRight className="w-4 h-4" />
          </a>
          <button
            type="button"
            disabled
            title="Microsoft Outlook is coming soon"
            className="w-full h-11 rounded-xl border border-zinc-200 dark:border-[#2A2F38] text-[14px] font-medium text-zinc-500 dark:text-zinc-400 inline-flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <OutlookMark /> Connect Microsoft Outlook
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 bg-zinc-100 dark:bg-white/10 rounded px-1.5 py-0.5">Soon</span>
          </button>
        </div>

        <p className="mt-4 text-[11.5px] text-zinc-400 dark:text-zinc-500">
          Your events stay private. You can disconnect anytime in Settings.
        </p>
      </div>
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
