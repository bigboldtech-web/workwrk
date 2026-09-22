"use client";

// Marketing measurement (marketing-concept.md 6.3 and 12 Phase 0 item 5).
//
// The concept asks for distinct `data-cta` ids on every placement, per stop
// "stop reached" events, sandbox interaction events and receipt events. It
// does NOT ask this file to pick an analytics vendor, and no vendor is wired
// into this repo today, so inventing a network call here would be a lie in
// code: a beacon to nowhere that looks measured and is not.
//
// So every event does exactly two things, both real:
//
//   1. pushes onto `window.dataLayer` when a tag manager has created one,
//      which is the conventional handoff and a no-op when nothing is there;
//   2. dispatches a DOM CustomEvent on `document` under one name, so the
//      analytics unit can subscribe once, later, without editing a single
//      call site on the site.
//
// Nothing throws on a server render, in a private window, or with storage
// blocked. A page that cannot measure still works.
//
// CONSENT. The same layout that mounts a CTA mounts a banner offering
// "Reject all", so measurement that ignores the answer makes the banner a
// decoration. Every event below is gated on the analytics category of the
// consent record, read straight from the cookie the ConsentProvider writes:
//
//   * no record yet            no measurement. A visitor who has not been
//                              asked has not agreed, so the default is off,
//                              never "off in the EU and on elsewhere".
//   * analytics: false         no measurement, for the whole session.
//   * analytics: true          the dataLayer push and the DOM event, as below.
//
// The gate sits inside `track()` rather than at each call site, so a later
// stage adding a stop, a beat or a receipt event inherits it without knowing
// it exists. The cookie is re-read per event: a visitor who rejects mid-visit
// stops being measured on their very next click, with no reload.

// THE A/B, and why it is stamped here rather than at the call sites.
//
// Concept 12 Phase 2 item 12 asks for per stop drop off AND for the H1
// control against variant B. Those are one number, not two: the question is
// whether a different first line changes how far down the story people get,
// so every event has to say which headline the visitor was shown. Reading
// the variant in `track()` is what makes that true of events a later stage
// adds without knowing this paragraph exists.
//
// It comes from `headline-variant`, a leaf module with no imports, and not
// from `headline.ts`: that one reaches `config.ts`, which imports the whole
// Tuesday fixture, and this is a client module.
import { readConsentCookie } from "@/lib/compliance/consent-client";
import { heroVariant } from "./headline-variant";

export const MARKETING_EVENT = "workwrk:marketing";

export type MarketingEventName =
  | "cta_click"
  | "stop_reached"
  | "beat_reached"
  | "receipt_changed"
  | "receipt_copied"
  | "sandbox_interaction"
  | "currency_changed"
  | "form_submitted";

export interface MarketingEvent {
  event: typeof MARKETING_EVENT;
  name: MarketingEventName;
  /** The placement id, the same string as the element's data-cta. */
  id?: string;
  value?: number;
  /** Which hero headline this visitor was shown: the launch A/B, on every event. */
  variant: string;
  /**
   * WHICH STORY SURFACE THE VISITOR IS ON, on every event.
   *
   * The Tuesday exists twice in one piece of markup: six stops in a pinned
   * desktop scene, and the same content as eight beats in a mobile stepper
   * (spine.tsx: "the eight beats ARE the six stops, grouped"). The desktop
   * scene therefore emits stop_reached AND beat_reached from the same
   * scroll, which is correct, because a two beat stop really does show two
   * beats. What was wrong was that the two were indistinguishable
   * afterwards: an analyst counting beat_reached could not tell a phone
   * from a laptop, so per stop drop off was double counted and the six
   * stops versus eight beats decision, which is the whole reason these
   * events exist (concept 12 Phase 2), could not be made from the data.
   *
   *   "scene"    the pinned six stop desktop scene
   *   "stepper"  the eight beat stacked reading, phone, tablet, or any
   *              width with reduced motion on
   */
  surface: "scene" | "stepper";
  /** The viewport width at the moment of the event, so a breakpoint split is recoverable. */
  width: number;
  detail?: Record<string, string | number | boolean>;
}

type DataLayerWindow = Window & { dataLayer?: unknown[] };

/**
 * Has this visitor agreed to analytics? Absence of a record is a no, and a
 * cookie this code cannot read is a no.
 */
export function analyticsAllowed(): boolean {
  try {
    return readConsentCookie()?.analytics === true;
  } catch {
    return false;
  }
}

/**
 * The widths and motion setting at which the pinned desktop scene owns the
 * story. It is the same query spine-pin and spine-progress use, and it is
 * duplicated here rather than imported because both of those are components
 * and this is the leaf both of them call.
 */
const SCENE_QUERY = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

function currentSurface(): "scene" | "stepper" {
  try {
    if (typeof window.matchMedia !== "function") return "stepper";
    return window.matchMedia(SCENE_QUERY).matches ? "scene" : "stepper";
  } catch {
    return "stepper";
  }
}

/** Never throws, because a measurement helper must not be able to break a button. */
function currentWidth(): number {
  try {
    const w = window.innerWidth || document.documentElement?.clientWidth || 0;
    return Number.isFinite(w) ? Math.round(w) : 0;
  } catch {
    return 0;
  }
}

export function track(
  name: MarketingEventName,
  payload: Omit<MarketingEvent, "event" | "name" | "variant" | "surface" | "width"> = {},
): void {
  if (typeof window === "undefined") return;
  if (!analyticsAllowed()) return;
  const event: MarketingEvent = {
    event: MARKETING_EVENT,
    name,
    variant: heroVariant,
    surface: currentSurface(),
    width: currentWidth(),
    ...payload,
  };
  try {
    const w = window as DataLayerWindow;
    if (Array.isArray(w.dataLayer)) w.dataLayer.push(event);
  } catch {
    // A blocked or frozen dataLayer must never break a button.
  }
  try {
    document.dispatchEvent(new CustomEvent(MARKETING_EVENT, { detail: event }));
  } catch {
    // Older engines without CustomEvent still get the dataLayer push.
  }
}

/** Every filled or ghost CTA calls this with the id that is also its data-cta. */
export function trackCta(id: string): void {
  track("cta_click", { id });
}

/** Six stops on the desktop spine, eight beats on the mobile stepper. */
export function trackStop(n: number, id: string): void {
  track("stop_reached", { id, value: n });
}

export function trackBeat(n: number, id: string): void {
  track("beat_reached", { id, value: n });
}

export function trackReceipt(
  action: "chip" | "seats" | "currency" | "edit" | "copy",
  detail: Record<string, string | number | boolean>,
): void {
  track(action === "copy" ? "receipt_copied" : "receipt_changed", { id: `receipt-${action}`, detail });
}

/**
 * A form reaching its destination, or failing to.
 *
 * The demo form is the secondary conversion, and the one the cta.primary
 * flag promotes to primary on a demo-first day. It had no event at all, so
 * the door the whole nav points at produced no funnel data: not a submit,
 * not a failure, not the mailto fallback. The OUTCOME is on the event
 * because a form that posts to a 503 and offers a mailto is a different
 * thing from one that went through, and only one of them is a conversion.
 */
export function trackFormSubmit(id: string, outcome: "sent" | "error" | "unreachable"): void {
  track("form_submitted", { id, detail: { outcome } });
}

export function trackSandbox(surface: string): void {
  track("sandbox_interaction", { id: `sandbox-${surface}` });
}

/**
 * The attributes every CTA spreads. Keeping them in one helper is what makes
 * "distinct data-cta ids on all placements" checkable by grep rather than by
 * hope.
 */
export function ctaAttributes(id: string): { "data-cta": string } {
  return { "data-cta": id };
}
