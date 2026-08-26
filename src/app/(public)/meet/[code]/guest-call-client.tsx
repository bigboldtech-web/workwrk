"use client";

// Guest-side call chrome (native-calls Phase 3): name prompt → guest
// token → OUR conference, full viewport. Falls back to the legacy
// Jitsi embed only if the calls server reports unconfigured (503).

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ConferenceSurface } from "@/components/calls/conference-surface";
import { MeetingCall } from "@/components/meetings/meeting-call";

type Grant = { url: string; token: string };

export function GuestCallClient({ code, fallbackRoom, title, orgName, scheduledAt }: {
  code: string;
  fallbackRoom: string;
  title: string;
  orgName: string;
  scheduledAt: string | null;
}) {
  const [name, setName] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  const [fallback, setFallback] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "Live now";

  const join = async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setError(null);
    try {
      const r = await fetch("/api/calls/guest-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: name.trim() }),
      });
      if (r.status === 503) { setFallback(true); return; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.token) throw new Error(d?.error ?? "Couldn't join the TalkTok");
      setGrant(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the TalkTok");
    } finally {
      setJoining(false);
    }
  };

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
        {fallback ? (
          <MeetingCall room={fallbackRoom} subject={title} />
        ) : grant ? (
          <div className="h-full w-full overflow-hidden rounded-xl bg-zinc-900">
            <ConferenceSurface url={grant.url} token={grant.token} video />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-[15px] font-medium text-white">Joining {title}</p>
              <p className="mt-1 text-[13px] text-zinc-400">Enter your name so people know who you are.</p>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void join(); }}
                placeholder="Your name"
                className="mt-4 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[14px] text-white placeholder:text-zinc-500 outline-none focus:border-white/30"
              />
              {error && <p className="mt-2 text-[13px] text-red-400">{error}</p>}
              <button
                type="button"
                onClick={() => void join()}
                disabled={!name.trim() || joining}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0073EA] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[#0060c2] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Join TalkTok
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
