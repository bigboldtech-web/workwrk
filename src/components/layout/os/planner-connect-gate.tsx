"use client";

// PlannerConnectBanner — a dismissible prompt shown ABOVE the Planner grid when
// no calendar is connected. The Planner is NOT gated on Google: the grid renders
// your scheduled tasks and work items for everyone (they come straight from
// /api/planner/events). Connecting Google Calendar simply layers your real
// meetings on top. Microsoft Outlook is the next integration.

import { CalendarClock, X } from "lucide-react";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";

export function PlannerConnectBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-3 mb-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-subtle px-3.5 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft">
        <CalendarClock className="h-4 w-4 text-brand-deep" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-ink">Connect your calendar</div>
        <p className="text-sm leading-snug text-ink-2">
          Your tasks and work already show here. Connect Google Calendar to layer in your meetings.
        </p>
      </div>

      {/* OAuth API route — needs a real full-page navigation, not next/link. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/integrations/google-calendar/connect"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover"
      >
        <GoogleMark /> Connect Google Calendar
      </a>
      <UpcomingOnly><ComingSoonRow label="Microsoft Outlook" className="shrink-0 h-8" /></UpcomingOnly>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
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

