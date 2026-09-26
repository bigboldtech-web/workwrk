"use client";

// Schedule report (gap 16): the one dialog behind "Schedule report" on a
// dashboard and on a saved List view. It is self-contained on purpose (its own
// fetches, its own toasts, its own ui/dialog, no provider) so a host only has
// to hold `open` and pass the target.
//
//   You receive this report   schedules the viewer is ON, from anyone, each
//                             with "Stop receiving" (it only ever removes them)
//   Schedules                 the viewer's own (every one, for an org admin):
//                             cadence, recipients, an Active switch, last and
//                             next run, Edit and Delete
//   New schedule / Edit       ScheduleForm
//
// Every write is busy-locked (a duplicate schedule emails everyone twice) and
// every edit is a compare-and-swap: a 409 re-reads the schedule and rebases
// the form onto it with only this person's own changes (rebaseScheduleForm),
// so someone who removed themselves in the meantime is never put back, and
// nothing is sent again without the person pressing Save.
//
// What it promises is what the cron does: each copy is computed under its
// recipient's own access. Recipients are org members picked by id; there is no
// address field anywhere.

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar-stack";
import { Switch } from "@/components/ui/switch";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { OsShellContext, useLayer } from "@/components/layout/os/shell-context";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { newCreateRequestId } from "@/lib/create-request-id";
import {
  cadenceLabel,
  defaultTimezone,
  emptyScheduleForm,
  formFromSchedule,
  formProblems,
  formToCreateBody,
  formToPatchBody,
  formatRunTime,
  issueFields,
  rebaseScheduleForm,
  type ScheduleFormState,
} from "@/lib/reports/schedule-form";
import type { ReportCadence } from "@/lib/reports/schedule";
import { cn } from "@/lib/utils";
import { ScheduleForm } from "./schedule-form";

export interface ScheduleReportTarget {
  kind: "dashboard" | "view";
  /** The Dashboard id, or the View id for a saved List view. */
  id: string;
  /** Shown under the dialog title. A view passes "List: View", as its email does. */
  name: string;
  /** The view's ownerId when the view is private (isShared false), else null. */
  privateOwnerId?: string | null;
}

// The view types whose content is the task set, so a report of them is the
// "open, overdue and done counts plus the next 10 tasks" the email describes.
// A Doc, Form, Whiteboard or Chart view is something else, and a report that
// ignored what the view is would promise the wrong thing.
export const SCHEDULABLE_VIEW_TYPES: ReadonlySet<string> = new Set([
  "TABLE",
  "KANBAN",
  "CALENDAR",
  "GANTT",
  "TIMELINE",
  "HIERARCHY",
  "CARDS",
  "MAP",
]);

interface ScheduleRow {
  id: string;
  targetKind: string;
  /** Null when the viewer cannot read the target (never this dialog's own). */
  targetId: string | null;
  targetName: string | null;
  cadence: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
  recipients: Array<{ id: string; firstName: string; lastName: string; avatar: string | null; active: boolean }>;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRun: { outcome: string; sent?: number; skippedNoAccess?: number; skippedInactive?: number } | null;
  updatedAt: string;
  canEdit: boolean;
}

interface ReceivedRow {
  id: string;
  targetKind: string;
  targetId: string | null;
  cadence: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
  /** Paused by its creator: no email goes out, and nextRunAt is null. */
  active: boolean;
  nextRunAt: string | null;
  createdBy: { firstName: string; lastName: string } | null;
}

type Editing = { id: string; updatedAt: string; openedWith: ScheduleFormState } | null;

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function specOfRow(r: { cadence: string; weekday: number | null; monthDay: number | null; timeOfDay: string; timezone: string }) {
  const cadence: ReportCadence = r.cadence === "daily" || r.cadence === "monthly" ? r.cadence : "weekly";
  return { cadence, weekday: r.weekday, monthDay: r.monthDay, timeOfDay: r.timeOfDay, timezone: r.timezone };
}

export function ScheduleReportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ScheduleReportTarget;
}): JSX.Element | null {
  if (!props.open) return null;
  return <ScheduleReportBody target={props.target} onOpenChange={props.onOpenChange} />;
}

function ScheduleReportBody({ target, onOpenChange }: { target: ScheduleReportTarget; onOpenChange: (open: boolean) => void }) {
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const prefs = useDatePrefs();
  const viewerId = boot.viewer.id;
  const privateView = target.kind === "view" && !!target.privateOwnerId;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsDb, setNeedsDb] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [received, setReceived] = useState<ReceivedRow[]>([]);
  const [cronInstalled, setCronInstalled] = useState(true);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<ScheduleFormState>(() =>
    emptyScheduleForm({ timezone: defaultTimezone(prefs.timezone), viewerId, privateOwnerId: target.privateOwnerId ?? null }),
  );
  const [errors, setErrors] = useState<ReturnType<typeof issueFields>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // Why the open form was re-based onto a stored schedule: someone changed it
  // (a 409), or a Retry found that the first try had already created it.
  const [rebased, setRebased] = useState<false | "changed" | "created">(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // Delete asks inside its own row rather than through the app's confirm
  // dialog, so this dialog needs no provider and never stacks a second modal.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  // The time zone or recipient list is open. Both are absolutely positioned
  // children (never portalled, because ui/dialog centres itself with a
  // transform), so the scrolling body would clip a list that opens near the
  // foot of the form: while one is open, and the form fits the body without
  // it, nothing clips. A form taller than the body (a short window) keeps
  // scrolling instead, because switching then would lose the scroll position
  // under the pointer; the open list extends the scroll area there.
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    if (pickerOpen) return;
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFits(el.scrollHeight <= el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [pickerOpen, mode, loading]);
  const unclipped = mode === "form" && pickerOpen && fits;

  const lock = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // A shell layer while open (the Customize panel's pattern): the host page's
  // blue primary gives way, Esc closes an open picker before the dialog, and
  // the dialog will not close while a save is on the wire. Outside the shell
  // (no provider) this is a no-op and Radix handles Esc itself.
  const shell = useContext(OsShellContext);
  const closeRef = useRef(onOpenChange);
  const savingRef = useRef(false);
  useEffect(() => {
    closeRef.current = onOpenChange;
    savingRef.current = saving;
  });
  useLayer(true, { kind: "dialog", close: () => closeRef.current(false), canClose: () => !savingRef.current });

  const load = useCallback(async (): Promise<{ own: ScheduleRow[]; received: ReceivedRow[] } | null> => {
    setLoadError(null);
    try {
      const qs = `targetKind=${encodeURIComponent(target.kind)}&targetId=${encodeURIComponent(target.id)}`;
      const [a, b] = await Promise.all([
        fetch(`/api/report-schedules?${qs}`, { cache: "no-store" }),
        fetch(`/api/report-schedules?received=1`, { cache: "no-store" }),
      ]);
      const [ab, bb] = await Promise.all([readJson(a), readJson(b)]);
      if (a.status === 503 || b.status === 503) {
        setNeedsDb(true);
        return null;
      }
      if (!a.ok || !b.ok) {
        setLoadError(dashboardMessage(!a.ok ? ab : bb, "Couldn't load the schedules for this report."));
        return null;
      }
      const own = ((ab as { schedules?: ScheduleRow[] })?.schedules ?? []).filter((s) => s.targetKind === target.kind && s.targetId === target.id);
      const mine = ((bb as { schedules?: ReceivedRow[] })?.schedules ?? []).filter((s) => s.targetKind === target.kind && s.targetId === target.id);
      setSchedules(own);
      setReceived(mine);
      setCronInstalled((ab as { cronInstalled?: boolean })?.cronInstalled !== false);
      return { own, received: mine };
    } catch {
      setLoadError("Couldn't reach the server. Check your connection and try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [target.kind, target.id]);

  // First read: the lists, then straight to the form when there is nothing
  // to list yet. Someone who only RECEIVES this report lands on the list,
  // where their "Stop receiving" is, never on a blank New schedule.
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await load();
      if (!live || !r) return;
      if (r.own.length === 0 && r.received.length === 0) setMode("form");
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const startNew = () => {
    createIdRef.current = null;
    setEditing(null);
    setForm(emptyScheduleForm({ timezone: defaultTimezone(prefs.timezone), viewerId, privateOwnerId: target.privateOwnerId ?? null }));
    setErrors({});
    setSaveMessage(null);
    setRebased(false);
    setMode("form");
  };

  const startEdit = (s: ScheduleRow) => {
    const f = formFromSchedule(s);
    setEditing({ id: s.id, updatedAt: s.updatedAt, openedWith: f });
    setForm(f);
    setErrors({});
    setSaveMessage(null);
    setRebased(false);
    setMode("form");
  };

  // ── rows ──

  const stopReceiving = async (r: ReceivedRow) => {
    if (busy.has(r.id)) return;
    lock(r.id, true);
    try {
      const res = await fetch(`/api/report-schedules/${r.id}/recipients/me`, { method: "DELETE" });
      const body = await readJson(res);
      if (!res.ok && res.status !== 404) {
        toast(dashboardMessage(body, "Couldn't take you off this report."), { tone: "danger", action: { label: "Try again", onClick: () => void stopReceiving(r) } });
        return;
      }
      toast("You no longer receive this report");
      await load();
    } finally {
      lock(r.id, false);
    }
  };

  const setActive = async (s: ScheduleRow, active: boolean, attempt = 0): Promise<void> => {
    if (busy.has(s.id) && attempt === 0) return;
    lock(s.id, true);
    try {
      const res = await fetch(`/api/report-schedules/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: s.updatedAt, active }),
      });
      const body = await readJson(res);
      if (res.ok) {
        const next = (body as { schedule?: ScheduleRow })?.schedule;
        if (next) setSchedules((prev) => prev.map((x) => (x.id === s.id ? next : x)));
        return;
      }
      if (res.status === 409 && attempt === 0) {
        // One field, so re-applying it on the fresh version cannot undo
        // anyone else's change (the recipients are not sent).
        const fresh = await load();
        const row = fresh?.own.find((x) => x.id === s.id);
        if (row && row.active !== active) return setActive(row, active, 1);
        return;
      }
      // A private view whose only recipients are colleagues can never resume
      // from the switch: resending the same request would be refused again
      // every time. Point the person at the form, where Send only to me is.
      if ((body as { error?: unknown } | null)?.error === "private_view_recipients") {
        toast(`${dashboardMessage(body, "Couldn't change the schedule.")} Edit the schedule to send it to its owner.`, {
          tone: "danger",
          action: { label: "Edit", onClick: () => startEdit(s) },
        });
        return;
      }
      toast(dashboardMessage(body, "Couldn't change the schedule."), { tone: "danger", action: { label: "Try again", onClick: () => void setActive(s, active) } });
    } finally {
      lock(s.id, false);
    }
  };

  const remove = async (s: ScheduleRow) => {
    if (busy.has(s.id)) return;
    setConfirmingDelete(null);
    lock(s.id, true);
    try {
      const res = await fetch(`/api/report-schedules/${s.id}`, { method: "DELETE" });
      const body = await readJson(res);
      if (!res.ok) {
        toast(dashboardMessage(body, "Couldn't delete the schedule."), { tone: "danger", action: { label: "Try again", onClick: () => void remove(s) } });
        return;
      }
      toast("Schedule deleted");
      const r = await load();
      if (r && r.own.length === 0 && r.received.length === 0) startNew();
    } finally {
      lock(s.id, false);
    }
  };

  // ── save ──

  const problems = useMemo(() => formProblems(form), [form]);
  const canSave = Object.keys(problems).length === 0 && !saving;

  // The lock is a ref, so a second click in the same frame is refused before
  // React has drawn the busy button: two POSTs would be two schedules, and
  // everyone on them would get every email twice.
  const saveLock = useRef(false);
  // One id per new schedule, kept across its Retry: a create that committed
  // but lost its answer is answered with the schedule it made, never a second
  // one (create-request-id). A New schedule starts a fresh id.
  const createIdRef = useRef<string | null>(null);
  const save = async () => {
    if (saving || saveLock.current) return;
    const local = formProblems(form);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setErrors({});
    setSaveMessage(null);
    try {
      const res = editing
        ? await fetch(`/api/report-schedules/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(formToPatchBody(form, { ...editing.openedWith, updatedAt: editing.updatedAt })),
          })
        : await fetch("/api/report-schedules", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...formToCreateBody(form, { kind: target.kind, id: target.id }), requestId: (createIdRef.current ??= newCreateRequestId()) }),
          });
      const body = await readJson(res);
      const replayed = !editing && res.ok ? ((body as { replayed?: unknown; schedule?: ScheduleRow } | null) ?? null) : null;
      if (replayed?.replayed === true && replayed.schedule) {
        createIdRef.current = null;
        const stored = formFromSchedule(replayed.schedule);
        const key = (f: ScheduleFormState) => {
          const b = formToCreateBody(f, { kind: target.kind, id: target.id });
          return JSON.stringify({ ...b, recipientUserIds: [...b.recipientUserIds].sort() });
        };
        const sameAsSent = key(stored) === key(form);
        if (!sameAsSent) {
          // The person changed the form after the lost answer: the schedule
          // exists with the earlier settings, so the form now edits it and
          // their latest input waits for Save (a PATCH, not a second POST).
          setEditing({ id: replayed.schedule.id, updatedAt: replayed.schedule.updatedAt, openedWith: stored });
          setRebased("created");
          void load();
          return;
        }
      }
      if (res.ok) {
        if (!editing) createIdRef.current = null;
        toast(editing ? "Schedule saved" : "Report scheduled");
        setEditing(null);
        setRebased(false);
        await load();
        setMode("list");
        return;
      }
      if (res.status === 409 && editing) {
        // Someone changed it since this form opened: rebase, say so, and wait
        // for an explicit Save.
        const r2 = await fetch(`/api/report-schedules/${editing.id}`, { cache: "no-store" });
        const b2 = (await readJson(r2)) as { schedule?: ScheduleRow } | null;
        if (r2.ok && b2?.schedule) {
          const reloaded = formFromSchedule(b2.schedule);
          setForm(rebaseScheduleForm(form, editing.openedWith, reloaded));
          setEditing({ id: editing.id, updatedAt: b2.schedule.updatedAt, openedWith: reloaded });
          setRebased("changed");
          void load();
          return;
        }
        setSaveMessage(r2.status === 404 ? "You can no longer see this." : "This schedule changed. Close this and open it again.");
        return;
      }
      const code = (body as { error?: unknown } | null)?.error;
      if (res.status === 503) {
        // One quiet line beside the buttons, and the form stays as it is.
        setSaveMessage(dashboardMessage(body, "Scheduled reports need a database update before they can be used here."));
        return;
      }
      if (code === "invalid_schedule") {
        const f = issueFields((body as { issues?: unknown }).issues);
        setErrors(f);
        setSaveMessage(f.form ?? null);
        return;
      }
      if (res.status === 404) {
        setSaveMessage("You can no longer see this.");
        return;
      }
      setSaveMessage(dashboardMessage(body, "Couldn't save the schedule."));
    } catch {
      setSaveMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const failed = !!saveMessage || Object.keys(errors).length > 0;
  const primaryLabel = failed ? "Retry" : editing ? "Save" : "Create schedule";

  return (
    <Dialog open onOpenChange={(o) => (!saving ? onOpenChange(o) : undefined)}>
      <DialogContent
        className={cn("max-w-[600px] gap-0 p-0 outline-none", unclipped && "overflow-visible")}
        onInteractOutside={(e) => {
          if (mode === "form") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!shell) return;
          e.preventDefault();
          shell.closeTopLayer();
        }}
      >
        <div className="flex flex-col gap-0.5 border-b border-line px-5 py-3 pe-12">
          <DialogTitle className="text-base">Schedule report</DialogTitle>
          <DialogDescription className="truncate text-sm text-ink-2" title={target.name}>{target.name}</DialogDescription>
        </div>

        <div ref={bodyRef} className={cn("flex flex-col gap-4 px-5 py-4", unclipped ? "max-h-[65vh] overflow-visible" : "max-h-[65vh] overflow-y-auto")}>
          {needsDb ? (
            <p className="m-0 text-sm text-ink-2">Scheduled reports need a database update before they can be used here.</p>
          ) : loading ? (
            <SkeletonLines lines={4} />
          ) : loadError ? (
            <div className="flex flex-col items-start gap-1.5">
              <p className="m-0 text-sm text-ink-2">{loadError}</p>
              <button type="button" onClick={() => void load()} className="text-sm font-medium text-brand-deep hover:underline">
                Try again
              </button>
            </div>
          ) : (
            <>
              {!cronInstalled ? (
                <p className="m-0 rounded-md bg-subtle px-3 py-2 text-xs text-ink-2">
                  Sending is not switched on for this workspace yet. Schedules are kept and start sending once it is.
                </p>
              ) : null}

              {received.length > 0 && mode === "list" ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="m-0 text-micro uppercase tracking-[0.06em] text-ink-2">You receive this report</h3>
                  {received.map((r) => {
                    const sender = r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : "";
                    return (
                    <div key={r.id} className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 py-1.5">
                      <CalendarClock className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{cadenceLabel(specOfRow(r), prefs)}</span>
                        {sender ? <span className="block truncate text-xs text-ink-2">from {sender}</span> : null}
                        {/* The recipient's own answer to "why did no email come": a
                            paused schedule says so instead of reading like one that
                            still sends. It does not name who paused it: an Org admin
                            can pause someone else's schedule, and the row only knows
                            who made it. */}
                        <span className="block truncate text-xs text-ink-2">
                          {r.active && r.nextRunAt ? `Next ${formatRunTime(r.nextRunAt, r.timezone, prefs)}` : "Paused, no emails are being sent"}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={busy.has(r.id)}
                        onClick={() => void stopReceiving(r)}
                        className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4"
                      >
                        Stop receiving
                      </button>
                    </div>
                    );
                  })}
                </section>
              ) : null}

              {mode === "list" ? (
                <section className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="m-0 text-micro uppercase tracking-[0.06em] text-ink-2">Schedules</h3>
                    <button type="button" onClick={startNew} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                      New schedule
                    </button>
                  </div>
                  {schedules.length === 0 ? (
                    <p className="m-0 text-sm text-ink-2">You haven&apos;t scheduled this report.</p>
                  ) : (
                    schedules.map((s) => {
                      const counts = s.lastRun && typeof s.lastRun.sent === "number" ? s.lastRun : null;
                      return (
                        <div key={s.id} className="flex flex-col gap-1.5 rounded-md border border-line px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <CalendarClock className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{cadenceLabel(specOfRow(s), prefs)}</span>
                            <Switch checked={s.active} disabled={busy.has(s.id)} onChange={(on) => void setActive(s, on)} aria-label={s.active ? "Pause this schedule" : "Turn this schedule on"} />
                          </div>
                          <div className="flex flex-wrap items-center gap-1 ps-6">
                            {s.recipients.map((p) => (
                              <span key={p.id} title={p.active ? `${p.firstName} ${p.lastName}`.trim() : "No longer receives reports"} className={p.active ? "" : "opacity-40 grayscale"}>
                                <Avatar person={p} size={20} />
                              </span>
                            ))}
                            <span className="ms-1 text-xs text-ink-2">
                              {s.recipients.length === 1 ? "1 person" : `${s.recipients.length} people`}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-6 text-xs text-ink-2">
                            <span>{s.lastRunAt ? `Last run ${formatRunTime(s.lastRunAt, s.timezone, prefs)}` : "Not run yet"}</span>
                            {counts ? (
                              <span>
                                Sent to {counts.sent}
                                {counts.skippedNoAccess ? `, ${counts.skippedNoAccess} without access` : ""}
                                {counts.skippedInactive ? `, ${counts.skippedInactive} inactive` : ""}
                              </span>
                            ) : null}
                            <span>{s.active && s.nextRunAt ? `Next ${formatRunTime(s.nextRunAt, s.timezone, prefs)}` : "Paused"}</span>
                            <span className="flex-1" />
                            <button type="button" onClick={() => startEdit(s)} className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-medium text-ink-2 hover:bg-hover hover:text-ink">
                              <Pencil className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy.has(s.id)}
                              onClick={() => setConfirmingDelete(s.id)}
                              className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-medium text-danger-text hover:bg-danger-bg disabled:text-ink-4"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                              Delete
                            </button>
                          </div>
                          {confirmingDelete === s.id ? (
                            <div role="alertdialog" aria-label="Delete this schedule?" className="ms-6 flex flex-wrap items-center gap-2 rounded-md bg-danger-bg px-2.5 py-2 text-xs text-ink">
                              <span className="min-w-0 flex-1">Delete this schedule? Nobody on it gets this report any more; the {target.kind === "dashboard" ? "dashboard" : "view"} itself is not changed.</span>
                              <button type="button" onClick={() => setConfirmingDelete(null)} className="rounded px-2 py-1 font-medium text-ink-2 hover:bg-hover hover:text-ink">
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busy.has(s.id)}
                                onClick={() => void remove(s)}
                                className="rounded bg-danger-solid px-2 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </section>
              ) : (
                <section className="flex flex-col gap-2">
                  <h3 className="m-0 text-micro uppercase tracking-[0.06em] text-ink-2">{editing ? "Edit schedule" : "New schedule"}</h3>
                  {rebased ? (
                    <p role="status" className="m-0 rounded-md bg-warning-bg px-3 py-2 text-xs text-ink">
                      {rebased === "created"
                        ? "Your first try created this schedule, with the settings you had then. Your latest changes are kept; save to apply them."
                        : "This schedule changed since you opened it. Your changes are kept; check them and save again."}
                    </p>
                  ) : null}
                  <ScheduleForm
                    form={form}
                    onChange={(f) => {
                      setForm(f);
                      if (Object.keys(errors).length) setErrors({});
                    }}
                    kind={target.kind}
                    privateView={privateView}
                    errors={errors}
                    prefs={prefs}
                    disabled={saving}
                    onPickerOpenChange={setPickerOpen}
                  />
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex min-h-14 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-2.5">
          {mode === "form" && saveMessage ? (
            <p role="alert" className="m-0 me-auto min-w-0 flex-1 text-sm text-danger-text">
              {saveMessage}
            </p>
          ) : null}
          {mode === "form" && !needsDb && !loading && !loadError ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (schedules.length > 0 || received.length > 0) {
                    setMode("list");
                    setEditing(null);
                    setSaveMessage(null);
                    setErrors({});
                    setRebased(false);
                  } else onOpenChange(false);
                }}
                className="inline-flex h-9 items-center rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:text-ink-4"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void save()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4"
              >
                {saving ? (
                  <span className="os-pending" role="status" aria-label="Saving">
                    <i /><i /><i /><i />
                  </span>
                ) : null}
                {primaryLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-9 items-center rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover"
            >
              Done
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
