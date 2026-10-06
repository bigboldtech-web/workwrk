"use client";

// The Routines tab of a teammate's settings (docs/plans/ai-teammates.md 3.9,
// 5.5): this person's own routines with it, never anyone else's (a routine
// runs as the person it is for). Each row: the name, the schedule in words
// in the viewer's zone, and "Next run {time}" or "Paused: {reason}"; its
// menu has Run now, Practice run, Pause or Resume, Edit and Delete. "New
// routine" opens the form: Name, What to do each time, and When, the
// schedule picker with its presets and Custom, which refuses anything more
// often than once an hour (routines.ts routineScheduleProblem) in the field
// itself.
//
// Run now and Practice run run the routine at once and write its report into
// the chat (POST /api/agents/routines/[id]/run); the row shows it working
// meanwhile. A refusal (paused, the month's AI questions, too many at once)
// shows the server's sentence. A removed teammate's routines can be paused,
// changed and deleted; no new one is made for it.

import { useMemo, useState } from "react";
import { FlaskConical, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { SchedulePicker } from "@/components/ai/schedule-picker";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dots } from "@/components/ui/dots";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { scheduleForSave, splitScheduleZone } from "@/lib/agents/cron";
import { ROUTINE_LIMITS, routineScheduleProblem } from "@/lib/agents/routines";
import {
  ROUTINE_COPY,
  TEAMMATE_CHAT,
  TEAMMATE_CHIPS,
  TEAMMATE_ERRORS,
  actionsFor,
  nextRunLine,
  pausedBecause,
  routineDidntFinish,
  routinePracticeToast,
  routineRanToast,
} from "@/lib/agents/teammate-copy";
import type { RoutineView, TeammateDetail } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useTeammateData } from "./use-teammate-data";

const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const LINK = "font-medium text-brand-deep hover:underline";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

/** A routine's schedule: hourly at most, as the route refuses (routines.ts). */
const routineSchedule = (s: string) => routineScheduleProblem(s) === null;

/** The viewer's zone: their saved preference, else the browser's (the Workspace agents drawer's rule). */
function useViewerZone(): string | null {
  const prefs = useDatePrefs();
  return useMemo(() => {
    if (prefs.timezone) return prefs.timezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, [prefs.timezone]);
}

export function RoutinesTab({ teammate: t }: { teammate: TeammateDetail }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const viewerZone = useViewerZone();
  const { data, error, reload, setData } = useTeammateData<{ routines: RoutineView[] }>(`/api/agents/teammates/${encodeURIComponent(t.slug)}/routines`, t.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: { current: HTMLElement | null } } | null>(null);
  const removed = t.status === "ARCHIVED";

  function replace(r: RoutineView) {
    setData((d) => (d ? { routines: d.routines.map((x) => (x.id === r.id ? r : x)) } : d));
  }

  async function create(v: { name: string; prompt: string; schedule: string }): Promise<boolean> {
    const r = await apiFetch<{ routine: RoutineView }>(`/api/agents/teammates/${encodeURIComponent(t.slug)}/routines`, { method: "POST", json: v });
    if (!r.ok) {
      // The route words its refusals (too often, the limits).
      toast(r.code ? r.error : ROUTINE_COPY.saveFailed, { tone: "danger" });
      return false;
    }
    setAdding(false);
    setData((d) => (d ? { routines: [...d.routines, r.data.routine] } : { routines: [r.data.routine] }));
    return true;
  }

  async function patch(routine: RoutineView, body: Record<string, unknown>, done?: string): Promise<boolean> {
    const r = await apiFetch<{ routine: RoutineView }>(`/api/agents/routines/${encodeURIComponent(routine.id)}`, { method: "PATCH", json: body });
    if (!r.ok) {
      toast(r.code ? r.error : ROUTINE_COPY.saveFailed, { tone: "danger" });
      return false;
    }
    replace(r.data.routine);
    if (done) toast(done);
    return true;
  }

  async function remove(routine: RoutineView) {
    const ok = await confirm({ title: ROUTINE_COPY.deleteTitle, description: ROUTINE_COPY.deleteBody, confirmLabel: ROUTINE_COPY.delete, destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/agents/routines/${encodeURIComponent(routine.id)}`, { method: "DELETE" });
    if (!r.ok) {
      toast(r.code ? r.error : ROUTINE_COPY.deleteFailed, { tone: "danger" });
      return;
    }
    setData((d) => (d ? { routines: d.routines.filter((x) => x.id !== routine.id) } : d));
  }

  async function run(routine: RoutineView, practice: boolean) {
    setRunning(routine.id);
    const r = await apiFetch<{ runId: string; status: "SUCCEEDED" | "FAILED"; messageId: string | null }>(`/api/agents/routines/${encodeURIComponent(routine.id)}/run`, {
      method: "POST",
      json: practice ? { practice: true } : {},
    });
    setRunning(null);
    if (!r.ok) {
      // The chat's own refusals: paused, removed, the month's AI questions, too many at once.
      toast(r.code ? r.error : ROUTINE_COPY.runFailed, { tone: "danger" });
      return;
    }
    if (r.data.status === "FAILED") toast(routineDidntFinish(routine.name), { tone: "danger" });
    else toast(practice ? routinePracticeToast(routine.name) : routineRanToast(routine.name));
    // Its report is in the chat, and the row's last run moved.
    notifyAiChatsChanged();
    void reload();
  }

  const routines = data?.routines ?? null;
  const open = menu ? routines?.find((r) => r.id === menu.id) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      {!removed ? (
        adding ? (
          <RoutineForm viewerZone={viewerZone} onSave={create} onCancel={() => setAdding(false)} />
        ) : (
          <div>
            <button type="button" className={SECONDARY} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {ROUTINE_COPY.newRoutine}
            </button>
          </div>
        )
      ) : null}

      {routines === null && error ? (
        <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
          {ROUTINE_COPY.loadError} ·
          <button type="button" className={LINK} onClick={() => void reload()}>
            {TEAMMATE_CHAT.tryAgain}
          </button>
        </div>
      ) : routines === null ? (
        <SkeletonRows rows={3} />
      ) : routines.length === 0 ? (
        <div className="flex flex-col gap-1 py-2">
          <p className="m-0 text-base text-ink-2">{ROUTINE_COPY.empty}</p>
          <p className="m-0 text-sm text-ink-3">{ROUTINE_COPY.emptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col rounded-md border border-line">
          {routines.map((r) => (
            <li key={r.id} className="border-t border-line-soft px-3 py-2 first:border-t-0">
              {editing === r.id ? (
                <RoutineForm
                  initial={r}
                  viewerZone={viewerZone}
                  onSave={async (v) => {
                    const body: Record<string, unknown> = {};
                    if (v.name !== r.name) body.name = v.name;
                    if (v.prompt !== r.prompt) body.prompt = v.prompt;
                    if (v.schedule !== r.schedule) body.schedule = v.schedule;
                    if (Object.keys(body).length === 0) {
                      setEditing(null);
                      return true;
                    }
                    const ok = await patch(r, body);
                    if (ok) setEditing(null);
                    return ok;
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words text-base font-medium text-ink">{r.name}</p>
                    <p className="m-0 text-sm text-ink-2">{r.when}</p>
                    {r.status === "paused" ? (
                      <p className="m-0 text-sm text-ink-2">{r.pausedText ? pausedBecause(r.pausedText) : TEAMMATE_CHIPS.paused}</p>
                    ) : r.nextRunAt ? (
                      <p className="m-0 text-sm text-ink-2" title={formatDateTitle(r.nextRunAt, datePrefs)}>
                        {nextRunLine(formatDate(r.nextRunAt, datePrefs, "datetime"))}
                      </p>
                    ) : null}
                  </div>
                  {running === r.id ? (
                    <span className="flex h-7 shrink-0 items-center">
                      <Dots variant="pending" label={TEAMMATE_CHAT.working} />
                    </span>
                  ) : r.status === "paused" ? (
                    <StatusChip color={RUN_TONE_COLOR.neutral} label={TEAMMATE_CHIPS.paused} className="shrink-0" />
                  ) : null}
                  <button
                    type="button"
                    aria-label={actionsFor(r.name)}
                    title={actionsFor(r.name)}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === r.id}
                    disabled={running !== null}
                    onClick={(e) => setMenu(menu?.id === r.id ? null : { id: r.id, anchor: { current: e.currentTarget } })}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60"
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {menu && open ? (
        <MorePortal anchorRef={menu.anchor} width={200} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={actionsFor(open.name)}>
            {!removed && open.status === "active" ? (
              <>
                <MenuItem
                  icon={Play}
                  label={ROUTINE_COPY.runNow}
                  onClick={() => {
                    setMenu(null);
                    void run(open, false);
                  }}
                />
                <MenuItem
                  icon={FlaskConical}
                  label={ROUTINE_COPY.practiceRun}
                  onClick={() => {
                    setMenu(null);
                    void run(open, true);
                  }}
                />
              </>
            ) : null}
            {open.status === "active" ? (
              <MenuItem
                icon={Pause}
                label={ROUTINE_COPY.pause}
                onClick={() => {
                  setMenu(null);
                  void patch(open, { status: "paused" }, TEAMMATE_CHAT.routinePaused);
                }}
              />
            ) : !removed ? (
              <MenuItem
                icon={Play}
                label={ROUTINE_COPY.resume}
                onClick={() => {
                  setMenu(null);
                  void patch(open, { status: "active" }, ROUTINE_COPY.resumed);
                }}
              />
            ) : null}
            <MenuItem
              icon={Pencil}
              label={ROUTINE_COPY.edit}
              onClick={() => {
                setMenu(null);
                setEditing(open.id);
              }}
            />
            <MenuSeparator />
            <MenuItem
              icon={Trash2}
              label={ROUTINE_COPY.delete}
              destructive
              onClick={() => {
                setMenu(null);
                void remove(open);
              }}
            />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

/** New routine, or a change to one: Name, What to do each time, When. */
function RoutineForm({
  initial,
  viewerZone,
  onSave,
  onCancel,
}: {
  initial?: RoutineView;
  viewerZone: string | null;
  onSave: (v: { name: string; prompt: string; schedule: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  // The schedule as it is saved: a picked time carries the viewer's zone (CRON_TZ=).
  const [schedule, setSchedule] = useState(initial?.schedule ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const why = !name.trim()
      ? ROUTINE_COPY.nameRequired
      : !prompt.trim()
        ? ROUTINE_COPY.whatToDoRequired
        : !schedule
          ? ROUTINE_COPY.chooseWhen
          : routineScheduleProblem(schedule) === "too_often"
            ? TEAMMATE_ERRORS.routineTooOften
            : routineScheduleProblem(schedule)
              ? TEAMMATE_ERRORS.routineInvalid
              : null;
    setProblem(why);
    if (why) return;
    setBusy(true);
    await onSave({ name: name.trim(), prompt: prompt.trim(), schedule });
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-subtle p-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {ROUTINE_COPY.name}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={ROUTINE_LIMITS.nameMax}
          placeholder={ROUTINE_COPY.namePlaceholder}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        {ROUTINE_COPY.whatToDo}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={ROUTINE_LIMITS.promptMax}
          rows={3}
          placeholder={ROUTINE_COPY.whatToDoPlaceholder}
          className="block w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">{ROUTINE_COPY.when}</span>
        <SchedulePicker
          cron={schedule || null}
          zone={splitScheduleZone(schedule).zone}
          viewerZone={viewerZone}
          isValid={routineSchedule}
          onChange={(cron) => {
            setSchedule(scheduleForSave(cron, viewerZone));
            setProblem(null);
            return true;
          }}
        />
        <span className="text-sm text-ink-2">{ROUTINE_COPY.whenHelper}</span>
      </div>
      {problem ? (
        <p role="alert" className="m-0 text-sm text-danger-text">
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={GHOST} disabled={busy} onClick={onCancel}>
          {ROUTINE_COPY.cancel}
        </button>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => void save()}>
          {ROUTINE_COPY.save}
        </button>
      </div>
    </div>
  );
}
