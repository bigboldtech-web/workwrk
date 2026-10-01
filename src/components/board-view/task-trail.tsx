"use client";

// TaskTrail: the read-only "Connection trail" on the task page, the drawer
// and the Inbox pane (they share BoardItemDetail). It lists the task's real
// connections, each one the viewer may open (GET /api/items/[id]/trail,
// src/lib/task-trail.ts), and renders nothing at all when there are none:
// no empty heading, no placeholder rows. When an SOP run could not find a
// holder for the step's job title, the notice it recorded shows here.
//
// Read only by design: links are added and removed in Related and in the
// Alignment row, never here.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, BookOpen, Clock, FileText, Flag, Folder, Heart, LayoutGrid, ListChecks, PenTool, Sheet, Target, UserRound, FileSignature, Paperclip } from "lucide-react";
import type { TrailEntry, TrailKind } from "@/lib/task-trail";

const ICON: Record<TrailKind, typeof FileText> = {
  "sop-step": ListChecks, sop: BookOpen, "job-title": UserRound, kra: Flag, kpi: Target, goal: Target,
  doc: FileText, canvas: PenTool, table: Sheet, file: Paperclip, list: LayoutGrid, contract: FileSignature, kudos: Heart, timer: Clock,
};

interface TrailAnswer { entries: TrailEntry[]; ownerNotice: string | null }

export function TaskTrail({ itemId, refreshKey }: { itemId: string; refreshKey?: string }) {
  const [trail, setTrail] = useState<TrailAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/items/${itemId}/trail`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TrailAnswer) => { if (live) { setTrail({ entries: Array.isArray(d?.entries) ? d.entries : [], ownerNotice: typeof d?.ownerNotice === "string" ? d.ownerNotice : null }); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [itemId, refreshKey, attempt]);

  if (failed) {
    return (
      <p className="text-sm text-ink-3">
        The connection trail did not load.{" "}
        <button type="button" onClick={() => setAttempt((a) => a + 1)} className="font-medium text-ink-2 underline">Retry</button>
      </p>
    );
  }
  if (!trail || (trail.entries.length === 0 && !trail.ownerNotice)) return null;

  return (
    <section aria-label="Connection trail" className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium text-ink">Connection trail</h3>
      {trail.ownerNotice ? (
        <p className="flex items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          {trail.ownerNotice}
        </p>
      ) : null}
      {trail.entries.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-0.5">
          {trail.entries.map((e) => {
            const Icon = ICON[e.kind] ?? Folder;
            const body = (
              <>
                <Icon className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                <span className="w-20 shrink-0 truncate text-xs text-ink-3 sm:w-28">{e.label}</span>
                <span className="min-w-0 flex-1 truncate text-row text-ink">{e.title}</span>
                {e.detail ? <span className="hidden min-w-0 max-w-[45%] truncate text-xs text-ink-3 sm:inline">{e.detail}</span> : null}
              </>
            );
            return (
              <li key={`${e.kind}:${e.id}`} className="min-w-0">
                {e.href ? (
                  <Link href={e.href} className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-hover">{body}</Link>
                ) : (
                  <span className="flex h-8 min-w-0 items-center gap-2 px-2">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
