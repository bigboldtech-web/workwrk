"use client";

// CalendarPeek — the topbar calendar icon. Anywhere but the Planner it opens a
// quick "peek" popover: today's agenda gist plus a Meet button. On the Planner
// itself it does nothing (you're already there), matching ClickUp.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppGlyph } from "@/components/brand/app-glyphs";
import { Users, Loader2 } from "lucide-react";

interface Ev { id: string; source: "task" | "item"; external: boolean; title: string; start: string; end: string; allDay: boolean }

function evColor(e: Ev): string {
  if (e.source === "item") return "#F2A93B";
  if (e.external) return "#2F8BF0";
  return "#16A9A1";
}

export function CalendarPeek() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const onPlanner = pathname?.startsWith("/planner") ?? false;

  useEffect(() => {
    if (!open) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    fetch(`/api/planner/events?from=${start.toISOString()}&to=${end.toISOString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events: Ev[] } | null) => {
        if (d) setEvents(d.events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start)));
        else setEvents([]);
      })
      .catch(() => setEvents([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggle() { if (onPlanner) return; if (!open) setEvents(null); setOpen((v) => !v); }

  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-zinc-100" aria-label="Calendar" title={onPlanner ? "Calendar" : "Calendar peek"}>
        <AppGlyph appKey="planner" size={18} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[34px] z-50 w-[300px] rounded-xl bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl">
          <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-100 dark:border-[#2A2F38]">
            <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">Today <span className="text-zinc-400 dark:text-zinc-500 font-normal">{today}</span></div>
            <Link href="/planner" onClick={() => setOpen(false)} className="text-[12px] font-medium text-[#0073EA] hover:underline">Open Planner</Link>
          </div>

          <div className="max-h-[280px] overflow-y-auto p-1.5">
            {events === null ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-300" /></div>
            ) : events.length === 0 ? (
              <div className="px-2 py-6 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">Nothing scheduled today.</div>
            ) : (
              <ul className="space-y-0.5">
                {events.map((e) => {
                  const s = new Date(e.start); const color = evColor(e);
                  return (
                    <li key={e.id}>
                      <Link href="/planner" onClick={() => setOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-white/5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-[12.5px] text-zinc-800 dark:text-zinc-100 truncate flex-1">{e.title}</span>
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">{s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="p-2 border-t border-zinc-100 dark:border-[#2A2F38]">
            <button type="button" onClick={() => { setOpen(false); router.push("/planner?meet=1"); }} className="w-full h-9 rounded-md bg-[#0073EA] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#0060B9]">
              <Users className="w-3.5 h-3.5" /> Meet with someone
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
