"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Settings2, X } from "lucide-react";
import { useConsent } from "./consent-provider";
import type { ConsentState } from "@/lib/compliance/consent-client";

/**
 * Geo-aware cookie consent banner.
 *
 * Regime behaviour:
 *  - OPT_IN_STRICT (EU/UK/BR/IN/CN/KR/…): Reject-all and Accept-all given equal
 *    prominence. No pre-ticked non-essential categories. Banner blocks interaction
 *    until decision.
 *  - OPT_OUT (CA/CO/VA/CT/…): Non-essential on by default, "Do Not Sell/Share"
 *    button prominent.
 *  - NOTICE_ONLY (US non-covered, ROW): Simple dismissible notice.
 *
 * Styling note: the app runs with `.dark` on <html> by default, so semantic
 * tokens (bg-background / text-foreground / bg-surface) resolve to DARK values.
 * The visible product chrome is built from EXPLICIT light classes (bg-white,
 * zinc text, violet accent) — this banner matches that so it stays a white card
 * on the white UI regardless of theme.
 */
const BTN_SECONDARY =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3.5 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50";
const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500";
const LINK = "font-medium text-violet-600 underline underline-offset-2 hover:text-violet-700";

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

  if (!showBanner || !geo) return null;

  const regime = geo.regime;
  const isStrict = regime === "OPT_IN_STRICT";
  const isOptOut = regime === "OPT_OUT";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] px-4 pb-4">
      <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.30)]">
        {!showDetails ? (
          <>
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                <Shield size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900">
                  {isStrict
                    ? "We use cookies — your choice"
                    : isOptOut
                      ? "Your privacy choices"
                      : "Cookie notice"}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
                  We use essential cookies to run the site. With your permission we also use
                  optional cookies for preferences, analytics, and marketing.{" "}
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

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setShowDetails(true)}>
                <Settings2 className="h-3.5 w-3.5" /> Customize
              </button>
              {isStrict && (
                <button type="button" className={BTN_SECONDARY} onClick={rejectAll}>
                  Reject all
                </button>
              )}
              <button type="button" className={`${BTN_PRIMARY} ml-auto`} onClick={acceptAll}>
                {isStrict ? "Accept all" : "Got it"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3.5 flex items-center justify-between">
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900">
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
                description="Required for the site to work — login, security, language/currency preference. Cannot be disabled."
                checked
                disabled
              />
              <Row
                title="Preferences"
                description="Remember UI choices like theme, list layout, and dismissed tooltips."
                checked={prefs.preferences}
                onChange={(v) => setPrefs({ ...prefs, preferences: v })}
              />
              <Row
                title="Analytics"
                description="Help us understand how the product is used so we can improve it. No personally identifiable data is sent to third parties without your consent."
                checked={prefs.analytics}
                onChange={(v) => setPrefs({ ...prefs, analytics: v })}
              />
              <Row
                title="Marketing"
                description="Used to measure ad performance and show relevant product updates. Off by default."
                checked={prefs.marketing}
                onChange={(v) => setPrefs({ ...prefs, marketing: v })}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={rejectAll}>
                Reject all
              </button>
              <button type="button" className={`${BTN_SECONDARY} ml-auto`} onClick={() => accept(prefs)}>
                Save preferences
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={acceptAll}>
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
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 h-4 w-4"
        style={{ accentColor: "#7c3aed" }}
      />
    </label>
  );
}
