"use client";

// One teammate in the list (docs/plans/ai-teammates.md 5.2): a 56px button,
// the founder's two-line row (a deliberate exception to the one-line row
// rule). The 36px tile in the teammate's hue; line 1 the name (15/500) and,
// at the right, when its chat last moved (12/500 ink-2); line 2 what was said
// last (13/400 ink-2, one line), else its job, then what needs the person:
// the pale "Waiting" chip when something waits for their approval, "Paused"
// or "Removed" when it cannot answer, else the 6px unread dot when it
// answered or reported since they last read it. The open chat's row is
// bg-active.

import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { TEAMMATE_CHIPS, TEAMMATE_LIST } from "@/lib/agents/teammate-copy";
import type { TeammateRow as TeammateRowData } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";
import { TeammateAvatar } from "./teammate-avatar";

export function TeammateRow({ teammate: t, active, onSelect }: { teammate: TeammateRowData; active: boolean; onSelect: (slug: string) => void }) {
  const datePrefs = useDatePrefs();
  const state = t.status === "ARCHIVED" ? TEAMMATE_CHIPS.removed : t.status === "DISABLED" ? TEAMMATE_CHIPS.paused : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(t.slug)}
      aria-current={active ? "true" : undefined}
      className={cn("flex h-14 w-full min-w-0 items-center gap-3 px-3 text-start", active ? "bg-active" : "hover:bg-hover")}
    >
      <TeammateAvatar name={t.name} hue={t.hue} avatar={t.avatar} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{t.name}</span>
          {t.lastAt ? (
            <span className="shrink-0 text-xs font-medium text-ink-2" title={formatDateTitle(t.lastAt, datePrefs)}>
              {formatDate(t.lastAt, datePrefs, "smart")}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t.lastLine ?? t.job}</span>
          {t.waiting > 0 ? (
            <StatusChip color={RUN_TONE_COLOR.warning} label={TEAMMATE_CHIPS.waiting} className="shrink-0" />
          ) : state ? (
            <StatusChip color={RUN_TONE_COLOR.neutral} label={state} className="shrink-0" />
          ) : t.unread ? (
            <>
              <Dots variant="unread" />
              <span className="sr-only">{TEAMMATE_LIST.unread}</span>
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
