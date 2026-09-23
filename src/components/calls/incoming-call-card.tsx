"use client";

// IncomingCallCard (spec-talk.md section 2.6), the surface that replaces the
// ring TOAST.
//
// A toast was the wrong container for a ringing call and it showed:
//
//   * it shared the toast stack's cap of three, so a call could be pushed off
//     screen by two "Saved" messages;
//   * its actions were text buttons in a row, so Join and Dismiss looked
//     identical and the destructive one was as easy to hit as the primary;
//   * there was no way to answer with video, because a toast has no room for
//     a third control and no hover state to reveal one;
//   * and it lived in the OTHER toast provider (src/components/ui/toast.tsx,
//     mounted above OsShell), while every other Talk surface uses the shell's
//     own. One ringing call reaching a different provider from every other
//     message in the product is how "which toast system is this" happened.
//
// This is a shell overlay, so its blue Join is outside the page's one-primary
// count (spec-talk section 1, "Shell overlays are exempt"). It sits in the
// same bottom-right reserved region as the call dock and stacks ABOVE it, so
// a second call arriving during a call does not cover the call you are on.

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** Never changes: the store IS "are we on the client", which flips exactly
 *  once, at hydration, and React already re-renders for that. */
const subscribeNever = () => () => {};
import { Phone, PhoneOff, Video } from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { Dots } from "@/components/ui/dots";

export interface IncomingCall {
  conversationId: string;
  roomName: string;
  callerName: string;
  callerAvatar?: string | null;
  label: string;
  isDM: boolean;
}

export function IncomingCallCard({
  call,
  /** True while I am already on a different call: Join becomes Switch. */
  busy,
  /** How far up from the bottom edge to sit, in px (the dock reserves space). */
  offset,
  onJoin,
  onDecline,
}: {
  call: IncomingCall;
  busy: boolean;
  offset: number;
  onJoin: (audioOnly: boolean) => void;
  onDecline: () => void;
}) {
  // createPortal needs a document, which the server render has not got. The
  // ref-and-effect dance is avoided: `typeof document` is the question being
  // asked, and useSyncExternalStore is the sanctioned way to ask it without
  // a render-then-correct pass.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!mounted) return null;

  const title = call.isDM
    ? `${call.callerName} is calling`
    : `${call.callerName} started a call in ${call.label}`;

  return createPortal(
    <div
      className="workwrk-os fixed end-6 z-[46] w-[320px] rounded-xl border border-line bg-raised p-3 shadow-[var(--os-shadow-pop)]"
      style={{ bottom: offset }}
      role="alertdialog"
      aria-label={title}
    >
      <div className="flex items-start gap-2.5">
        <TeamAvatar name={call.callerName} avatar={call.callerAvatar ?? undefined} size={40} />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-medium text-ink">{title}</p>
          <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
            <Dots variant="live" />
            {busy ? "Another call" : "Audio call"} · Talk
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onDecline}
          title="Decline"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          <PhoneOff className="h-4 w-4" />
          Decline
        </button>
        {/* Join with video is a real, always-present control rather than a
            hover-only one: spec-talk section 1 Mobile/narrow forbids anything
            reachable only by hover, and a ringing call is exactly the moment
            somebody is reaching for a phone rather than a trackpad. */}
        <button
          type="button"
          onClick={() => onJoin(false)}
          title="Join with video"
          aria-label="Join with video"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink hover:bg-hover"
        >
          <Video className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onJoin(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-white"
          style={{ background: "var(--os-brand)" }}
        >
          <Phone className="h-4 w-4" />
          {busy ? "Switch" : "Join"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
