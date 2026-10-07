"use client";

// One group chat in the list (docs/plans/ai-teammates-phase2.md step 4): the
// 56px two-line row of teammate-row.tsx, with the group's stacked avatars for
// the tile. Line 1 the name (15/500) and when it last moved; line 2 what was
// said last ("Triage: Two are late."), else its teammates' names, then the
// "Waiting" chip when something in it waits for the person, else the unread
// dot. The open group's row is bg-active.

import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { TEAMMATE_CHIPS, TEAMMATE_LIST, titleList } from "@/lib/agents/teammate-copy";
import type { GroupRow as GroupRowData } from "@/lib/agents/teammate-thread";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";
import { StackedAvatars } from "./stacked-avatars";

export function GroupRow({ group: g, active, onSelect }: { group: GroupRowData; active: boolean; onSelect: (id: string) => void }) {
  const datePrefs = useDatePrefs();
  return (
    <button
      type="button"
      onClick={() => onSelect(g.id)}
      aria-current={active ? "true" : undefined}
      className={cn("flex h-14 w-full min-w-0 items-center gap-3 px-3 text-start", active ? "bg-active" : "hover:bg-hover")}
    >
      <StackedAvatars members={g.members} variant="row" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{g.name}</span>
          {g.lastAt ? (
            <span className="shrink-0 text-xs font-medium text-ink-2" title={formatDateTitle(g.lastAt, datePrefs)}>
              {formatDate(g.lastAt, datePrefs, "smart")}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{g.lastLine ?? titleList(g.members.map((m) => m.name))}</span>
          {g.waiting > 0 ? (
            <StatusChip color={RUN_TONE_COLOR.warning} label={TEAMMATE_CHIPS.waiting} className="shrink-0" />
          ) : g.unread ? (
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
