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
    <div className="consent-wrap">
      <div className="consent-card">
        {!showDetails ? (
          <div className="consent-inner">
            <div className="consent-row">
              <div className="consent-icon-wrap">
                <Shield size={18} />
              </div>
              <div className="consent-text">
                <p className="consent-title">
                  {isStrict
                    ? "We use cookies — your choice"
                    : isOptOut
                      ? "Your privacy choices"
                      : "Cookie notice"}
                </p>
                <p className="consent-body">
                  We use essential cookies to run the site. With your permission we also use
                  optional cookies for preferences, analytics, and marketing.{" "}
                  <Link href="/cookies" className="consent-link">
                    Cookie policy
                  </Link>{" "}
                  ·{" "}
                  <Link href="/privacy" className="consent-link">
                    Privacy policy
                  </Link>
                  {isOptOut && (
                    <>
                      {" "}·{" "}
                      <Link href="/do-not-sell" className="consent-link">
                        Do Not Sell or Share My Personal Information
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="consent-actions">
              <button
                type="button"
                className="consent-btn consent-btn-ghost"
                onClick={() => setShowDetails(true)}
              >
                <Settings2 size={14} /> Customize
              </button>
              {isStrict && (
                <button
                  type="button"
                  className="consent-btn consent-btn-ghost"
                  onClick={rejectAll}
                >
                  Reject all
                </button>
              )}
              <button
                type="button"
                className="consent-btn consent-btn-lime consent-push"
                onClick={acceptAll}
              >
                {isStrict ? "Accept all" : "Got it"}
              </button>
            </div>
          </div>
        ) : (
          <div className="consent-inner">
            <div className="consent-details-head">
              <p className="consent-title">Manage cookie preferences</p>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="consent-close"
                aria-label="Close details"
              >
                <X size={16} />
              </button>
            </div>
            <div className="consent-rows">
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
            <div className="consent-actions">
              <button
                type="button"
                className="consent-btn consent-btn-ghost"
                onClick={rejectAll}
              >
                Reject all
              </button>
              <button
                type="button"
                className="consent-btn consent-btn-ghost consent-push"
                onClick={() => accept(prefs)}
              >
                Save preferences
              </button>
              <button
                type="button"
                className="consent-btn consent-btn-lime"
                onClick={acceptAll}
              >
                Accept all
              </button>
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .consent-wrap {
          position: fixed;
          inset: auto 0 0 0;
          z-index: 100;
          padding: 0 16px 16px;
          pointer-events: none;
        }
        .consent-card {
          pointer-events: auto;
          margin: 0 auto;
          max-width: 780px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(15, 15, 15, 0.92);
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
          box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.65),
            0 0 0 1px rgba(255, 255, 255, 0.02) inset;
          color: #fafafa;
          font-family: var(--font-geist), -apple-system, system-ui, sans-serif;
        }
        .consent-inner {
          padding: 22px 24px;
        }
        .consent-row {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }
        .consent-icon-wrap {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(212, 255, 46, 0.1);
          color: #d4ff2e;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(212, 255, 46, 0.2);
        }
        .consent-text {
          flex: 1;
          min-width: 0;
        }
        .consent-title {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
          color: #fafafa;
        }
        .consent-body {
          font-size: 13px;
          color: #a0a0a0;
          line-height: 1.55;
          margin: 0;
        }
        .consent-link {
          color: #d4ff2e;
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-thickness: 1px;
        }
        .consent-link:hover {
          color: #fafafa;
        }
        .consent-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 18px;
          align-items: center;
        }
        .consent-push {
          margin-left: auto;
        }
        .consent-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: 100px;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
          border: 1px solid transparent;
          white-space: nowrap;
        }
        .consent-btn-ghost {
          background: transparent;
          color: #ededed;
          border-color: rgba(255, 255, 255, 0.14);
        }
        .consent-btn-ghost:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.22);
        }
        .consent-btn-lime {
          background: #d4ff2e;
          color: #0a0a0a;
          border-color: #d4ff2e;
          box-shadow: 0 0 20px rgba(212, 255, 46, 0.22);
        }
        .consent-btn-lime:hover {
          background: #e0ff4a;
          transform: translateY(-1px);
        }
        .consent-details-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .consent-close {
          background: transparent;
          border: 0;
          color: #8a8a8a;
          padding: 4px;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
        }
        .consent-close:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #fafafa;
        }
        .consent-rows {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        @media (max-width: 620px) {
          .consent-actions {
            flex-direction: column;
            align-items: stretch;
          }
          .consent-push {
            margin-left: 0;
          }
          .consent-btn {
            justify-content: center;
          }
        }
      `}</style>
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
        className="mt-1 h-4 w-4 accent-[#d4ff2e]"
      />
    </label>
  );
}
