"use client";

// PlannerCommandBar — the bar at the bottom of the Planner. Search events and
// teammates, hand natural-language commands to the Brain (Sidekick), and a
// "Meet with" picker that schedules a meeting with anyone in one click.

import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, Loader2 } from "lucide-react";
import { useOsShell } from "./shell-context";

interface Person { id: string; firstName?: string | null; lastName?: string | null; email: string; avatar?: string | null }

function name(p: Person) { return [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email; }
function initials(p: Person) { return ((p.firstName?.[0] ?? "") + (p.lastName?.[0] ?? "") || p.email[0] || "?").toUpperCase(); }

export function PlannerCommandBar({ onCreated, initialMeet }: { onCreated: () => void; initialMeet?: boolean }) {
  const { openSidekick } = useOsShell();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [showMeet, setShowMeet] = useState(Boolean(initialMeet));
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (initialMeet) inputRef.current?.focus(); }, [initialMeet]);

  useEffect(() => {
    if (!showMeet && q.trim().length < 2) { setPeople(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/users?search=${encodeURIComponent(q.trim())}&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { data?: Person[] } | null) => setPeople(d?.data ?? []))
        .catch(() => setPeople([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, showMeet]);

  async function meetWith(p: Person) {
    setBusy(p.id);
    const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 30 * 60_000);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Meet with ${name(p)}`, startAt: start.toISOString(), endAt: end.toISOString(), allDay: false, date: start.toISOString() }),
      });
      if (res.ok) { setShowMeet(false); setQ(""); setPeople(null); onCreated(); }
    } finally { setBusy(null); }
  }

  function runCommand() {
    const v = q.trim();
    if (!v) { setShowMeet((s) => !s); return; }
    openSidekick(v); // natural-language command → the Brain
    setQ("");
  }

  const showList = showMeet || (people !== null && q.trim().length >= 2);

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-[560px] max-w-[82vw]">
      {showList ? (
        <div className="mb-2 rounded-xl bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl max-h-[260px] overflow-y-auto p-1">
          {people === null ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-zinc-300" /></div>
          ) : people.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">Type a name to find a teammate.</div>
          ) : (
            people.map((p) => (
              <button key={p.id} type="button" onClick={() => meetWith(p)} disabled={busy === p.id} className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-white/5 text-left">
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-[#2F8BF0] text-white text-[10px] font-semibold flex items-center justify-center shrink-0">{initials(p)}</span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12.5px] text-zinc-800 dark:text-zinc-100">{name(p)}</span>
                  <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">{p.email}</span>
                </span>
                {busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" /> : <span className="text-[11px] text-[#0073EA] font-medium shrink-0">Meet</span>}
              </button>
            ))
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-2 h-11 rounded-full bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl pl-4 pr-1.5">
        <Search className="w-4 h-4 text-zinc-400 shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runCommand(); }}
          placeholder="Search events, teammates, commands…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
        />
        <button type="button" onClick={runCommand} title="Ask the Brain" className="h-8 w-8 rounded-full bg-[#0073EA] text-white flex items-center justify-center hover:bg-[#0060B9] shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
