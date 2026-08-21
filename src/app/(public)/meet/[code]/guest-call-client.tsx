"use client";

// Guest-side call chrome: meeting title + the embedded room, full viewport.
// Jitsi's prejoin screen asks the guest for their name and device checks, so
// no extra form is needed here.

import { MeetingCall } from "@/components/meetings/meeting-call";

export function GuestCallClient({ room, title, orgName, scheduledAt }: {
  room: string;
  title: string;
  orgName: string;
  scheduledAt: string;
}) {
  const when = new Date(scheduledAt).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      <header className="flex items-center justify-between px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-white">{title}</h1>
          <p className="text-[12px] text-zinc-400">{orgName} · {when}</p>
        </div>
        <span className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
          Powered by WorkwrK
        </span>
      </header>
      <main className="min-h-0 flex-1 px-3 pb-3">
        <MeetingCall room={room} subject={title} />
      </main>
    </div>
  );
}
