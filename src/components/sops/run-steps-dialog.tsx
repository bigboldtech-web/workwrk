"use client";

// RunStepsDialog: run a published step-by-step SOP. Every step marked
// "Creates a task" becomes a task on the List chosen here, assigned by the
// step's job title through the soonest available rule (the rule is printed
// under the steps, from src/lib/sop-step-owner.ts). Before anything is made
// the dialog shows, per step, who it will go to right now, or the notice
// that it will be unassigned and why (GET /api/sops/[id]/run-steps).
//
// One run id per open: a double click, or a retry after a failure, sends the
// same id and the server finishes the run without doubling it. A failure
// keeps the dialog open with the server's sentence and a Try again.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { groupReadableLists, readableListsUrl, type ReadableListsResponse } from "@/lib/readable-lists";

type Pick = { kind: "assigned"; userId: string; name: string; holders: number } | { kind: "nobody" | "unavailable"; notice: string; holders: number };
interface PlanStep { stepId: string; n: number; title: string; createsTask: boolean; jobTitle: string | null; pick: Pick | null }
interface Plan { published: boolean; rule: string; defaultBoard: { id: string; name: string } | null; steps: PlanStep[] }
interface RunTask { stepId: string; n: number; itemId: string; title: string; assigneeId: string | null; assigneeName: string | null; notice: string | null; existing: boolean }

const FIELD = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink focus:outline-none focus-visible:border-brand";

/** The List picker's sections: each List under its Space, as every other List picker shows them. */
type ListGroup = { key: string; label: string; lists: Array<{ id: string; name: string }> };

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function RunStepsDialog({ open, onClose, sop }: { open: boolean; onClose: () => void; sop: { id: string; title: string } }) {
  const { toast } = useOsToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  // The Lists are their own read, with their own Retry and search: a failure
  // says so (instead of telling the person to ask for access they may already
  // hold), a Retry shows it is working and never refetches the steps, and
  // when the server could not check every List the search reaches the rest.
  const [listsRes, setListsRes] = useState<ReadableListsResponse | null>(null);
  const [listsState, setListsState] = useState<"loading" | "ready" | "failed">("loading");
  const [listsAttempt, setListsAttempt] = useState(0);
  const [q, setQ] = useState("");
  const [boardId, setBoardId] = useState<string>("");
  // Read by the Lists request only (inside its timer, after effects ran).
  const boardIdRef = useRef(boardId);
  useEffect(() => { boardIdRef.current = boardId; }, [boardId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ board: { slug: string; name: string }; tasks: RunTask[] } | null>(null);
  const [runId, setRunId] = useState(newRunId);
  const [planAttempt, setPlanAttempt] = useState(0);

  // Reset per open (adopt during render, never in an effect).
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      setPlan(null);
      setPlanError(null);
      setError(null);
      setResult(null);
      setRunId(newRunId());
      setQ("");
      setListsRes(null);
      setListsState("loading");
    }
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const p = await apiFetch<Plan>(`/api/sops/${sop.id}/run-steps`, { cache: "no-store" });
      if (!live) return;
      if (!p.ok) { setPlanError(p.error || "Couldn't read the steps."); return; }
      setPlan(p.data);
      setBoardId((cur) => cur || p.data.defaultBoard?.id || "");
    })();
    return () => { live = false; };
  }, [open, sop.id, planAttempt]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // A search waits for a pause in typing; the first read goes at once.
    const t = setTimeout(() => {
      setListsState("loading");
      // The chosen List is always asked for by id, so a search never drops
      // the one the tasks are about to land on (the SOP's own List has its
      // own section when the answer leaves it out).
      const ids = boardIdRef.current ? [boardIdRef.current] : [];
      void apiFetch<ReadableListsResponse>(readableListsUrl({ q, ids, targets: true, writable: true, limit: 100 }), { cache: "no-store" }).then((l) => {
        if (!live) return;
        if (!l.ok || !Array.isArray(l.data?.boards)) { setListsState("failed"); return; }
        setListsRes({ boards: l.data.boards, spaces: Array.isArray(l.data.spaces) ? l.data.spaces : [], pathSpaces: Array.isArray(l.data.pathSpaces) ? l.data.pathSpaces : [], truncated: !!l.data.truncated });
        setListsState("ready");
      });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [open, q, listsAttempt]);

  // Grouped under their Spaces (groupReadableLists, the same sections the
  // other List pickers use): a template applied for a second team makes a
  // second "Onboarding" List, and a bare name cannot say which team's List
  // the tasks land on. The SOP's own List leads in its own section when it
  // is not among the Lists the viewer may add to (the server still decides).
  const listGroups = useMemo<ListGroup[]>(() => {
    const res = listsRes ?? { boards: [], spaces: [], truncated: false };
    const groups: ListGroup[] = groupReadableLists(res).map((g) => ({ key: g.key, label: g.label, lists: g.lists.map((b) => ({ id: b.id, name: b.name })) }));
    const def = plan?.defaultBoard ?? null;
    return def && !res.boards.some((r) => r.id === def.id) ? [{ key: "sop-default", label: "This SOP's List", lists: [def] }, ...groups] : groups;
  }, [listsRes, plan]);
  const listsTruncated = !!listsRes?.truncated;

  const spawning = useMemo(() => (plan?.steps ?? []).filter((s) => s.createsTask), [plan]);
  // A closed select shows only the List's name, so the chosen List's Space is
  // said under it: two teams' "Onboarding" Lists read the same otherwise.
  const chosenGroup = listGroups.find((g) => g.lists.some((b) => b.id === boardId)) ?? null;
  const inSpace = (name: string) => (/\bspace$/i.test(name.trim()) ? `In the ${name}` : `In the ${name} Space`);
  const chosenWhere = !chosenGroup || chosenGroup.key === "sop-default" ? null : chosenGroup.key.startsWith("space:") || chosenGroup.key.startsWith("path:") ? inSpace(chosenGroup.label) : chosenGroup.label;

  async function run() {
    if (busy || !boardId || spawning.length === 0) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ board: { slug: string; name: string }; tasks: RunTask[] }>(`/api/sops/${sop.id}/run-steps`, { method: "POST", json: { boardId, runId } });
    setBusy(false);
    if (!r.ok) { setError(r.error || "The tasks were not created. Try again."); return; }
    setResult(r.data);
    const made = r.data.tasks.filter((t) => !t.existing).length;
    toast(made > 0 ? `${made} task${made === 1 ? "" : "s"} created on ${r.data.board.name}` : "These tasks were already created");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[600px]">
        <DialogTitle>Run steps as tasks</DialogTitle>
        <DialogDescription>{`Each step of "${sop.title}" marked to create a task becomes a task, owned by the person who holds its job title.`}</DialogDescription>
        {planError ? (
          <div className="mt-3 flex items-center gap-3 text-sm text-ink-2">
            {planError}
            <button type="button" onClick={() => { setPlanError(null); setPlanAttempt((a) => a + 1); }} className="font-medium text-ink underline">Retry</button>
          </div>
        ) : !plan ? (
          <div className="mt-4"><Dots variant="pending" label="Reading the steps" /></div>
        ) : result ? (
          <div className="mt-3 flex flex-col gap-3">
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {result.tasks.map((t) => (
                <li key={t.itemId} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="flex items-center gap-2 text-row text-ink">
                    <span className="text-xs tabular-nums text-ink-3">Step {t.n}</span>
                    <Link href={`/item/${t.itemId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.title}</Link>
                    <span className="shrink-0 text-sm text-ink-2">{t.assigneeName ?? (t.assigneeId ? "Assigned" : "Unassigned")}</span>
                  </span>
                  {t.notice ? <span className="text-xs text-ink-2">{t.notice}</span> : null}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Link href={`/boards/${result.board.slug}`} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Open {result.board.name}</Link>
              <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover">Done</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {!plan.published ? <p className="text-sm text-ink-2">Publish the SOP before running it.</p> : null}
            {spawning.length === 0 ? (
              <p className="text-sm text-ink-2">No step is marked to create a task yet. Edit the SOP, open a step and turn on Creates a task when the SOP is run.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {spawning.map((s) => (
                  <li key={s.stepId} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex items-center gap-2 text-row text-ink">
                      <span className="text-xs tabular-nums text-ink-3">Step {s.n}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                      <span className="shrink-0 text-sm text-ink-2">
                        {s.pick?.kind === "assigned" ? `${s.pick.name}, ${s.jobTitle}` : s.jobTitle ? "Unassigned" : "No job title, unassigned"}
                      </span>
                    </span>
                    {s.pick && s.pick.kind !== "assigned" ? <span className="text-xs text-ink-2">{s.pick.notice}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-3">{plan.rule}</p>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">List</span>
              {listsTruncated || q ? (
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a List"
                  aria-label="Find a List"
                  className={FIELD}
                />
              ) : null}
              <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className={FIELD} aria-label="List the tasks go on">
                <option value="">Choose a List</option>
                {listGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.lists.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                ))}
              </select>
              {chosenWhere ? <span className="text-xs text-ink-2">{chosenWhere}</span> : null}
              {listsState === "loading" ? (
                <span className="text-xs text-ink-3">Loading your Lists…</span>
              ) : listsState === "failed" ? (
                <span className="text-xs text-ink-2">
                  {"Couldn't load your Lists. "}
                  <button type="button" onClick={() => setListsAttempt((a) => a + 1)} className="font-medium text-ink underline">Retry</button>
                </span>
              ) : listGroups.length === 0 ? (
                <span className="text-xs text-ink-2">{q ? "No List you can add tasks to matches that." : "There is no List you can add tasks to. Ask a List owner for Can edit, then run the SOP."}</span>
              ) : null}
              {listsState === "ready" && listsTruncated ? <span className="text-xs text-ink-3">Not every List is shown. Search to find yours.</span> : null}
            </label>
            {error ? (
              <p className="text-sm text-danger-text" role="alert">{error}</p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
              <button type="button" onClick={() => void run()} disabled={busy || !boardId || spawning.length === 0 || !plan.published} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
                {busy ? <Dots variant="pending" /> : <Play className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                {error ? "Try again" : spawning.length > 0 ? `Create ${spawning.length} task${spawning.length === 1 ? "" : "s"}` : "Create tasks"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
