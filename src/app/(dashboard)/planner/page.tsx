// /planner — Planner is the calendar surface from the rail. It will
// eventually host the connected-calendar integration (Google Calendar /
// Microsoft Outlook). For now it's a clean placeholder so the rail
// click lands somewhere intentional instead of the marketing 404.

import { Calendar, Plus } from "lucide-react";

export const metadata = { title: "Planner — WorkwrK" };

export default function PlannerPage() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="px-6 pt-6 pb-4 border-b border-zinc-200 flex items-center gap-3">
        <Calendar className="w-5 h-5 text-zinc-500" />
        <h1 className="text-[20px] font-semibold text-zinc-900 flex-1">Planner</h1>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--os-brand)] text-white text-[13px] font-medium hover:bg-[var(--os-brand-hover)]"
        >
          <Plus className="w-3.5 h-3.5" />
          New event
        </button>
      </header>

      <div className="flex-1 px-6 py-10 flex items-center justify-center">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-zinc-100 flex items-center justify-center mb-4">
            <Calendar className="w-7 h-7 text-zinc-500" />
          </div>
          <h2 className="text-[16px] font-semibold text-zinc-900">No calendars connected</h2>
          <p className="text-[13px] text-zinc-500 mt-1.5 leading-relaxed">
            Connect Google Calendar or Microsoft Outlook to see upcoming
            events and join your next call from here.
          </p>
          <div className="mt-5 space-y-2">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-[13px] text-left"
            >
              <span className="w-6 h-6 rounded bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">31</span>
              <span className="flex-1">Google Calendar</span>
              <span className="text-[11px] text-zinc-500">Connect</span>
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-[13px] text-left"
            >
              <span className="w-6 h-6 rounded bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">O</span>
              <span className="flex-1">Microsoft Outlook</span>
              <span className="text-[11px] text-zinc-500">Connect</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
