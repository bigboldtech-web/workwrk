"use client";

// PlannerSidePanel — the left rail of the Planner (ClickUp parity). Priorities,
// a "Meet with" people picker, and collapsible Assigned-to-me / Today & overdue
// / Backlog lists sourced from /api/me/work. Dragging a task onto the grid is a
// later phase; for now clicking a task opens it.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Plus, ChevronRight, ChevronDown, Loader2, Search } from "lucide-react";

interface WorkItem { id: string; title: string; status: string | null; dueAt: string | null; priority: string | null; board: string | null; url: string }
interface Buckets { today: WorkItem[]; overdue: WorkItem[]; next: WorkItem[]; unscheduled: WorkItem[]; done: WorkItem[] }
interface Person { id: string; firstName?: string | null; lastName?: string | null; email: string; avatar?: string | null }

function personName(p: Person) { return [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email; }
function personInitials(p: Person) { return ((p.firstName?.[0] ?? "") + (p.lastName?.[0] ?? "") || p.email[0] || "?").toUpperCase(); }

export function PlannerSidePanel({ onCreated, autoFocusMeet }: { onCreated: () => void; autoFocusMeet?: boolean }) {
  const router = useRouter();
  const [buckets, setBuckets] = useState<Buckets | null>(null);

  useEffect(() => {
    fetch("/api/me/work")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { buckets?: Buckets } | null) => { if (d?.buckets) setBuckets(d.buckets); })
      .catch(() => {});
  }, []);

  const todayOverdue = buckets ? [...buckets.overdue, ...buckets.today] : [];
  const assigned = buckets ? [...buckets.overdue, ...buckets.today, ...buckets.next] : [];
  const backlog = buckets?.unscheduled ?? [];

  return (
    <aside className="w-[256px] shrink-0 border-r border-zinc-200 dark:border-[#2A2F38] overflow-y-auto px-3 py-3 space-y-4">
      {/* Priorities */}
      <section>
        <h3 className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Priorities</h3>
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-[#2A2F38] px-3 py-4 text-center">
          <Flag className="w-4 h-4 mx-auto text-zinc-300 dark:text-zinc-600" />
          <div className="mt-1.5 text-[11.5px] text-zinc-400 dark:text-zinc-500 leading-snug">Prioritize a task to see it appear here</div>
        </div>
        <button type="button" className="mt-1.5 w-full h-7 rounded-md text-[12px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10 inline-flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add priority
        </button>
      </section>

      <MeetWith onCreated={onCreated} autoFocus={autoFocusMeet} />

      <CollapsibleSection title="Assigned to me" items={assigned} loading={buckets === null} onOpen={(u) => router.push(u)} />
      <CollapsibleSection title="Today & overdue" items={todayOverdue} loading={buckets === null} onOpen={(u) => router.push(u)} />
      <CollapsibleSection title="Backlog" items={backlog} loading={buckets === null} onOpen={(u) => router.push(u)} defaultOpen />
    </aside>
  );
}

function CollapsibleSection({ title, items, loading, onOpen, defaultOpen }: {
  title: string; items: WorkItem[]; loading: boolean; onOpen: (url: string) => void; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1 px-1 py-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="flex-1 text-left">{title}</span>
        {!loading ? <span className="text-[11px] text-zinc-400">{items.length}</span> : null}
      </button>
      {open ? (
        loading ? (
          <div className="py-2 flex justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" /></div>
        ) : items.length === 0 ? (
          <div className="px-2 py-1.5 text-[11.5px] text-zinc-400 dark:text-zinc-500">Nothing here.</div>
        ) : (
          <ul className="space-y-0.5 mt-0.5">
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => onOpen(it.url)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 text-left">
                  <span className="w-2 h-2 rounded-full border border-zinc-300 dark:border-zinc-600 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{it.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function MeetWith({ onCreated, autoFocus }: { onCreated: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    if (q.trim().length < 2) { setPeople(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/users?search=${encodeURIComponent(q.trim())}&limit=6`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { data?: Person[] } | null) => setPeople(d?.data ?? []))
        .catch(() => setPeople([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function meetWith(p: Person) {
    setBusy(p.id);
    const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 30 * 60_000);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Meet with ${personName(p)}`, startAt: start.toISOString(), endAt: end.toISOString(), allDay: false, date: start.toISOString() }),
      });
      if (res.ok) { setQ(""); setPeople(null); onCreated(); }
    } finally { setBusy(null); }
  }

  return (
    <section>
      <h3 className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Meet with</h3>
      <div className="flex items-center gap-2 h-8 rounded-lg border border-zinc-200 dark:border-[#2A2F38] px-2.5">
        <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for people…" className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400" />
      </div>
      {people !== null && q.trim().length >= 2 ? (
        <ul className="mt-1 rounded-lg border border-zinc-200 dark:border-[#2A2F38] p-1 max-h-[200px] overflow-y-auto">
          {people.length === 0 ? (
            <li className="px-2 py-2 text-[11.5px] text-zinc-400 text-center">No teammates found.</li>
          ) : people.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => meetWith(p)} disabled={busy === p.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 text-left">
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-[#2F8BF0] text-white text-[9px] font-semibold flex items-center justify-center shrink-0">{personInitials(p)}</span>
                )}
                <span className="flex-1 min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{personName(p)}</span>
                {busy === p.id ? <Loader2 className="w-3 h-3 animate-spin text-zinc-400" /> : <span className="text-[10.5px] text-[#0073EA] font-medium shrink-0">Meet</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
