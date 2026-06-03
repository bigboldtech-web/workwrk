"use client";

// OsTitleBar — page header used across most legacy pages.
// Rebuilt 2026-06-03 to match the ClickUp aesthetic: white background,
// star + title on the left, page actions on the right. No more
// hue-gradient icon block.
//
// Props kept compatible with the old API so all consuming pages keep
// working without per-page edits. `Icon` and `iconGradient` are
// accepted but no longer rendered as a gradient block — we just show
// a small star with the title.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Star, UserPlus, Share2 } from "lucide-react";
import { BloomMark } from "./bloom-mark";

export type Person = { initials: string; color: string };

export type TitleBarProps = {
  title: string;
  Icon: LucideIcon;
  iconGradient: string; // legacy — ignored
  description?: string;
  people?: Person[];
  morePeople?: number;
  /** Page-specific action buttons rendered to the right of the title.
   *  Pages should pass their own CTAs here (e.g. "New deal", "Import CSV").
   *  When omitted, only the standard Ask AI / Share / Invite trio renders. */
  actions?: ReactNode;
  /** Hide the universal "Invite" button on pages where it doesn't fit
   *  (e.g. Settings, Account). Default: true. */
  showInvite?: boolean;
  starred?: boolean;
};

export function OsTitleBar({
  title,
  Icon: _Icon,
  iconGradient: _iconGradient,
  description,
  people = [],
  morePeople = 0,
  actions,
  showInvite = true,
  starred = true,
}: TitleBarProps) {
  // Suppress unused-prop warnings — they're part of the legacy API.
  void _Icon;
  void _iconGradient;
  return (
    <div className="px-6 pt-4 pb-3 bg-white">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-2 min-w-0">
          {starred ? (
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          ) : null}
          <span className="truncate">{title}</span>
        </h1>
        {description ? (
          <span className="text-xs text-zinc-500 truncate max-w-[480px]">{description}</span>
        ) : null}
        <div className="flex-1" />
        {people.length > 0 ? (
          <div className="flex items-center -space-x-1.5 mr-1">
            {people.slice(0, 3).map((p, i) => (
              <span
                key={i}
                className="w-6 h-6 rounded-full border-2 border-white text-[10px] font-semibold text-white flex items-center justify-center"
                style={{ background: p.color }}
              >
                {p.initials}
              </span>
            ))}
            {morePeople > 0 ? (
              <span className="w-6 h-6 rounded-full border-2 border-white bg-zinc-100 text-[10px] font-medium text-zinc-700 flex items-center justify-center">
                +{morePeople}
              </span>
            ) : null}
          </div>
        ) : null}
        {actions}
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <BloomMark size={14} />
          Ask AI
        </button>
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
        {showInvite ? (
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite
          </button>
        ) : null}
      </div>
    </div>
  );
}
