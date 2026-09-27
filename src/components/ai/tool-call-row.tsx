"use client";

// One tool call, wherever a run is read: the Ask AI thread and the agent run
// detail (spec-ai-automation section 3). A 36px row: the concept's own icon,
// a past-tense sentence with the real subject ("Created task \"Fix invoice
// PDF\""), the created object as a link when the tool returned its id, and
// the duration after a middle dot. A failed call reads "Couldn't create the
// task" in the danger text with the server's own message on a second line.
//
// The words come from src/lib/agents/tool-verbs.ts, which is typed against
// the 28 tools the assistant can run, so a call never prints its code name
// or its raw input.

import Link from "next/link";
import {
  CheckSquare, FileText, ClipboardList, Table2, ScrollText, Trophy, Target, Gauge,
  CalendarClock, FileSignature, Timer, UserPlus, Heart, LayoutGrid, NotebookPen, Users, Search,
  type LucideIcon,
} from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { toolOutcomeSentence, toolSentence, type ToolConcept, type ToolOutcome } from "@/lib/agents/tool-verbs";
import { formatDuration } from "@/lib/format/duration";

const CONCEPT_ICON: Record<ToolConcept, LucideIcon> = {
  task: CheckSquare,
  doc: FileText,
  form: ClipboardList,
  table: Table2,
  sop: ScrollText,
  goal: Trophy,
  kra: Target,
  kpi: Gauge,
  meeting: CalendarClock,
  contract: FileSignature,
  sprint: Timer,
  person: UserPlus,
  kudos: Heart,
  workspace: LayoutGrid,
  review: NotebookPen,
  team: Users,
  search: Search,
};

export function ToolCallRow({
  name,
  input,
  failed = false,
  pending = false,
  outcome = null,
  durationMs = null,
}: {
  name: string;
  input?: Record<string, unknown> | null;
  /** From the live stream, before the saved outcome arrives. */
  failed?: boolean;
  pending?: boolean;
  /** From the saved call log: the count, the link, the server's message. */
  outcome?: ToolOutcome | null;
  durationMs?: number | null;
}) {
  const isFailed = outcome ? outcome.failed : failed;
  const { concept, text } = outcome ? toolOutcomeSentence(name, input, outcome) : toolSentence(name, input, isFailed);
  const Icon = CONCEPT_ICON[concept];
  const took = formatDuration(durationMs);
  return (
    <div
      className={`flex min-h-9 items-start gap-2 py-2 text-sm ${isFailed ? "text-danger-text" : "text-ink-2"}`}
      aria-busy={pending || undefined}
    >
      <Icon className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {outcome?.href && !isFailed ? (
            <Link href={outcome.href} className="min-w-0 truncate text-ink hover:underline">{text}</Link>
          ) : (
            <span className="min-w-0 truncate">{text}</span>
          )}
          {pending ? <Dots variant="pending" label="Running" /> : null}
          {took && !pending ? <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">· {took}</span> : null}
        </div>
        {isFailed && outcome?.message ? <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{outcome.message}</div> : null}
      </div>
    </div>
  );
}
