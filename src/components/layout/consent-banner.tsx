"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 */
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
    <div className="fixed inset-x-0 bottom-0 z-[100] px-4 pb-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl">
        {!showDetails ? (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/10 text-purple-400">
                <Shield size={18} />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-semibold">
                  {isStrict
                    ? "We use cookies — your choice"
                    : isOptOut
                      ? "Your privacy choices"
                      : "Cookie notice"}
                </p>
                <p className="text-xs text-muted leading-relaxed">
                  We use essential cookies to run the site. With your permission we also use
                  optional cookies for preferences, analytics, and marketing.{" "}
                  <Link href="/cookies" className="underline hover:text-foreground">
                    Cookie policy
                  </Link>{" "}
                  ·{" "}
                  <Link href="/privacy" className="underline hover:text-foreground">
                    Privacy policy
                  </Link>
                  {isOptOut && (
                    <>
                      {" "}·{" "}
                      <Link href="/do-not-sell" className="underline hover:text-foreground">
                        Do Not Sell or Share My Personal Information
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDetails(true)}
                className="gap-1.5"
              >
                <Settings2 size={14} /> Customize
              </Button>
              {isStrict && (
                <Button variant="outline" size="sm" onClick={rejectAll}>
                  Reject all
                </Button>
              )}
              <Button size="sm" onClick={acceptAll} className="ml-auto">
                {isStrict ? "Accept all" : "Got it"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Manage cookie preferences</p>
              <button
                onClick={() => setShowDetails(false)}
                className="rounded-md p-1 text-muted hover:bg-surface-2"
                aria-label="Close details"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
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
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={rejectAll}>
                Reject all
              </Button>
              <Button
                size="sm"
                onClick={() => accept(prefs)}
                className="ml-auto"
              >
                Save preferences
              </Button>
              <Button size="sm" onClick={acceptAll}>
                Accept all
              </Button>
            </div>
          </div>
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
      className={`flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-3 ${
        disabled ? "opacity-70" : "cursor-pointer hover:bg-surface-2"
      }`}
    >
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 h-4 w-4 accent-purple-500"
      />
    </label>
  );
}
