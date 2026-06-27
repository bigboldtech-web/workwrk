"use client";

// MyWorkPanel — right slide-over showing the signed-in user's assigned work
// bucketed Today / Overdue / Next / Unscheduled / Done. Opened from the topbar
// quick-tools "My Work" icon via a `workwrk:tool` window event (detail:
// "my-work"), so it stays decoupled from shell-context.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, Loader2, CircleDot } from "lucide-react";

interface WorkItem { id: string; title: string; status: string | null; dueAt: string | null; priority: string | null; board: string | null; url: string }
interface WorkData { buckets: Record<string, WorkItem[]>; counts: Record<string, number> }

const BUCKETS: { key: string; label: string; color: string }[] = [
  { key: "today", label: "Today", color: "#2F8BF0" },
  { key: "overdue", label: "Overdue", color: "#FB5A6F" },
  { key: "next", label: "Next", color: "#F2A93B" },
  { key: "unscheduled", label: "Unscheduled", color: "#8595AD" },
  { key: "done", label: "Done", color: "#1FB877" },
];

export function MyWorkPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WorkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, unscheduled: true });

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/me/work")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WorkData | null) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onTool(e: Event) {
      if ((e as CustomEvent).detail === "my-work") { setOpen(true); load(); }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("workwrk:tool", onTool as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, [load]);

  if (!open) return null;

  function go(url: string) { setOpen(false); router.push(url); }

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={() => setOpen(false)} aria-hidden />
      <aside className="fixed top-0 right-0 z-[91] h-screen w-[380px] max-w-[92vw] bg-white dark:bg-[#14171D] border-l border-zinc-200 dark:border-[#2A2F38] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0">
          <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">My Work</div>
          <button type="button" onClick={() => setOpen(false)} className="w-7 h-7 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && !data ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-300" /></div>
          ) : (
            BUCKETS.map((b) => {
              const items = data?.buckets[b.key] ?? [];
              const isCollapsed = collapsed[b.key] ?? false;
              return (
                <div key={b.key} className="border-b border-zinc-100 dark:border-[#23272F]">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [b.key]: !isCollapsed }))}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: b.color }} />
                    <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{b.label}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500">{items.length}</span>
                    <ChevronRight className={`ml-auto w-3.5 h-3.5 text-zinc-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                  </button>
                  {!isCollapsed ? (
                    items.length === 0 ? (
                      <div className="px-4 pb-3 text-[12px] text-zinc-400 dark:text-zinc-500">Nothing here.</div>
                    ) : (
                      <ul className="pb-1.5">
                        {items.map((it) => (
                          <li key={it.id}>
                            <button type="button" onClick={() => go(it.url)} className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5">
                              <CircleDot className="w-3.5 h-3.5 shrink-0" style={{ color: b.color }} />
                              <span className="flex-1 min-w-0">
                                <span className="block truncate text-[12.5px] text-zinc-800 dark:text-zinc-200">{it.title}</span>
                                {it.board ? <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">{it.board}</span> : null}
                              </span>
                              {it.dueAt ? <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">{new Date(it.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              );
            })
          )}
          {!loading && data && Object.values(data.counts).every((n) => n === 0) ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">
              Tasks assigned to you will show here.
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
