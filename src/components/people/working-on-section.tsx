"use client";

// "Working on" on a person's record (Overview tab), for the people who
// manage them: their open items, newest due first, each opening the task
// drawer (spec-teams-people /team, the "+2" on a My team row). Items come
// only from Lists the viewer can read (GET /api/team/person-work).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

interface WorkRow { id: string; title: string; status: string | null; priority: string | null; dueAt: string | null; board: { id: string; name: string } }

export function WorkingOnSection({ userId }: { userId: string }) {
  const datePrefs = useDatePrefs();
  const [data, setData] = useState<{ items: WorkRow[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await apiFetch<{ items: WorkRow[]; total: number }>(`/api/team/person-work?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    if (!r.ok) { setFailed(true); return; }
    setFailed(false);
    setData(r.data);
  }, [userId]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  return (
    <section className="flex flex-col gap-2" id="working-on">
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">Working on</h3>
        {data ? <span className="text-xs font-medium text-ink-2 tabular-nums">{data.total}</span> : null}
      </div>
      {failed ? (
        <OsEmptyView variant="error" title="Couldn't load their work" action={{ label: "Try again", onClick: () => void load() }} compact />
      ) : !data ? (
        <SkeletonRows rows={3} />
      ) : data.items.length === 0 ? (
        <p className="text-row text-ink-2">No open work on Lists you can see.</p>
      ) : (
        <ul className="os-chrome divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-raised">
          {data.items.map((it) => (
            <li key={it.id}>
              <Link href={`/item/${it.id}`} className="flex h-9 items-center gap-2 px-3 text-sm hover:bg-hover">
                <span className="min-w-0 flex-1 truncate text-ink">{it.title}</span>
                {it.priority && it.priority !== "none" ? <Flag className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-label={`Priority ${it.priority}`} /> : null}
                <span className="hidden max-w-[140px] truncate text-ink-2 sm:inline">{it.board.name}</span>
                <span className="w-16 shrink-0 text-end tabular-nums text-ink-2">{it.dueAt ? formatDate(it.dueAt, datePrefs, "date") : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length ? <p className="text-sm text-ink-2">Showing the first {data.items.length} of {data.total}, soonest due first.</p> : null}
    </section>
  );
}
