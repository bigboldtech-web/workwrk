// The guest door's chrome and its join card (spec-talk.md section 2.5).
//
// Server-renderable by design: the frame, the brand bar and the two message
// states carry no state at all, so an expired or invalid link renders without
// shipping a kilobyte of JavaScript to somebody who cannot get in anyway.
// GuestJoinCard itself is a client island for the name field and the two
// preview toggles.
//
// THE DOOR IS NOT THE STAGE. spec-talk 2.5 asks for "a white canvas with one
// centred GuestJoinCard" (400 wide) under "the page's own 48px bar in
// --os-chrome-bg (navy)", and reserves the six --os-stage-* values for the
// stage itself ("nothing else inside .os-stage reads a theme token"). An
// earlier build wore .os-stage on the whole door, so somebody following an
// invitation met a full-viewport #101215 canvas before they had typed a
// character.
//
// The values are FIXED, in .os-door in globals.css, for the same reason the
// stage set is: a guest has no account and therefore no theme, so reading
// --os-surface here would follow the reader's prefers-color-scheme, which is
// the one preference this page is not entitled to act on. globals.css is what
// the root layout loads, so it reaches the (public) segment; the tokens.css
// import below stays for --os-brand and --os-danger-solid, which the Join
// button and the inline error read and which never rebind.

import "@/app/(dashboard)/tokens.css";

import type { ReactNode } from "react";
import { BRAND_BLUE, BRAND_GREEN, BRAND_RED, BRAND_YELLOW } from "@/components/brand/logo";

/** The brand's four dots, in the one required sequence. Read from the brand
 *  module rather than re-typed, so a palette change reaches this page too. */
const DOTS = [BRAND_YELLOW, BRAND_BLUE, BRAND_RED, BRAND_GREEN];

/** The four-dot mark and the product name, at the top of every guest state,
 *  including the one the person sees after they join. */
export function GuestDoorBar() {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 px-5"
      style={{ background: "var(--os-door-bar)", color: "var(--os-door-bar-fg)" }}
    >
      <span className="flex items-center gap-[3px]" aria-hidden>
        {DOTS.map((c) => <span key={c} className="h-2 w-2 rounded-full" style={{ background: c }} />)}
      </span>
      <span className="text-sm font-medium">WorkwrK</span>
    </header>
  );
}

/** The white canvas under the navy bar: every state BEFORE and AFTER a call. */
export function GuestDoorFrame({ children }: { children: ReactNode }) {
  return (
    <div className="os-door flex h-dvh flex-col">
      <GuestDoorBar />
      <main className="min-h-0 flex-1 px-4 pb-4">{children}</main>
    </div>
  );
}

/** A centred sentence: expired, not configured, or "you left the call". */
export function GuestDoorMessage({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="w-full rounded-xl p-6 text-center"
        style={{
          maxWidth: 400,
          background: "var(--os-door-surface)",
          border: "1px solid var(--os-door-line)",
        }}
      >
        <p className="m-0 text-base font-medium" style={{ color: "var(--os-door-fg)" }}>{title}</p>
        {body ? <p className="m-0 mt-1 text-sm" style={{ color: "var(--os-door-fg-2)" }}>{body}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  );
}
