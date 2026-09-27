"use client";

// CapacityModal (spec-teams-people section 3): the Workload grid's door onto
// each person's weekly hours. It writes the SAME column the person record
// and the Members drawer write (User.weeklyCapacityHours, PATCH
// /api/users/[id]), under the same per-field rule, so it is a third door and
// never a third store. Each row saves on blur (or Enter) with its own tick,
// a visible failure and one retry; a row the viewer may not write is shown
// read-only. Tasks per day is the viewer's own preference.

import { useState } from "react";
import Link from "next/link";
import { Check, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
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

type RowState = "idle" | "saving" | "saved" | "error";

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
  const saved = new Map(people.map((p) => [p.id, p.weeklyCapacityHours] as const));
  const busy = Object.values(state).some((r) => r.s === "saving");

  async function save(p: CapacityPerson, attempt = 0) {
    const raw = (values[p.id] ?? "").trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 168)) {
      setState((s) => ({ ...s, [p.id]: { s: "error", error: "0 to 168 hours, or blank for the default" } }));
      return;
    }
    if ((saved.get(p.id) ?? null) === next && state[p.id]?.s !== "error") return;
    setState((s) => ({ ...s, [p.id]: { s: "saving" } }));
    const r = await apiFetch(`/api/users/${p.id}`, { method: "PATCH", json: { weeklyCapacityHours: next }, keepalive: true });
    if (!r.ok) {
      // One quiet retry for a dropped connection; a refusal is shown at once.
      if (attempt === 0 && (r.status === 0 || r.status >= 500)) { void save(p, 1); return; }
      setState((s) => ({ ...s, [p.id]: { s: "error", error: r.error || "Not saved" } }));
      return;
    }
    saved.set(p.id, next);
    setState((s) => ({ ...s, [p.id]: { s: "saved" } }));
    onSaved(p.id, next);
  }

  const orgWeek = nominalWeekHours(orgSchedule);
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
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
                      onChange={(e) => { const v = e.target.value; setValues((s) => ({ ...s, [p.id]: v })); setState((s) => ({ ...s, [p.id]: { s: "idle" } })); }}
                      onBlur={() => void save(p)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(p); } }}
                      className="h-8 w-20 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums"
                    />
                    <span className="w-16 text-sm text-ink-2">h a week</span>
                    <span className="flex w-6 justify-center" aria-live="polite">
                      {st?.s === "saved" ? <Check className="h-4 w-4 text-success-text" aria-label="Saved" /> : null}
                      {st?.s === "error" ? (
                        <button type="button" onClick={() => void save(p)} title={st.error} aria-label={`Not saved: ${st.error}. Try again`} className="inline-flex h-6 w-6 items-center justify-center rounded text-danger-text hover:bg-hover">
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
        {Object.values(state).some((r) => r.s === "error") ? (
          <p role="alert" className="text-sm text-danger-text">Some hours were not saved. Use the retry beside the row.</p>
        ) : null}
        <label className="flex items-center gap-3 text-sm text-ink">
          <span className="flex-1">Tasks per day (Tasks mode, just for you)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={tasks}
            onChange={(e) => setTasks(e.target.value)}
            onBlur={() => { const n = Number(tasks); if (Number.isInteger(n) && n >= 1 && n <= 50) onDailyTasks(n); else setTasks(String(dailyTasks)); }}
            className="h-8 w-20 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums"
            aria-label="Tasks per day"
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
