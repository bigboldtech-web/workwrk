"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Star, UserPlus } from "lucide-react";

export type Person = { initials: string; color: string };

export type TitleBarProps = {
  title: string;
  Icon: LucideIcon;
  iconGradient: string; // CSS background value
  description?: string;
  people?: Person[];
  morePeople?: number;
  /** Page-specific action buttons rendered to the right of the people stack.
   *  Pages should pass their own CTAs here (e.g. "New deal", "Import CSV").
   *  When omitted, only the universal "Invite" button shows. */
  actions?: ReactNode;
  /** Hide the universal "Invite" button on pages where it doesn't fit
   *  (e.g. Settings, Account). Default: true. */
  showInvite?: boolean;
  starred?: boolean;
};

export function OsTitleBar({
  title,
  Icon,
  iconGradient,
  description,
  people = [],
  morePeople = 0,
  actions,
  showInvite = true,
  starred = true,
}: TitleBarProps) {
  return (
    <div className="os-title-bar">
      <div className="os-title-bar__icon" style={{ background: iconGradient }}>
        <Icon />
      </div>
      <div className="os-title-bar__main">
        <span className="os-title-bar__name">{title}</span>
        {starred ? (
          <button type="button" className="os-title-bar__star" aria-label="Unstar">
            <Star />
          </button>
        ) : null}
      </div>
      {description ? <span className="os-title-bar__desc">{description}</span> : null}
      <div className="os-title-bar__spacer" />
      {people.length > 0 ? (
        <div className="os-title-bar__people">
          {people.slice(0, 3).map((p, i) => (
            <span key={i} className="os-title-bar__people-av" style={{ background: p.color }}>
              {p.initials}
            </span>
          ))}
          {morePeople > 0 ? <span className="os-title-bar__people-more">+{morePeople}</span> : null}
        </div>
      ) : null}
      {actions}
      {showInvite ? (
        <button type="button" className="os-title-bar__btn os-title-bar__btn--invite">
          <UserPlus />
          <span>Invite</span>
        </button>
      ) : null}
    </div>
  );
}
