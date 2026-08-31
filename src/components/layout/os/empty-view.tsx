"use client";

import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { BloomMark } from "./bloom-mark";

/** Open the AI Sidekick from anywhere without threading useOsShell through a
 *  presentational component — the shell listens for this event. */
export function askSidekick(prompt?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:os:ask-sidekick", { detail: { prompt } }));
}

export function OsEmptyView({
  Icon,
  iconGradient,
  title,
  subtitle,
  chips = [],
  cta,
  onCta,
  ctaHref,
  hideCta = false,
}: {
  Icon: LucideIcon;
  iconGradient: string;
  title: string;
  subtitle: string;
  chips?: string[];
  cta?: string;
  /** Click handler for the CTA. */
  onCta?: () => void;
  /** Navigation target for the CTA (rendered as a link). */
  ctaHref?: string;
  /** Force-hide the CTA (e.g. read-only surfaces). */
  hideCta?: boolean;
}) {
  // A CTA renders ONLY when it actually does something — no more buttons that
  // look real but silently do nothing.
  const showCta = !hideCta && !!cta && (!!onCta || !!ctaHref);
  return (
    <div className="os-empty">
      <div className="os-empty__art" style={{ background: iconGradient }}>
        <Icon />
      </div>
      <h2 className="os-empty__title">{title}</h2>
      <p className="os-empty__sub">{subtitle}</p>
      {chips.length > 0 ? (
        <div className="os-empty__chips">
          {chips.map((c) => (
            <span key={c} className="os-empty__chip">{c}</span>
          ))}
        </div>
      ) : null}
      {showCta ? (
        ctaHref ? (
          <a href={ctaHref} className="os-empty__cta">
            <Plus />
            <span>{cta}</span>
          </a>
        ) : (
          <button type="button" className="os-empty__cta" onClick={onCta}>
            <Plus />
            <span>{cta}</span>
          </button>
        )
      ) : null}
    </div>
  );
}

export function OsAiPreviewView({
  Icon,
  iconGradient,
  title,
  subtitle,
  prompt,
}: {
  Icon: LucideIcon;
  iconGradient: string;
  title: string;
  subtitle: string;
  /** Optional starter question sent to the Sidekick when opened. */
  prompt?: string;
}) {
  return (
    <div className="os-empty">
      <div className="os-empty__art" style={{ background: iconGradient }}>
        <Icon />
      </div>
      <h2 className="os-empty__title">{title}</h2>
      <p className="os-empty__sub">{subtitle}</p>
      <button type="button" className="os-empty__cta" onClick={() => askSidekick(prompt)}>
        <BloomMark size={14} />
        <span>Ask Sidekick</span>
      </button>
    </div>
  );
}
