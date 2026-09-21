"use client";

// MyWorkPeek: the right slide-over that shows the signed-in person's work
// bucketed Today / Overdue / Next / Unscheduled / Done without leaving the
// page. It is the "My Work" personal tool (Avatar > Personal tools, pin it to
// the bar) and it opens on the `workwrk:tool` window event with detail
// "my-work", like the Notepad and Reminder overlays. The full page is
// /my-work; this is the glance, on the design tokens: a 380px panel, 44px
// bucket headers, one pale count chip per bucket, no colour without a word.
//
// Reads GET /api/me/work (`buckets` + `counts`, the same shape the planner
// side panel reads), so the peek and the page never disagree.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useLayer } from "./shell-context";
import { SkeletonLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface WorkItem { id: string; title: string; status: string | null; dueAt: string | null; priority: string | null; board: string | null; url: string }
interface WorkData { buckets: Record<string, WorkItem[]>; counts: Record<string, number> }

const BUCKETS: Array<{ key: string; label: string; chip: string; dot: string }> = [
  { key: "today", label: "Today", chip: "bg-brand-soft text-brand-deep", dot: "bg-brand" },
  { key: "overdue", label: "Overdue", chip: "bg-danger-bg text-danger-text", dot: "bg-danger-solid" },
  { key: "next", label: "Next", chip: "bg-warning-bg text-warning-text", dot: "bg-warning-solid" },
  { key: "unscheduled", label: "Unscheduled", chip: "bg-surface-2 text-ink-2", dot: "bg-ink-3" },
  { key: "done", label: "Done", chip: "bg-success-bg text-success-text", dot: "bg-success-solid" },
];

export const MY_WORK_TOOL_EVENT = "my-work";

export function MyWorkPeek() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WorkData | null>(null);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, unscheduled: true });

  const load = useCallback(async () => {
    const r = await apiFetch<WorkData>("/api/me/work", { cache: "no-store" });
    if (r.ok && r.data?.buckets) { setData(r.data); setError(false); }
    else if (r.status !== 401) setError(true);
  }, []);

  useEffect(() => {
    function onTool(e: Event) {
      if ((e as CustomEvent).detail !== MY_WORK_TOOL_EVENT) return;
      setOpen(true);
      void load();
    }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    return () => window.removeEventListener("workwrk:tool", onTool as EventListener);
  }, [load]);
  // Esc goes through the LayerStack (spec-shell section 1.5), not a listener here.
  useLayer(open, { id: "my-work-peek", kind: "panel", close: () => setOpen(false) });

  if (!open) return null;

  const go = (url: string) => { setOpen(false); router.push(url); };
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-[var(--os-scrim)]" onClick={() => setOpen(false)} aria-hidden />
      <aside
        role="dialog"
        aria-label="My work"
        className="workwrk-os os-chrome fixed end-0 top-0 z-[91] flex h-screen w-[380px] max-w-[92vw] flex-col border-s border-line bg-raised text-ink shadow-[var(--os-shadow-modal)]"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <span className="text-base font-semibold text-ink">My work</span>
          <span className="flex-1" />
          <button type="button" onClick={() => go("/my-work")} className="text-sm font-medium text-brand-deep hover:underline">
            Open My work
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="px-4 py-8 text-center text-base text-ink-2">
              Couldn&apos;t load your work ·{" "}
              <button type="button" onClick={() => { void load(); }} className="font-medium text-brand-deep hover:underline">Try again</button>
            </div>
          ) : data === null ? (
            <SkeletonLines lines={5} className="px-4 py-4" />
          ) : total === 0 ? (
            <div className="px-4 py-10 text-center text-base text-ink-2">Tasks assigned to you will show here.</div>
          ) : (
            BUCKETS.map((b) => {
              const items = data.buckets[b.key] ?? [];
              const isCollapsed = collapsed[b.key] ?? false;
              return (
                <section key={b.key} className="border-b border-line-soft" aria-label={b.label}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [b.key]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="flex h-11 w-full items-center gap-2 px-4 text-start hover:bg-hover"
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 text-ink-3 transition-transform rtl:rotate-180", !isCollapsed && "rotate-90")} strokeWidth={1.5} aria-hidden />
                    <span className="text-base font-medium text-ink">{b.label}</span>
                    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium tabular-nums", b.chip)}>
                      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", b.dot)} aria-hidden />
                      {items.length}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    items.length === 0 ? (
                      <div className="px-4 pb-3 text-sm text-ink-3">Nothing here.</div>
                    ) : (
                      <ul className="pb-1.5">
                        {items.map((it) => (
                          <li key={it.id}>
                            <button type="button" onClick={() => go(it.url)} className="flex w-full items-center gap-3 px-4 py-1.5 text-start hover:bg-hover">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-base text-ink">{it.title}</span>
                                {it.board ? <span className="block truncate text-xs text-ink-2">{it.board}</span> : null}
                              </span>
                              {it.dueAt ? (
                                <span className="shrink-0 text-xs tabular-nums text-ink-3">
                                  {new Date(it.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
