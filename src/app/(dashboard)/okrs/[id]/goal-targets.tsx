"use client";

// Targets card on the goal page (spec-goals /okrs/[id] body 3). One 36px
// row per target (two lines below 640, so nothing is cut on a phone):
// name · "Start 0 to Now 42 to Target 100 units" · a 72px
// bar and % · the last check-in · a 28px Check in for people who may check in
// (owner, contributors, the owner's manager chain, the People team, Admin) ·
// a row "..." (Check in, View history, Delete target for target writers).
// A target fed by a KPI shows "From KPI {name}" instead of Check in; the
// server refuses hand check-ins on it (409). The last row is "+ Add target",
// an inline composer (name, start, target, unit; Enter saves, Esc cancels)
// for target writers. Writes: POST /api/okrs/[id]/key-results, DELETE
// /api/okrs/[id]/key-results/[krId], POST /api/okrs/[id]/check-in, then
// router.refresh() so the ring, the verdict and Activity repaint.
//
// A REPEATING GOAL (docs/plans/recurring-goals.md E2, B5, B7): the card shows
// the period on screen. Under its title a line says where that period stands
// ("Open for late numbers until 5 Nov", "Open for KPI numbers until 30 Nov",
// "Closing", "Closed on 6 Nov"); a check-in in a period that has ended lands
// in that period (periodKey); a closed period's rows are read only; a carried
// target reads "Carried from October" in place of its last check-in; and a
// deleted target's closed rows still show. Adding, editing and deleting
// targets happen on the period running now, so a past period's card offers
// none of them; a target that a period which has ended but not closed still
// holds can't be deleted until that close, and Delete target says so, with
// the day, before any confirm (fixes review M1). While the period before the
// one running now still takes numbers, the card of the period running now
// says so, with a link to it ("October still takes late numbers until 5
// Nov." · "Check in for October", final review H1; "Open October" when no
// row of October takes a hand check-in, fixes review L5). A goal that has
// not started takes targets but no check-in (final review H2).
//
// THE TARGET EDITOR (E3), only while the RECURRING_GOALS switch is on: "Edit
// target" in the row menu and "Count from a List or table" on the composer
// open it (final review M7). With the switch off neither renders. Closing
// it, or the check-in, from the row menu puts focus back on the row's "..."
// (final review M9).
//
// A TARGET COUNTED FROM A LIST OR A TABLE (C3, C5, C7, C9, C10): its side
// column names the source ("From Sales pipeline", "From Hiring log"), or
// "From a private List" or "From a private table" for a viewer who cannot
// open it (the number shows for everyone). From 1280 up that is a column of
// the row; below it, a line under the row, so it is never hidden (final
// review H3). A paused source shows a line under the row for everyone,
// "Paused. The last number counted stands.", and for editors the reason
// after it ("Paused from 14 Oct" in a closed period); no tooltip carries
// anything the row does not show. Its row menu adds Count again (anyone who
// may check in), Open source (a viewer who can open it) and, while paused,
// Reconnect (an editor who can open it, who becomes its connector; neither
// for a table while the Tables module is off). When the card mounts for
// someone who may check in, it asks POST /api/okrs/[id]/refresh once
// (sources counted more than 10 minutes ago) and repaints if a number moved.

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, History, MoreHorizontal, Pencil, Plug, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { OkrCheckInModal } from "./okr-checkin-modal";
import { TargetEditor, type KpiCombineChoice, type TargetEditorGoal, type TargetEditorInitial } from "./target-editor";
import { PAUSED_STANDS, PAUSED_WORD } from "@/lib/goals/goal-source";

export interface TargetRowData {
  id: string;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  /** Measured by a linked role KPI: check-ins are refused server-side. */
  isDerived: boolean;
  kpiName: string | null;
  /** Pre-formatted relative time of the last check-in (server clock). */
  lastCheckIn: string | null;
  /** The KPI it reads, what each period starts at and a quarterly or yearly KPI combine (the target editor's starting values). */
  kpiId?: string | null;
  periodStart?: string | null;
  kpiCombine?: KpiCombineChoice | null;
  /** "October": carried from the period before until someone checks in (B4). */
  carriedFrom?: string | null;
  /** Its target was deleted since; the closed period keeps its row (B5). */
  deleted?: boolean;
  /**
   * Why it can't be deleted yet, or null: a period that has ended but not
   * closed still holds a row of it ("October still takes numbers until 5
   * Nov, so this target can't be deleted yet. Delete it after that.", B5,
   * fixes review M1). The server's words, so Delete says them before any
   * confirm.
   */
  deleteRefusal?: string | null;
  /** Counted from a List or a table (C3, C5), as this viewer may see it (C9, C10). */
  source?: {
    /** What it counts (the editor's Measured by); a List when not sent. */
    kind?: "list" | "table";
    label: string;
    private: boolean;
    href: string | null;
    /** Reconnect may be offered: the viewer can open it, and for a table Tables is on. */
    reconnectable?: boolean;
    connectorName: string | null;
    paused: string | null;
    pausedSince?: string | null;
    /** "14 Oct": the day it paused, in the workspace zone (formatted on the server). */
    pausedFrom?: string | null;
    settings: Record<string, unknown> | null;
  } | null;
}

/**
 * What measures the target, as the row names it (H3): its source ("From
 * Sales pipeline"), its KPI, or "Carried from October"; null for a target
 * checked in by hand, whose side column shows its last check-in instead.
 */
export function targetSourceText(t: Pick<TargetRowData, "source" | "isDerived" | "kpiName" | "carriedFrom">): string | null {
  if (t.source) return t.source.label;
  if (t.isDerived) return `From KPI ${t.kpiName ?? ""}`.trim();
  if (t.carriedFrom) return `Carried from ${t.carriedFrom}`;
  return null;
}

/**
 * The line under a paused target, for everyone (final review H3): "Paused.
 * The last number counted stands." and, for an editor (whom the server
 * sent the reason), the reason after it. In a closed period it names the
 * day it paused: "Paused from 14 Oct. The last number counted stands."
 */
export function pausedLine(source: TargetRowData["source"] | null | undefined, closed: boolean): string | null {
  if (!source?.paused) return null;
  const head = closed && source.pausedFrom ? `Paused from ${source.pausedFrom}.` : "Paused.";
  const reason = source.paused !== PAUSED_WORD ? ` ${source.paused}` : "";
  return `${head} ${PAUSED_STANDS}${reason}`;
}

type ConfirmOpts = NonNullable<Parameters<ReturnType<typeof useConfirm>>[0]>;

/**
 * The dialog Delete target opens (B5, fixes review M1). A target a period
 * still taking numbers holds can't go yet: the dialog says why, with one OK
 * and nothing to delete. Otherwise the confirm; on a repeating goal its
 * closed periods keep their rows.
 */
export function deleteTargetDialog(t: Pick<TargetRowData, "title" | "deleteRefusal">, repeating: boolean): { refused: boolean; opts: ConfirmOpts } {
  if (t.deleteRefusal) return { refused: true, opts: refusedDeleteDialog(t.title, t.deleteRefusal) };
  return {
    refused: false,
    opts: {
      title: `Delete ${t.title}?`,
      description: repeating
        ? "Its check-ins go with it. Its past results stay in Past periods. This can't be undone."
        : "Its check-ins go with it and the goal's progress re-rolls from the targets left. This can't be undone.",
      destructive: true,
      confirmLabel: "Delete target",
    },
  };
}

/** The refusal as a dialog, not a passing toast: the reason, with one OK (an empty Cancel drops that button). */
export function refusedDeleteDialog(title: string, words: string): ConfirmOpts {
  return { title: `Can't delete ${title} yet`, description: words, confirmLabel: "OK", cancelLabel: "", destructive: false };
}

/** The period the card shows, for a repeating goal. */
export interface TargetsPeriod {
  key: string;
  label: string;
  /** The period shown for now (the one running, or a stopped goal's last). */
  current: boolean;
  /** Where it stands (open, grace, closing, closed): only an open period takes new targets and edits. */
  state: "open" | "grace" | "closing" | "closed";
  /** Hand check-ins are taken into it now. */
  takesCheckIns: boolean;
  /** The line under the title, or null. */
  line: string | null;
  /** The period before it still takes numbers: the line and the link to it (final review H1). */
  late?: { line: string; linkLabel: string; href: string } | null;
  /** The goal's first period has not started: targets may be set up, nothing takes a check-in (final review H2). */
  notStarted?: boolean;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function GoalTargets({ okrId, canEdit, canCheckIn, targets, onHistory, period = null, editor = null }: {
  okrId: string;
  /** Target writer (add, delete): canEditGoal, the key-results routes' gate. */
  canEdit: boolean;
  /** May check in: target writers plus the goal's contributors. */
  canCheckIn: boolean;
  targets: TargetRowData[];
  /** Scroll to the Activity card ("View history"). */
  onHistory?: () => void;
  /** A repeating goal's period on screen; null for a one-time goal. */
  period?: TargetsPeriod | null;
  /** The target editor's goal facts, only while the RECURRING_GOALS switch is on (E3). */
  editor?: TargetEditorGoal | null;
}) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  // Targets are added, edited and deleted on the period running now (B5):
  // never on a period that has ended, a stopped goal's last one included.
  // Before the first period starts they are set up freely.
  const writable = canEdit && (!period || period.notStarted === true || (period.current && period.state === "open"));
  // A List's number on open (C7): the stored one is on screen; a source
  // counted more than 10 minutes ago is counted again, once per visit.
  const counts = canCheckIn && targets.some((t) => t.source) && (!period || (period.state !== "closed" && !period.notStarted));
  useEffect(() => {
    if (!counts) return;
    let live = true;
    void fetch(`/api/okrs/${okrId}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.changed) router.refresh(); })
      .catch(() => {});
    return () => { live = false; };
    // Once per goal on screen, not on every repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okrId, counts]);
  return (
    <section className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-targets-h">
      <h2 id="goal-targets-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
        Targets {targets.length ? <span className="text-xs font-medium text-ink-2">{targets.length}</span> : null}
      </h2>
      {period?.line ? <p className="m-0 mt-1 text-sm text-ink-2">{period.line}</p> : null}
      {period?.late ? (
        <p className="m-0 mt-1 text-sm text-ink-2">
          {period.late.line} <Link href={period.late.href} scroll={false} className="text-brand-deep hover:underline">{period.late.linkLabel}</Link>
        </p>
      ) : null}
      <ol className="m-0 mt-3 flex list-none flex-col p-0">
        {targets.length === 0 && !adding ? (
          <li className="flex h-9 items-center text-row text-ink-2">
            No targets yet{writable ? <> · <button type="button" className="ms-1 text-brand-deep hover:underline" onClick={() => setAdding(true)}>Add a target</button></> : null}
          </li>
        ) : null}
        {targets.map((t) => (
          <TargetRow key={t.id} okrId={okrId} target={t} canEdit={writable} canCheckIn={canCheckIn && (!period || period.takesCheckIns)} onHistory={onHistory} period={period} editor={editor} />
        ))}
        {adding ? <TargetComposer okrId={okrId} onDone={() => setAdding(false)} editor={editor} /> : null}
        {writable && !adding && targets.length > 0 ? (
          <li>
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-row text-ink-2 hover:text-ink">
              <Plus className="h-4 w-4" aria-hidden /> Add target
            </button>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/** The editor's starting values for a saved target. */
function editorInitial(t: TargetRowData): TargetEditorInitial {
  return {
    id: t.id, title: t.title, startValue: t.startValue, targetValue: t.targetValue, unit: t.unit,
    currentValue: t.currentValue, kpiId: t.kpiId ?? null, kpiName: t.kpiName, periodStart: t.periodStart ?? null, combine: t.kpiCombine ?? null,
    listSource: t.source && !t.source.private && t.source.kind !== "table" ? t.source.settings : null,
    tableSource: t.source && !t.source.private && t.source.kind === "table" ? t.source.settings : null,
    privateSource: t.source?.private ? { connectorName: t.source.connectorName, kind: t.source.kind ?? "list" } : null,
    paused: t.source?.paused ?? null,
  };
}

function TargetRow({ okrId, target: t, canEdit, canCheckIn, onHistory, period, editor }: {
  okrId: string;
  target: TargetRowData;
  canEdit: boolean;
  canCheckIn: boolean;
  onHistory?: () => void;
  period: TargetsPeriod | null;
  editor: TargetEditorGoal | null;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const checkInRef = useRef<HTMLButtonElement>(null);
  // Where focus goes when the check-in or the editor closes (M9): the
  // control that opened it, the row's "..." for anything opened from its menu.
  const [returnTo, setReturnTo] = useState<RefObject<HTMLElement | null>>(btnRef);
  const pct = Math.max(0, Math.min(100, t.progress));
  const unit = t.unit?.trim();
  const closed = period?.state === "closed";
  const sourceText = targetSourceText(t);
  const paused = pausedLine(t.source, closed);

  // Refresh (C7): count it now; Reconnect (C10): the editor becomes its connector.
  const refresh = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyResultId: t.id }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast(d?.paused ? "It is still paused" : "Counted again"); router.refresh(); }
      else toast(d?.error ?? "Couldn't count it again", { tone: "danger" });
    } catch {
      toast("Couldn't count it again", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const reconnect = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reconnect: true }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast("Reconnected"); router.refresh(); }
      else toast(d?.error ?? "Couldn't reconnect it", { tone: "danger" });
    } catch {
      toast("Couldn't reconnect it", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setMenuOpen(false);
    // M1 (fixes review): a target a period still taking numbers holds says so before any confirm.
    const ask = deleteTargetDialog(t, !!period);
    const ok = await confirm(ask.opts);
    if (!ok || ask.refused) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results/${t.id}`, { method: "DELETE" });
      const d = res.ok ? null : await res.json().catch(() => ({}));
      if (res.ok) { toast("Target deleted"); router.refresh(); }
      // A period that ended since the page loaded: the server's 409 is the same refusal, said the same way.
      else if (res.status === 409 && typeof d?.error === "string") { await confirm(refusedDeleteDialog(t.title, d.error)); router.refresh(); }
      else toast(d?.error ?? "Couldn't delete the target", { tone: "danger" });
    } catch {
      toast("Couldn't delete the target", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    // From 640 up, one 36px row: name, numbers, bar and percent, the source
    // or last check-in column (1280 up), Check in, "...". Below 640 it is two
    // lines, so nothing is cut: the name (wrapping) with "..." at its end,
    // then the numbers, the bar, the percent and Check in, wrapping again
    // rather than overflowing when a long unit leaves no room (`order` puts
    // "..." on the first line; from 640 up the DOM order stands). What
    // measures it (its source, its KPI, "Carried from") is a line under the
    // row below 1280 instead of the column, and a pause is a line under the
    // row at every width (H3).
    <li className={`os-row group flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-1.5 last:border-b-0 ${sourceText || paused ? (paused ? "sm:py-1.5" : "sm:py-1.5 xl:h-9 xl:flex-nowrap xl:py-0") : "sm:h-9 sm:flex-nowrap sm:py-0"}`}>
      <span className="min-w-0 flex-1 break-words text-row text-ink sm:truncate" title={t.title}>{t.title}</span>
      <span className="order-2 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:order-none sm:w-auto sm:shrink-0 sm:flex-nowrap sm:gap-x-3">
        {/* "6 of 20 people", plus where it started when that was not zero.
            The longer three-word line cut the target's own name to two
            letters at 720. */}
        <span className="min-w-0 max-w-full shrink-0 text-sm tabular-nums text-ink-2">
          {fmtNum(t.currentValue)} of {fmtNum(t.targetValue)}{unit ? ` ${unit}` : ""}{t.startValue ? ` · from ${fmtNum(t.startValue)}` : ""}
        </span>
        <span className="flex min-w-[64px] flex-1 items-center gap-2 sm:min-w-0 sm:flex-none sm:shrink-0">
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-active sm:w-[72px] sm:flex-none" aria-hidden>
            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </span>
          <span className="w-9 shrink-0 text-end text-sm tabular-nums text-ink">{pct}%</span>
        </span>
        <span className={`hidden shrink-0 truncate text-xs text-ink-2 xl:inline ${sourceText ? "w-[140px]" : "w-20"}`}>
          {sourceText ?? t.lastCheckIn ?? "No check-ins"}
        </span>
        {canCheckIn && !t.isDerived && !t.deleted ? (
          <button ref={checkInRef} type="button" onClick={() => { setReturnTo(checkInRef); setCheckinOpen(true); }} className="ms-auto inline-flex h-7 shrink-0 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink sm:ms-0">
            Check in
          </button>
        ) : null}
      </span>
      {/* Below 1280 the column above is hidden: what measures the target, as a line of its own. */}
      {sourceText ? <span className="order-3 w-full min-w-0 break-words text-xs text-ink-2 xl:hidden">{sourceText}</span> : null}
      {paused ? <span className="order-4 w-full min-w-0 break-words text-xs text-ink-2">{paused}</span> : null}
      {t.deleted ? <span className="order-1 w-7 shrink-0 sm:order-none" aria-hidden /> : (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`Actions for ${t.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="order-1 inline-flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md text-ink-2 hover:bg-hover hover:text-ink sm:order-none sm:self-auto"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      {t.deleted ? null : <MorePortal anchorRef={btnRef} width={200} open={menuOpen} placement="below" onClose={() => setMenuOpen(false)}>
        <MenuList aria-label={`Actions for ${t.title}`}>
          <MenuItem icon={Pencil} label={canCheckIn && !t.isDerived ? "Check in" : "View target"} onClick={() => { setMenuOpen(false); setReturnTo(btnRef); setCheckinOpen(true); }} />
          {canEdit && editor ? <MenuItem icon={Settings2} label="Edit target" onClick={() => { setMenuOpen(false); setReturnTo(btnRef); setEditing(true); }} /> : null}
          {/* "Count again", the word its toast answers with ("Counted again"), final review L21. */}
          {t.source && canCheckIn ? <MenuItem icon={RefreshCw} label="Count again" onClick={() => void refresh()} busy={busy} /> : null}
          {t.source?.href ? <MenuItem icon={ExternalLink} label="Open source" onClick={() => { setMenuOpen(false); router.push(t.source!.href!); }} /> : null}
          {t.source?.paused && !t.source.private && t.source.reconnectable !== false && canEdit && editor ? <MenuItem icon={Plug} label="Reconnect" onClick={() => void reconnect()} busy={busy} /> : null}
          {onHistory ? <MenuItem icon={History} label="View history" onClick={() => { setMenuOpen(false); onHistory(); }} /> : null}
          {canEdit ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete target" destructive onClick={() => void del()} busy={busy} />
            </>
          ) : null}
        </MenuList>
      </MorePortal>}
      {checkinOpen ? (
        <OkrCheckInModal okrId={okrId} target={t} canEdit={canCheckIn} onClose={() => setCheckinOpen(false)} returnFocus={returnTo}
          period={period && !period.notStarted ? { key: period.key, label: period.label, ended: period.state !== "open" } : null} />
      ) : null}
      {editing && editor ? <TargetEditor goal={editor} initial={editorInitial(t)} onClose={() => setEditing(false)} returnFocus={btnRef} /> : null}
    </li>
  );
}

function TargetComposer({ okrId, onDone, editor }: { okrId: string; onDone: () => void; editor: TargetEditorGoal | null }) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  const { toast } = useOsToast();
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState("0");
  const [targetValue, setTargetValue] = useState("100");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || saving) return;
    const start = Number(startValue);
    const target = Number(targetValue);
    if (!Number.isFinite(start) || !Number.isFinite(target)) { setError("Start and Target must be numbers."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), startValue: start, targetValue: target, unit: unit.trim() || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? `Couldn't add it (${res.status})`); }
      toast("Target added");
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the target");
    } finally {
      setSaving(false);
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    // Enter saves from a field only: on a button (Count from a List or table, Cancel) it presses that button.
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void submit(); }
    if (e.key === "Escape") { e.stopPropagation(); onDone(); }
  };
  const field = "h-8 min-w-0 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none";
  return (
    <li className="flex flex-col gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2" onKeyDown={onKey}>
        <input autoFocus aria-label="Target name" placeholder="Target name" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} flex-1`} />
        <input aria-label="Start" type="number" step="any" value={startValue} onChange={(e) => setStartValue(e.target.value)} className={`${field} w-20 tabular-nums`} />
        <input aria-label="Target" type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className={`${field} w-20 tabular-nums`} />
        <input aria-label="Unit" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${field} w-24`} />
        {/* The door to every other way of measuring it (final review M7: "More options" hid it). */}
        {editor ? <Button type="button" variant="ghost" size="sm" onClick={() => setMore(true)} disabled={saving}>Count from a List or table</Button> : null}
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={saving || !title.trim()}>{saving ? "Adding" : "Add"}</Button>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-danger-text">{error}</p> : null}
      {more && editor ? (
        <TargetEditor
          goal={editor}
          initial={{ title, startValue: Number(startValue) || 0, targetValue: Number(targetValue) || 0, unit: unit.trim() || null, kpiId: null }}
          onClose={() => setMore(false)}
          onSaved={onDone}
        />
      ) : null}
    </li>
  );
}
