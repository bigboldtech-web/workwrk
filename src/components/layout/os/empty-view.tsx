"use client";

import type { LucideIcon } from "lucide-react";
import { Plus, Sparkles } from "lucide-react";

export function OsEmptyView({
  Icon,
  iconGradient,
  title,
  subtitle,
  chips = [],
  cta,
}: {
  Icon: LucideIcon;
  iconGradient: string;
  title: string;
  subtitle: string;
  chips?: string[];
  cta?: string;
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
      <button type="button" className="os-empty__cta">
        <Plus />
        <span>{cta ?? "Get started"}</span>
      </button>
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
        <Sparkles />
        <span>Ask Sidekick</span>
      </button>
    </div>
  );
}
