// AttentionQueue (spec-teams-people section 3): the "Needs your attention"
// card on My team. One 44px row per non-zero count: a 16px glyph, the
// sentence with the count in bold, an arrow. Renders NOTHING when every
// count is zero; the absence is the message.

import Link from "next/link";
import { ArrowRight, CalendarCheck, ClipboardCheck, Target } from "lucide-react";
import type { AttentionRow } from "@/lib/people/team-work";

const ICON = { weekly: CalendarCheck, kpi: ClipboardCheck, nokras: Target } as const;

export function AttentionQueue({ rows }: { rows: AttentionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="attention-title" className="os-chrome overflow-hidden rounded-lg border border-line bg-raised">
      <h2 id="attention-title" className="m-0 px-4 pb-1 pt-3 text-base font-semibold text-ink">Needs your attention</h2>
      <ul className="divide-y divide-line-soft">
        {rows.map((r) => {
          const Icon = ICON[r.key];
          return (
            <li key={r.key}>
              <Link href={r.href} className="group flex h-11 items-center gap-3 px-4 text-row text-ink hover:bg-hover">
                <Icon className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
                <span className="min-w-0 flex-1 truncate"><span className="font-semibold tabular-nums">{r.count}</span> {r.sentence}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 group-hover:text-ink-2" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
