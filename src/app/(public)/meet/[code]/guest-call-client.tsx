"use client";

/* The guest call page: name prompt, then a guest token, then our conference,
 * full viewport.
 *
 * PHASE 4 (spec-talk.md section 2.5). Two things changed and they are the
 * same thing twice:
 *
 *   1. The chrome was `bg-zinc-950` with a hard-coded #0073EA button. Both
 *      are tokens now.
 *   2. The tokens it reads are the FIXED STAGE SET (--os-stage-*), not the
 *      theme set, and that is load-bearing rather than a preference. This
 *      page lives in the (public) segment, which loads NEITHER
 *      src/app/(dashboard)/tokens.css NOR os.css: only the root layout's
 *      globals.css reaches it. `bg-app` or `text-ink-2` here would resolve
 *      to an undefined variable and render unstyled. The stage set is
 *      defined in globals.css precisely so this page and the in-app call
 *      stage can share one definition, and it never rebinds in dark, which
 *      is right for a surface that is dark in both themes because video
 *      tiles read badly on white.
 *
 * Anything that is not a stage token here is one of the two the design
 * system already fixes in both themes: --os-brand (the one primary) and
 * --os-danger-solid (the error line). Nothing else reads a theme token.
 *
 * The guest has no account and therefore no locale preference, so the
 * scheduled time is rendered in the browser's own zone, which is the only
 * zone this page can honestly claim to know.
 */

// The two tokens below the stage set that this page reads, --os-brand and
// --os-danger-solid, live in tokens.css, which the (public) segment does not
// load. Importing it here is the same move src/components/process/
// public-page-frame.tsx makes for the other public pages, and it is the
// narrow one: .os-stage stays in globals.css so the SAME definition serves
// this page and the in-app call stage, and tokens.css only supplies the two
// values the design system already fixes in both themes.
import "@/app/(dashboard)/tokens.css";

import { useState } from "react";
import { ConferenceSurface } from "@/components/calls/conference-surface";
import { Dots } from "@/components/ui/dots";

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
  // a 503 for the case where the server has the variables and the media
  // service is nonetheless unreachable.
  const [notConfigured, setNotConfigured] = useState(!configured);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString(undefined, {
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
      // 503 means this deployment has no media server. It used to mean
      // "join meet.jit.si instead", which put an unauthenticated stranger
      // into an internal company meeting on a third-party public server
      // with the meeting's title in the URL. It now means what it says.
      if (r.status === 503) { setNotConfigured(true); return; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.token) throw new Error(d?.error ?? "Couldn't join the call");
      setGrant(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the call");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="os-stage flex h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold" style={{ color: "var(--os-stage-fg)" }}>{title}</h1>
          <p className="text-xs" style={{ color: "var(--os-stage-fg-2)" }}>{orgName} · {when}</p>
        </div>
      </header>
      <main className="min-h-0 flex-1 px-3 pb-3">
        {notConfigured ? (
          // spec-talk section 2.5: one sentence, no button. There is nothing
          // the guest can do and nothing honest to offer them.
          <div className="flex h-full items-center justify-center">
            <div
              className="w-full max-w-sm rounded-lg p-6 text-center"
              style={{ background: "var(--os-stage-surface)", border: "1px solid var(--os-stage-line)" }}
            >
              <p className="text-base font-medium" style={{ color: "var(--os-stage-fg)" }}>
                Calls aren&rsquo;t available right now.
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--os-stage-fg-2)" }}>
                Ask the person who sent you this link.
              </p>
            </div>
          </div>
        ) : grant ? (
          <div className="h-full w-full overflow-hidden rounded-lg">
            <ConferenceSurface url={grant.url} token={grant.token} video />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div
              className="w-full max-w-sm rounded-lg p-6 text-center"
              style={{ background: "var(--os-stage-surface)", border: "1px solid var(--os-stage-line)" }}
            >
              <p className="text-base font-medium" style={{ color: "var(--os-stage-fg)" }}>Joining {title}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--os-stage-fg-2)" }}>
                Enter your name so people know who you are.
              </p>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void join(); }}
                placeholder="Your name"
                className="mt-4 w-full rounded-md px-3 py-2 text-base outline-none"
                style={{
                  background: "var(--os-stage-surface-2)",
                  border: "1px solid var(--os-stage-line)",
                  color: "var(--os-stage-fg)",
                }}
              />
              {error && (
                <p className="mt-2 text-sm" style={{ color: "var(--os-danger-solid)" }}>{error}</p>
              )}
              <button
                type="button"
                onClick={() => void join()}
                disabled={!name.trim() || joining}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "var(--os-brand)" }}
              >
                {/* The four-dot mini loader, not a spinner (spec-shell 1.6). */}
                {joining ? <Dots variant="pending" /> : null} Join call
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
