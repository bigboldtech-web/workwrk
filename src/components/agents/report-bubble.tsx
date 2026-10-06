"use client";

// A routine's report in a teammate's chat (docs/plans/ai-teammates.md 5.2,
// 5.6): the teammate's avatar, then a bordered card. Its header names the
// routine and the slot it ran for ("{routine} · {time}"); the tool rows of
// what it did; the report's first lines (teammate-thread.ts reportLines),
// with "And {n} more" opening the rest. A practice run says so.

import { useState } from "react";
import { OsMarkdown } from "@/components/layout/os/markdown";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { TEAMMATE_CHAT, andMore, reportHeader } from "@/lib/agents/teammate-copy";
import { reportLines, type TeammateMessageView } from "@/lib/agents/teammate-thread";
import type { TeammateHue } from "@/lib/agents/hues";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { TeammateAvatar } from "./teammate-avatar";

export function ReportBubble({
  m,
  teammate,
}: {
  m: Extract<TeammateMessageView, { kind: "report" }>;
  teammate: { name: string; hue: TeammateHue | null; avatar: string | null };
}) {
  const datePrefs = useDatePrefs();
  const [all, setAll] = useState(false);
  const at = m.routine.dueAt ?? m.createdAt;
  const { lines, more } = reportLines(m.text);
  const text = all || more === 0 ? m.text : lines.join("\n");
  return (
    <div className="flex gap-3">
      <TeammateAvatar name={teammate.name} hue={teammate.hue} avatar={teammate.avatar} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 rounded-lg border border-line bg-raised p-3">
        <p className="text-sm font-medium text-ink-2" title={formatDateTitle(at, datePrefs)}>
          {reportHeader(m.routine.name, formatDate(at, datePrefs, "smart"))}
        </p>
        {m.toolCalls.length > 0 ? (
          <div className="mt-1 flex flex-col">
            {m.toolCalls.map((c, i) => (
              <ToolCallRow key={i} name={c.name} input={c.input} failed={c.failed} pending={c.pending} outcome={c.outcome} durationMs={c.durationMs} />
            ))}
          </div>
        ) : null}
        {text ? (
          <div className="mt-1 text-prose text-ink">
            <OsMarkdown text={text} />
          </div>
        ) : null}
        {more > 0 && !all ? (
          <button type="button" onClick={() => setAll(true)} className="mt-1 text-sm font-medium text-brand-deep hover:underline">
            {andMore(more)}
          </button>
        ) : null}
        {m.practice ? <p className="mt-2 text-xs text-ink-2">{TEAMMATE_CHAT.practiceFooter}</p> : null}
      </div>
    </div>
  );
}
