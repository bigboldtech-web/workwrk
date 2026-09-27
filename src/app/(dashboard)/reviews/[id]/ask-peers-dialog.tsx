"use client";

// Ask for peer feedback (560): a people picker SCOPED to the people who work
// with the subject (GET /api/reviews/[id]/peers: their department, their
// office, their manager, the people who share their manager, their reports),
// never the whole org; up to five, plus an optional note. From the bulk bar
// it asks the same people about each selected person, and anyone who does
// not work with one of them is skipped for that one and said so.

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOsToast } from "@/components/layout/os/toast";
import { Avatar } from "@/components/ui/avatar-stack";
import { personName } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import type { ReviewRow } from "./cycle-types";

type Candidate = { id: string; firstName: string; lastName: string; email: string; avatar: string | null; jobTitle: string | null; why: string };

export function AskPeersDialog({ cycleId, subjects, onClose, onDone }: { cycleId: string; subjects: ReviewRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useOsToast();
  const [q, setQ] = useState("");
  const [lists, setLists] = useState<Record<string, Candidate[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void Promise.all(subjects.map(async (s) => {
        const r = await apiFetch<{ data: Candidate[] }>(`/api/reviews/${cycleId}/peers?subjectId=${encodeURIComponent(s.subjectId)}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
        return [s.subjectId, r.ok ? r.data.data : null] as const;
      })).then((pairs) => {
        if (!live) return;
        if (pairs.some(([, l]) => l === null)) { setError("Couldn't load the people who work with them"); return; }
        setError(null);
        setLists(Object.fromEntries(pairs.map(([k, l]) => [k, l ?? []])));
      });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [cycleId, subjects, q, attempt]);

  const union = useMemo(() => {
    const seen = new Map<string, Candidate & { count: number }>();
    for (const l of Object.values(lists ?? {})) for (const c of l) {
      const e = seen.get(c.id);
      if (e) e.count += 1; else seen.set(c.id, { ...c, count: 1 });
    }
    return [...seen.values()].filter((c) => !subjects.some((s) => s.subjectId === c.id));
  }, [lists, subjects]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));

  const send = async () => {
    if (!picked.length) return;
    setBusy(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const s of subjects) {
      const r = await apiFetch<{ created?: number; skipped?: number }>(`/api/reviews/${cycleId}/peer-feedback`, { method: "POST", json: { reviewId: s.id, peerIds: picked, skipInvalid: true } });
      if (r.ok) { created += r.data.created ?? 0; skipped += r.data.skipped ?? 0; } else failed += 1;
    }
    setBusy(false);
    if (failed) toast(`Asked for ${created} answers. ${failed} ${failed === 1 ? "request" : "requests"} failed, try again.`, { tone: "danger" });
    else toast(skipped ? `Asked for ${created} answers. ${skipped} skipped: they do not work with that person.` : `Asked for ${created} ${created === 1 ? "answer" : "answers"}`);
    onDone();
  };

  const title = subjects.length === 1 ? `Ask for feedback on ${personName(subjects[0].subject)}` : `Ask for feedback on ${subjects.length} people`;
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pick up to five people who work with them. Their names are not shown to the person, and nobody sees which answer is whose.</DialogDescription>
        </DialogHeader>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people"
          className="h-9 rounded-md border border-line bg-raised px-3 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
        {error ? (
          <p role="alert" className="m-0 text-sm text-danger-text">{error}. <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>
        ) : !lists ? (
          <p className="m-0 text-sm text-ink-2">Finding the people who work with them</p>
        ) : union.length ? (
          <ul className="m-0 max-h-[46vh] list-none divide-y divide-line-soft overflow-y-auto rounded-lg border border-line p-0">
            {union.map((c) => {
              const on = picked.includes(c.id);
              return (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1 hover:bg-hover">
                    <input type="checkbox" checked={on} disabled={!on && picked.length >= 5} onChange={() => toggle(c.id)} className="h-4 w-4" />
                    <Avatar person={c} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row text-ink">{personName(c)}</span>
                      <span className="block truncate text-xs text-ink-2">{[c.jobTitle, subjects.length > 1 ? `works with ${c.count} of ${subjects.length}` : c.why].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-sm text-ink-2">{q ? "Nobody by that name works with them." : "Nobody shares a department, an office or a manager with them yet."}</p>
        )}
        <DialogFooter>
          <span className="me-auto self-center text-xs text-ink-2">{picked.length} of 5 picked</span>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void send()} disabled={busy || !picked.length}>{busy ? "Asking" : "Ask for feedback"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
