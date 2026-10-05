"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shield, Settings2, X } from "lucide-react";
import { useConsent } from "./consent-provider";
import type { ConsentState } from "@/lib/compliance/consent-client";

/**
 * Geo-aware cookie consent banner.
 *
 * Regime behaviour:
 *  - OPT_IN_STRICT (EU/UK/BR/IN/CN/KR/…): Reject-all and Accept-all given equal
 *    prominence, so both are the same secondary button. No pre-ticked
 *    non-essential categories. The page stays usable before a decision.
 *  - OPT_OUT (CA/CO/VA/CT/…): Non-essential on by default, "Do Not Sell/Share"
 *    button prominent.
 *  - NOTICE_ONLY (US non-covered, ROW): Simple dismissible notice.
 *
 * Styling note: the app runs with `.dark` on <html> by default, so semantic
 * tokens (bg-background / text-foreground / bg-surface) resolve to DARK values.
 * The visible product chrome is built from EXPLICIT light classes (bg-white,
 * zinc text, brand-blue accent). This banner matches that so it stays a white card
 * on the white UI regardless of theme. The blue comes from the brand token
 * (--os-brand via text-brand), which every host that mounts the banner defines:
 * .mk-tokens on marketing, .workwrk-auth on the sign-in pages, :root in the app.
 *
 * NO FILLED BUTTON, on purpose. Every page the banner sits on already has its
 * one blue primary (Start free, Log in, Create workspace, Set password), and a
 * blue "Accept all" made a second one in the same viewport. OPT_IN_STRICT also
 * asks for Reject and Accept at equal prominence, which a filled Accept is not.
 *
 * ON A PHONE it must not sit on the form. At 375x667 the old card ran from
 * y=373 to 651 and covered Log in and "Forgot your password?", so a person had
 * to answer the banner before they could sign in. Below sm it drops the icon
 * tile, uses the short body copy and puts the buttons in one h-8 row, and on
 * the signed-out hosts it reserves its own height at the bottom of the page
 * (see useReserveSpace) so whatever it still overlaps can be scrolled clear.
 */
const BTN_SECONDARY =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-base font-medium text-zinc-700 hover:bg-zinc-50 sm:h-9 sm:px-3.5";
const LINK = "font-medium text-brand underline underline-offset-2 hover:text-brand-hover";

/**
 * While the banner shows on a signed-out host, pad the bottom of <body> by
 * the banner's height, so the last thing on the page (a Log in button pushed
 * down by an error line, the footer links) can always be scrolled above the
 * fixed card instead of being stuck under it. The app frame is left alone: it
 * is a fixed-height shell, and padding its body would add a page scroll
 * behind the reopened preferences card. The previous inline value is put back
 * when the banner closes.
 */
function useReserveSpace(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === "undefined") return;
    if (!el.closest(".workwrk-auth, .mk-tokens")) return;
    const body = document.body;
    const previous = body.style.paddingBottom;
    const apply = () => {
      body.style.paddingBottom = `${Math.ceil(el.getBoundingClientRect().height)}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      body.style.paddingBottom = previous;
    };
  }, [active]);
  return ref;
}

export function ConsentBanner() {
  const { geo, showBanner, accept, acceptAll, rejectAll } = useConsent();
  const [showDetails, setShowDetails] = useState(false);
  const [prefs, setPrefs] = useState<ConsentState>({
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false,
    doNotSell: false,
  });

  const reserveRef = useReserveSpace(showBanner && !!geo);

  if (!showBanner || !geo) return null;

  const regime = geo.regime;
  const isStrict = regime === "OPT_IN_STRICT";
  const isOptOut = regime === "OPT_OUT";

  return (
    <div ref={reserveRef} className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] px-4 pb-4">
      {/* The height cap keeps the taller preferences panel's buttons on
          screen on a short phone: the card scrolls inside itself instead. */}
      <div className="pointer-events-auto mx-auto max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.30)] sm:p-5">
        {!showDetails ? (
          <>
            <div className="flex items-start gap-3.5">
              <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand sm:flex">
                <Shield size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold tracking-[-0.01em] text-zinc-900">
                  {isStrict
                    ? "Your cookie choices"
                    : isOptOut
                      ? "Your privacy choices"
                      : "Cookie notice"}
                </p>
                <p className="mt-1 text-base text-zinc-500 sm:mt-1.5 sm:leading-relaxed">
                  {/* Same promise, two lengths: the short one keeps the card
                      off the sign-in form on a phone. */}
                  <span className="sm:hidden">
                    Essential cookies run the site. Optional ones only with your permission.
                  </span>
                  <span className="hidden sm:inline">
                    We use essential cookies to run the site. With your permission we also
                    remember your preferences. Nothing else: no analytics, no advertising.
                  </span>{" "}
                  <Link href="/cookies" className={LINK}>
                    Cookie policy
                  </Link>{" "}
                  ·{" "}
                  <Link href="/privacy" className={LINK}>
                    Privacy policy
                  </Link>
                  {isOptOut && (
                    <>
                      {" "}·{" "}
                      <Link href="/do-not-sell" className={LINK}>
                        Do Not Sell or Share My Personal Information
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setShowDetails(true)}>
                <Settings2 className="h-3.5 w-3.5" /> Customize
              </button>
              {isStrict && (
                <button type="button" className={BTN_SECONDARY} onClick={rejectAll}>
                  Reject all
                </button>
              )}
              <button type="button" className={`${BTN_SECONDARY} ml-auto`} onClick={acceptAll}>
                {isStrict ? "Accept all" : "Got it"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3.5 flex items-center justify-between">
              <p className="text-base font-semibold tracking-[-0.01em] text-zinc-900">
                Manage cookie preferences
              </p>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                aria-label="Close details"
                className="inline-flex rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <Row
                title="Strictly necessary"
                description="Required for the site to work: login, security, language/currency preference. Cannot be disabled."
                checked
                disabled
              />
              <Row
                title="Preferences"
                description="Remember UI choices like theme, list layout, and dismissed tooltips."
                checked={prefs.preferences}
                onChange={(v) => setPrefs({ ...prefs, preferences: v })}
              />
              {/* No Analytics or Marketing rows: the site sets neither kind of
                  cookie (/cookies section 4), so there is nothing to agree to. */}
            </div>
            {/* Below sm the three buttons do not fit one row, so Reject all
                and Accept all split the first row evenly (equal prominence)
                and Save preferences takes the full second row. From sm up it
                is the one row it always was. */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                className={`${BTN_SECONDARY} flex-1 justify-center sm:flex-none`}
                onClick={rejectAll}
              >
                Reject all
              </button>
              <button
                type="button"
                className={`${BTN_SECONDARY} order-last w-full justify-center sm:order-none sm:ml-auto sm:w-auto`}
                onClick={() => accept(prefs)}
              >
                Save preferences
              </button>
              <button
                type="button"
                className={`${BTN_SECONDARY} flex-1 justify-center sm:flex-none`}
                onClick={acceptAll}
              >
                Accept all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${
        disabled ? "opacity-70" : "cursor-pointer hover:bg-zinc-100"
      }`}
    >
      <div className="flex-1">
        <p className="text-xs font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 h-4 w-4"
        style={{ accentColor: "var(--os-brand)" }}
      />
    </label>
  );
}
