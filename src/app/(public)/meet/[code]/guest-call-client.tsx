"use client";

/* The guest call page: a name, two preview toggles, then a token, then the
 * call stage, full viewport.
 *
 * PHASE 4 (spec-talk.md section 2.5). What changed and why:
 *
 *   1. THE PUBLIC JITSI FALLBACK IS GONE (founder decision Q1). A 503 from
 *      the token route used to mean "join meet.jit.si instead", which put an
 *      unauthenticated stranger into an internal company meeting on a
 *      third-party public server with the meeting's title in the URL, with no
 *      admin visibility and no way to turn it off. It now means what it says,
 *      and the card says it BEFORE the click, because the server already
 *      knows whether this deployment has a media server.
 *   2. THE CHROME READS TOKENS, not `bg-zinc-950` and a hard-coded #0073EA.
 *      The pre-join and post-call states are the white DOOR (.os-door) under
 *      the navy brand bar; only the live call wears the dark .os-stage. See
 *      guest-join-card.tsx for why both sets are fixed on a (public) route.
 *   3. CAMERA AND MIC PREVIEW TOGGLES EXIST. Mic on, camera off by default,
 *      which is what a person arriving at a stranger's meeting from an email
 *      link actually wants, and they could not change it before joining.
 *   4. THERE IS A "YOU LEFT" STATE with Rejoin. Leaving used to unmount the
 *      conference and leave a blank dark page.
 *
 * The guest has no account and therefore no locale preference, so a scheduled
 * time renders in the browser's own zone, the only zone this page can honestly
 * claim to know.
 */

import { useState } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { CallStage } from "@/components/calls/call-stage";
import { Dots } from "@/components/ui/dots";
import { GuestDoorBar, GuestDoorFrame, GuestDoorMessage } from "./guest-join-card";

type Grant = { url: string; token: string };

export function GuestCallClient({ code, title, orgName, scheduledAt, configured = true }: {
  code: string;
  title: string;
  orgName: string;
  scheduledAt: string | null;
  /** False when this deployment has no media server: the card says so up front. */
  configured?: boolean;
}) {
  const [name, setName] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  // Known before the click when the server already told us, and still set by
  // a 503 for the case where the variables are present and the media service
  // is nonetheless unreachable.
  const [notConfigured, setNotConfigured] = useState(!configured);
  const [joining, setJoining] = useState(false);
  const [left, setLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);

  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "Live now";

  const join = async () => {
    if (!name.trim() || joining) return;
    setJoining(true);
    setError(null);
    setLeft(false);
    try {
      const r = await fetch("/api/calls/guest-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: name.trim() }),
      });
      if (r.status === 503) { setNotConfigured(true); return; }
      if (r.status === 410) { setError("This link has expired. Ask for a new one."); return; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.token) throw new Error(d?.error ?? "Couldn't join the call");
      setGrant(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the call");
    } finally {
      setJoining(false);
    }
  };

  if (notConfigured) {
    return (
      <GuestDoorFrame>
        <GuestDoorMessage
          title="Calls aren't available right now."
          body="Ask the person who sent you this link."
        />
      </GuestDoorFrame>
    );
  }

  if (grant) {
    return (
      <div className="os-stage flex h-dvh flex-col">
        {/* The four-dot mark belongs on EVERY guest state, in call or not
            (spec-talk 2.5 Top bar). The call title sits beside it. */}
        <div className="shrink-0">
          <GuestDoorBar />
        </div>
        <header className="flex h-10 shrink-0 items-center px-5">
          <span className="block min-w-0 truncate text-sm font-medium" style={{ color: "var(--os-stage-fg)" }}>{title}</span>
        </header>
        <main className="min-h-0 flex-1 px-3 pb-3">
          <div className="h-full w-full overflow-hidden rounded-lg">
            <CallStage
              url={grant.url}
              token={grant.token}
              video={cameraOn}
              /* Both pre-join toggles decide what is PUBLISHED on connect, so
                 "Mic off" means the guest arrives muted instead of live in a
                 stranger's room. The in-call control bar still turns either
                 back on, so nothing is taken away by choosing off here. */
              audio={micOn}
              onDisconnected={() => { setGrant(null); setLeft(true); }}
            />
          </div>
        </main>
      </div>
    );
  }

  if (left) {
    return (
      <GuestDoorFrame>
        <GuestDoorMessage title="You left the call" body="You can close this tab.">
          <button
            type="button"
            onClick={() => void join()}
            className="inline-flex h-9 items-center justify-center rounded-md px-4 text-base font-medium"
            style={{ background: "var(--os-door-field)", color: "var(--os-door-fg)", border: "1px solid var(--os-door-line)" }}
          >
            Rejoin
          </button>
        </GuestDoorMessage>
      </GuestDoorFrame>
    );
  }

  const toggle = (on: boolean) => ({
    background: on ? "var(--os-door-field)" : "transparent",
    border: "1px solid var(--os-door-line)",
    color: on ? "var(--os-door-fg)" : "var(--os-door-fg-2)",
  });

  return (
    <GuestDoorFrame>
      <div className="flex h-full items-center justify-center">
        <div
          className="w-full rounded-xl p-6"
          style={{ maxWidth: 400, background: "var(--os-door-surface)", border: "1px solid var(--os-door-line)" }}
        >
          <p className="m-0 text-base font-semibold" style={{ color: "var(--os-door-fg)" }}>{title}</p>
          <p className="m-0 mt-0.5 text-sm" style={{ color: "var(--os-door-fg-2)" }}>{orgName} · {when}</p>

          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void join(); }}
            placeholder="Your name"
            aria-label="Your name"
            className="mt-4 w-full rounded-md px-3 py-2 text-base outline-none"
            style={{
              background: "var(--os-door-field)",
              border: "1px solid var(--os-door-line)",
              color: "var(--os-door-fg)",
            }}
          />

          {/* Mic on, camera off: what somebody arriving at a stranger's call
              from an email link actually wants, and now changeable BEFORE
              they are in the room rather than after. */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMicOn((v) => !v)}
              aria-pressed={micOn}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm"
              style={toggle(micOn)}
            >
              {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {micOn ? "Mic on" : "Mic off"}
            </button>
            <button
              type="button"
              onClick={() => setCameraOn((v) => !v)}
              aria-pressed={cameraOn}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm"
              style={toggle(cameraOn)}
            >
              {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              {cameraOn ? "Camera on" : "Camera off"}
            </button>
          </div>

          {error ? (
            <p className="m-0 mt-2 text-sm" style={{ color: "var(--os-danger-solid)" }}>{error}</p>
          ) : null}

          <button
            type="button"
            onClick={() => void join()}
            disabled={!name.trim() || joining}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--os-brand)" }}
          >
            {/* The four-dot mini loader, not a spinner (spec-shell 1.6). */}
            {joining ? <Dots variant="pending" label="Joining" /> : null}
            {joining ? "Joining…" : "Join call"}
          </button>
        </div>
      </div>
    </GuestDoorFrame>
  );
}
