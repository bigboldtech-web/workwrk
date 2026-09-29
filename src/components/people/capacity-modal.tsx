"use client";

// CapacityModal (spec-teams-people section 3): the Workload grid's door onto
// each person's weekly hours. It writes the SAME column the person record
// and the Members drawer write (User.weeklyCapacityHours, PATCH
// /api/users/[id]), under the same per-field rule, so it is a third door and
// never a third store. Each row autosaves a moment after typing stops (and
// at once on blur or Enter) with its own tick, a visible failure and one
// quiet retry; a row the viewer may not write is shown read-only. Tasks per
// day is the viewer's own preference.
//
// Nothing typed is ever lost silently: closing (Esc, X, Close) first flushes
// every row still waiting and waits for saves in flight; if any row failed,
// the dialog stays open and asks "Keep editing" or "Discard and close". While
// a row is unsaved the dirty guard also covers leaving the page.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { describeSchedule, effectivePersonSchedule, nominalWeekHours, type WorkSchedule } from "@/lib/work-schedule";
import { PersonAvatar, personName } from "./person-bits";

export interface CapacityPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  avatar: string | null;
  weeklyCapacityHours: number | null;
  workSchedule?: unknown;
  canEditCapacity: boolean;
}

type RowState = "idle" | "dirty" | "saving" | "saved" | "error";
const AUTOSAVE_MS = 700;
const TASKS_MIN = 1;
const TASKS_MAX = 99;

export function CapacityModal({ people, orgSchedule, canEditOrgDefault, dailyTasks, onDailyTasks, onSaved, onClose }: {
  people: CapacityPerson[];
  orgSchedule: WorkSchedule;
  /** Owner and Admin get the link to the company schedule. */
  canEditOrgDefault: boolean;
  dailyTasks: number;
  onDailyTasks: (n: number) => void;
  /** A row saved: the grid re-reads its capacity. */
  onSaved: (id: string, weeklyCapacityHours: number | null) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(people.map((p) => [p.id, p.weeklyCapacityHours == null ? "" : String(p.weeklyCapacityHours)])),
  );
  const [state, setState] = useState<Record<string, { s: RowState; error?: string }>>({});
  const [tasks, setTasks] = useState(String(dailyTasks));
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  // Refs, not render-time values: a close pressed in the same tick as the
  // last keystroke must see that keystroke, and saves in flight.
  const valuesRef = useRef(values);
  const savedRef = useRef(new Map(people.map((p) => [p.id, p.weeklyCapacityHours] as const)));
  const stateRef = useRef(state);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, Promise<boolean>>());
  const byId = useRef(new Map(people.map((p) => [p.id, p] as const)));
  useEffect(() => { byId.current = new Map(people.map((p) => [p.id, p] as const)); }, [people]);
  const setRow = useCallback((id: string, row: { s: RowState; error?: string }) => {
    stateRef.current = { ...stateRef.current, [id]: row };
    setState(stateRef.current);
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => { for (const h of t.values()) clearTimeout(h); };
  }, []);

  const save = useCallback(async (id: string): Promise<boolean> => {
    const p = byId.current.get(id);
    if (!p) return true;
    const pending = timers.current.get(id);
    if (pending) { clearTimeout(pending); timers.current.delete(id); }
    // A keystroke that lands while a save is in flight is saved next, never
    // dropped: loop until the value on screen is the value stored.
    for (;;) {
      const raw = (valuesRef.current[id] ?? "").trim();
      const next = raw === "" ? null : Number(raw);
      if (next !== null && (!Number.isFinite(next) || next < 0 || next > 168)) {
        setRow(id, { s: "error", error: "0 to 168 hours, or blank for the default" });
        return false;
      }
      if ((savedRef.current.get(id) ?? null) === next) {
        const cur = stateRef.current[id]?.s;
        if (cur === "dirty" || cur === "error") setRow(id, { s: cur === "error" ? "saved" : "idle" });
        return true;
      }
      setRow(id, { s: "saving" });
      let r = await apiFetch(`/api/users/${id}`, { method: "PATCH", json: { weeklyCapacityHours: next }, keepalive: true });
      // One quiet retry for a dropped connection; a refusal is shown at once.
      if (!r.ok && (r.status === 0 || r.status >= 500)) {
        r = await apiFetch(`/api/users/${id}`, { method: "PATCH", json: { weeklyCapacityHours: next }, keepalive: true });
      }
      if (!r.ok) {
        setRow(id, { s: "error", error: r.error || "Not saved" });
        return false;
      }
      savedRef.current.set(id, next);
      onSaved(id, next);
      const now = (valuesRef.current[id] ?? "").trim();
      if ((now === "" ? null : Number(now)) === next) {
        setRow(id, { s: "saved" });
        return true;
      }
    }
  }, [onSaved, setRow]);

  const saveTracked = useCallback((id: string): Promise<boolean> => {
    const run = (inflight.current.get(id) ?? Promise.resolve(true)).then(() => save(id));
    inflight.current.set(id, run);
    void run.finally(() => { if (inflight.current.get(id) === run) inflight.current.delete(id); });
    return run;
  }, [save]);

  const edit = (id: string, v: string) => {
    valuesRef.current = { ...valuesRef.current, [id]: v };
    setValues(valuesRef.current);
    setRow(id, { s: "dirty" });
    const prev = timers.current.get(id);
    if (prev) clearTimeout(prev);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void saveTracked(id); }, AUTOSAVE_MS));
  };

  const commitTasks = useCallback((): boolean => {
    const n = Number(tasks);
    if (Number.isInteger(n) && n >= TASKS_MIN && n <= TASKS_MAX) {
      if (n !== dailyTasks) onDailyTasks(n);
      return true;
    }
    setTasks(String(dailyTasks));
    return true;
  }, [tasks, dailyTasks, onDailyTasks]);

  const unsaved = Object.values(state).some((r) => r.s === "dirty" || r.s === "saving" || r.s === "error");
  useDirtyGuard(unsaved, {
    onSave: async () => {
      const ids = Object.entries(stateRef.current).filter(([, r]) => r.s !== "saved" && r.s !== "idle").map(([id]) => id);
      const results = await Promise.all(ids.map((id) => saveTracked(id)));
      return results.every(Boolean);
    },
  });

  /** Esc, X and Close: flush, wait, and close only when nothing is lost. */
  const requestClose = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    commitTasks();
    const ids = Object.entries(stateRef.current).filter(([, r]) => r.s === "dirty" || r.s === "saving" || r.s === "error").map(([id]) => id);
    const results = await Promise.all(ids.map((id) => (stateRef.current[id]?.s === "saving" ? inflight.current.get(id) ?? saveTracked(id) : saveTracked(id))));
    setClosing(false);
    if (results.every(Boolean) && !Object.values(stateRef.current).some((r) => r.s === "error")) { onClose(); return; }
    setConfirmClose(true);
  }, [closing, commitTasks, saveTracked, onClose]);

  const failedCount = Object.values(state).filter((r) => r.s === "error").length;

  const orgWeek = nominalWeekHours(orgSchedule);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) void requestClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Capacity</DialogTitle>
          <DialogDescription>
            Workspace default: {orgWeek}h per week, {describeSchedule(orgSchedule)}.{" "}
            {canEditOrgDefault ? <Link href="/settings/locale" className="text-brand-deep hover:underline">Change in Settings, Locale and work week</Link> : null}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-ink-2">
          Weekly hours also live on each person&apos;s record and in Members. Blank follows the person&apos;s schedule. A task with several assignees counts once for each of them, and its estimate is split evenly between them.
        </p>
        <ul className="max-h-[46vh] divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
          {people.map((p) => {
            const st = state[p.id];
            const own = effectivePersonSchedule(orgSchedule, p.workSchedule);
            return (
              <li key={p.id} className="flex min-h-9 items-center gap-2 px-3 py-1">
                <PersonAvatar person={p} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{personName(p)}</span>
                {p.canEditCapacity ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={168}
                      step={0.5}
                      inputMode="decimal"
                      aria-label={`Weekly hours for ${personName(p)}`}
                      placeholder={String(nominalWeekHours(own))}
                      value={values[p.id] ?? ""}
                      onChange={(e) => edit(p.id, e.target.value)}
                      onBlur={() => { if (stateRef.current[p.id]?.s === "dirty") void saveTracked(p.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveTracked(p.id); } }}
                      className="h-8 w-20 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums"
                    />
                    <span className="w-16 text-sm text-ink-2">h a week</span>
                    <span className="flex w-6 justify-center" aria-live="polite">
                      {st?.s === "saved" ? <Check className="h-4 w-4 text-success-text" aria-label="Saved" /> : null}
                      {st?.s === "error" ? (
                        <button type="button" onClick={() => void saveTracked(p.id)} title={st.error} aria-label={`Not saved: ${st.error}. Try again`} className="inline-flex h-6 w-6 items-center justify-center rounded text-danger-text hover:bg-hover">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="text-sm tabular-nums text-ink-2">{p.weeklyCapacityHours ?? nominalWeekHours(own)}h a week</span>
                )}
              </li>
            );
          })}
        </ul>
        {failedCount > 0 && !confirmClose ? (
          <p role="alert" className="text-sm text-danger-text">Some hours were not saved. Use the retry beside the row.</p>
        ) : null}
        <label className="flex items-center gap-3 text-sm text-ink">
          <span className="flex-1">Tasks per day (Tasks mode, just for you)</span>
          <input
            type="number"
            min={1}
            max={TASKS_MAX}
            value={tasks}
            onChange={(e) => setTasks(e.target.value)}
            onBlur={() => { commitTasks(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTasks(); } }}
            className="h-8 w-20 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums"
            aria-label="Tasks per day"
          />
        </label>
        {confirmClose ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[var(--os-danger-bg)] px-3 py-2 text-sm text-danger-text">
            <span className="min-w-0 flex-1">
              {failedCount === 1 ? "1 person's hours were not saved." : `${failedCount} people's hours were not saved.`} Closing now loses {failedCount === 1 ? "that change" : "those changes"}.
            </span>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>Keep editing</Button>
            <Button variant="ghost" onClick={onClose}>Discard and close</Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => void requestClose()} disabled={closing} aria-busy={closing}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
