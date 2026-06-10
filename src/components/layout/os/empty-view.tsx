"use client";

import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { BloomMark } from "./bloom-mark";

export function OsEmptyView({
  Icon,
  iconGradient,
  title,
  subtitle,
  chips = [],
  cta,
  onCta,
  hideCta = false,
}: {
  Icon: LucideIcon;
  iconGradient: string;
  title: string;
  subtitle: string;
  chips?: string[];
  cta?: string;
  /** Click handler for the CTA. When omitted the button still renders
   *  (legacy behavior) but does nothing — pass this to make it live. */
  onCta?: () => void;
  /** Hide the CTA entirely (e.g. read-only surfaces). */
  hideCta?: boolean;
}) {
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
      {hideCta ? null : (
        <button type="button" className="os-empty__cta" onClick={onCta}>
          <Plus />
          <span>{cta ?? "Get started"}</span>
        </button>
      )}
    </div>
  );
}

export function OsAiPreviewView({
  Icon,
  iconGradient,
  title,
  subtitle,
}: {
  Icon: LucideIcon;
  iconGradient: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="os-empty">
      <div className="os-empty__art" style={{ background: iconGradient }}>
        <Icon />
      </div>
      <h2 className="os-empty__title">{title}</h2>
      <p className="os-empty__sub">{subtitle}</p>
      <button type="button" className="os-empty__cta">
        <BloomMark size={14} />
        <span>Ask Sidekick</span>
      </button>
    </div>
  );
}
