"use client";

// BoardItemDetail — the shared body of a task's detail view. Rendered by
// both BoardItemDrawer (centered modal) and the full-page task route
// (/item/[id]). Owns no data fetching: the host loads the item and passes
// it down with an onPatch callback. Layout (ClickUp task view): type pill,
// large title, optional Ask Brain row, a two-column field grid
// (Status|Assignees, Dates|Priority, Time estimate|Track time,
// Tags|Alignment), description, collapsed action rows, then subtasks /
// checklist / custom fields / relations / comments when revealed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, Search, EyeOff, Eye, Target, Flag, Ban, Pencil, GitBranch,
  Link2, ClipboardList, Paperclip, CircleDashed, Users, CalendarDays, Hourglass,
  Clock, Tag, Sparkles, Play, Square, Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { RecurrenceRule } from "@/lib/recurrence";
import type { FieldDef } from "@/lib/field-catalog";
import { AssigneePicker } from "./assignee-picker";
import { FieldValue } from "./field-value";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { ItemThread } from "./item-thread";
import { LinkedAttachments } from "./linked-attachments";
import { TimeTracker } from "./time-tracker";
import { ItemTypePicker } from "./item-type-picker";
import { ItemSubtasks } from "./item-subtasks";
import { ItemChecklist } from "./item-checklist";
import { DatePlanner } from "./date-planner";

export type DetailPatch = Partial<Pick<BoardItemRow, "title" | "status">> & {
  metadata?: Record<string, unknown>;
  startAt?: string | null;
  dueAt?: string | null;
  ownerId?: string | null;
  priority?: string | null;
  tagIds?: string[];
  itemTypeId?: string | null;
  recurRule?: RecurrenceRule | null;
};

/** Space-module gating for the item surfaces. Each false hides that capability. */
export type ItemModuleGating = { priority: boolean; tags: boolean; timeTracking: boolean; customFields: boolean };

interface BoardItemDetailProps {
  item: BoardItemRow;
  canEdit: boolean;
  currentUserId: string | null;
  customFields: FieldDef[];
  statusOptions: StatusOption[];
  onPatch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
  /** "drawer" (side panel) or "page" (full-page route). Affects spacing. */
  layout?: "drawer" | "page";
  /** When set, clicking a subtask navigates instead of doing nothing. */
  onOpenItem?: (itemId: string) => void;
  /** Space-module gating — hides Priority / Tags / custom fields / TimeTracker
   *  when their module is off. Absent = all shown (legacy / non-board context). */
  moduleGating?: ItemModuleGating;
  /** Drawer hosts the Comments/Activity thread in its right rail — suppress the
   *  inline copy so it isn't rendered twice. */
  hideActivity?: boolean;
  /** Drawer hosts relations/attachments in its right rail "Related" tab —
   *  suppress the inline widget + its Relate/Attach action rows. */
  hideRelations?: boolean;
  /** When set, renders the "Ask Brain" suggestion row under the title.
   *  The drawer wires this to the OS-shell sidekick; the full-page route
   *  omits it. */
  onAskAi?: () => void;
}

function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function fmtStamp(v: string | Date): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function BoardItemDetail({
  item,
  canEdit,
  currentUserId,
  customFields,
  statusOptions,
  onPatch,
  layout = "drawer",
  onOpenItem,
  moduleGating,
  hideActivity = false,
  hideRelations = false,
  onAskAi,
}: BoardItemDetailProps) {
  // Absent gating (legacy / non-board context) = everything shown.
  const priorityOn = moduleGating ? moduleGating.priority : true;
  const tagsOn = moduleGating ? moduleGating.tags : true;
  const timeTrackingOn = moduleGating ? moduleGating.timeTracking : true;
  const customFieldsOn = moduleGating ? moduleGating.customFields : true;
  const [fieldSearch, setFieldSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);

  const { shown, emptyCount } = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    let list = customFields;
    if (q) list = list.filter((f) => f.label.toLowerCase().includes(q));
    const emptyCount = list.filter((f) => isEmptyValue(item.metadata?.[f.key])).length;
    if (hideEmpty) list = list.filter((f) => !isEmptyValue(item.metadata?.[f.key]));
    return { shown: list, emptyCount };
  }, [customFields, fieldSearch, hideEmpty, item.metadata]);

  const pageWide = layout === "page";

  // ClickUp-style collapse: empty lower sections show as a single action row;
  // a section expands when it has content or the user clicks its row. Subtasks
  // and attachments report their loaded count so we know which to collapse.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [subtaskCount, setSubtaskCount] = useState<number | null>(null);
  const [attachCount, setAttachCount] = useState<number | null>(null);
  const reveal = (s: string) => setRevealed((prev) => new Set(prev).add(s));

  const checklistItems = Array.isArray(item.metadata?.checklist) ? (item.metadata!.checklist as unknown[]) : [];
  const hasCustomFields = customFieldsOn && customFields.length > 0;
  const hasFieldValues = hasCustomFields && customFields.some((f) => !isEmptyValue(item.metadata?.[f.key]));
  const showFields = hasCustomFields && (revealed.has("fields") || hasFieldValues);
  const showSubtasks = revealed.has("subtasks") || (subtaskCount ?? 0) > 0;
  const showChecklist = revealed.has("checklist") || checklistItems.length > 0;
  const showAttach = revealed.has("attach") || (attachCount ?? 0) > 0;

  // The ClickUp action-row list, in order, for whichever sections are collapsed.
  const actionRows = [
    hasCustomFields && !showFields ? { key: "fields", icon: Pencil, label: "Add fields", onClick: () => reveal("fields") } : null,
    !showSubtasks ? { key: "subtasks", icon: GitBranch, label: "Add subtask", onClick: () => reveal("subtasks") } : null,
    !hideRelations && !showAttach ? { key: "related", icon: Link2, label: "Relate items or add dependencies", onClick: () => reveal("attach") } : null,
    !showChecklist ? { key: "checklist", icon: ClipboardList, label: "Create checklist", onClick: () => reveal("checklist") } : null,
    !hideRelations && !showAttach ? { key: "attach", icon: Paperclip, label: "Attach file", onClick: () => reveal("attach") } : null,
  ].filter((r): r is { key: string; icon: typeof Pencil; label: string; onClick: () => void } => r !== null);

  return (
    <div className={`space-y-6 ${pageWide ? "max-w-[760px]" : ""}`}>
      {/* Type pill (ClickUp top-left) + title + Ask Brain suggestion row */}
      <div className="space-y-3">
        <div className="inline-flex items-center h-7 px-2 rounded-md border border-zinc-200 bg-white">
          <ItemTypePicker value={item.itemTypeId ?? null} canEdit={canEdit} onChange={(id) => onPatch({ itemTypeId: id })} />
        </div>
        <TitleField item={item} canEdit={canEdit} onSave={(t) => onPatch({ title: t })} />
        {onAskAi ? (
          <button
            type="button"
            onClick={onAskAi}
            className="flex w-full items-center gap-2 h-9 px-3 rounded-lg text-left transition-colors bg-[color-mix(in_srgb,var(--os-brand)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--os-brand)_9%,transparent)]"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--os-brand)]" />
            <span className="truncate text-[12.5px] text-zinc-500">
              <span className="font-medium text-[var(--os-brand)]">Ask Brain</span>
              {" "}to plan, summarize or draft next steps for this task
            </span>
          </button>
        ) : null}
      </div>

      {/* Core field grid — ClickUp two-column pairing:
          Status|Assignees, Dates|Priority, Time estimate|Track time, Tags|Alignment. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-0.5">
        <FieldRow icon={CircleDashed} label="Status">
          <StatusPicker value={item.status} statuses={statusOptions} canEdit={canEdit} onChange={(v) => onPatch({ status: v })} />
        </FieldRow>
        <FieldRow icon={Users} label="Assignees">
          <AssigneePicker
            value={item.owner ? { ...item.owner, email: null } : null}
            canEdit={canEdit}
            onChange={(person) =>
              onPatch(
                { ownerId: person?.id ?? null },
                { owner: person ? { id: person.id, firstName: person.firstName ?? "", lastName: person.lastName ?? "", avatar: person.avatar } : null },
              )
            }
          />
        </FieldRow>
        <FieldRow icon={CalendarDays} label="Dates">
          <DatePlanner item={item} canEdit={canEdit} onPatch={onPatch} statuses={statusOptions} />
        </FieldRow>
        {priorityOn ? (
          <FieldRow icon={Flag} label="Priority">
            <PriorityPicker value={item.priority ?? null} canEdit={canEdit} onChange={(priority) => onPatch({ priority })} />
          </FieldRow>
        ) : null}
        <FieldRow icon={Hourglass} label="Time estimate">
          <TimeEstimateField item={item} canEdit={canEdit} onPatch={onPatch} />
        </FieldRow>
        {timeTrackingOn ? (
          <FieldRow icon={Clock} label="Track time">
            <TrackTimeField itemId={item.id} canEdit={canEdit} />
          </FieldRow>
        ) : null}
        {tagsOn ? (
          <FieldRow icon={Tag} label="Tags">
            <TagPicker value={item.tags ?? []} canEdit={canEdit} onChange={(tags) => onPatch({ tagIds: tags.map((t) => t.id) }, { tags })} />
          </FieldRow>
        ) : null}
        <FieldRow icon={Target} label="Alignment">
          <AlignmentField item={item} canEdit={canEdit} onPatch={onPatch} />
        </FieldRow>
      </div>

      <div className="text-[11px] text-zinc-400">
        Created {fmtStamp(item.createdAt)} <span className="mx-1 text-zinc-300">·</span> Updated {fmtStamp(item.updatedAt)}
      </div>

      <div className="border-t border-zinc-100" />

      {/* Description */}
      <DescriptionField item={item} canEdit={canEdit} onSave={(desc) => onPatch({ metadata: { ...item.metadata, description: desc } })} />

      {/* Custom fields — revealed via the "Add fields" row or auto when a value is set. */}
      {showFields ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">Fields</h3>
            <div className="flex items-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200">
                <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <input value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder="Search fields…" className="w-[110px] text-[12px] bg-transparent outline-none" />
              </div>
              {emptyCount > 0 ? (
                <button type="button" onClick={() => setHideEmpty((v) => !v)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-zinc-500 hover:bg-zinc-100">
                  {hideEmpty ? <Eye className="h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <EyeOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                  {hideEmpty ? `Show ${emptyCount} empty` : `Hide ${emptyCount} empty`}
                </button>
              ) : null}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-[12.5px] text-zinc-400">{fieldSearch ? "No matching fields." : "All fields empty."}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-0.5">
              {shown.map((f) => (
                <FieldRow key={f.key} label={f.label}>
                  <FieldValue
                    field={f}
                    value={item.metadata?.[f.key]}
                    mode="edit"
                    disabled={!canEdit}
                    currentUserId={currentUserId}
                    onChange={(next) => onPatch({ metadata: { ...item.metadata, [f.key]: next } })}
                  />
                </FieldRow>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Subtasks — always mounted so it can report its count; hidden until it
          has content or is revealed. */}
      <div className={showSubtasks ? "" : "hidden"}>
        <ItemSubtasks
          item={item}
          canEdit={canEdit}
          statuses={statusOptions}
          onOpenItem={onOpenItem}
          onCountChange={setSubtaskCount}
          autoFocus={revealed.has("subtasks")}
        />
      </div>

      {/* Checklist (metadata-backed) */}
      {showChecklist ? (
        <ItemChecklist item={item} canEdit={canEdit} onSave={(checklist) => onPatch({ metadata: { ...item.metadata, checklist } })} />
      ) : null}

      {/* Linked notes + whiteboards + files + relations — always mounted for the
          count; hidden until it has content or is revealed. In the drawer this
          lives in the right-rail "Related" tab instead (hideRelations). */}
      {!hideRelations ? (
        <div className={showAttach ? "" : "hidden"}>
          <LinkedAttachments sourceType="BOARD_ITEM" sourceId={item.id} spaceId={item.spaceId ?? null} canEdit={canEdit} onCountChange={setAttachCount} />
        </div>
      ) : null}

      {/* ClickUp action rows for the still-collapsed sections. */}
      {canEdit && actionRows.length > 0 ? (
        <div className="grid max-w-[420px] gap-0.5">
          {actionRows.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            >
              <r.icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Comments + Activity — hidden inline when the drawer hosts it in the rail. */}
      {!hideActivity ? (
        <ItemThread itemId={item.id} canEdit={canEdit} currentUserId={currentUserId} statuses={statusOptions} />
      ) : null}
    </div>
  );
}

// ── Field-grid primitive ──────────────────────────────────────────

/** One row of the ClickUp field grid: [muted icon + muted label] left,
 *  value right with a hover highlight. No icon (custom fields) renders a
 *  small dot so labels stay aligned with the core grid. */
function FieldRow({ icon: Icon, label, children }: { icon?: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[38px] items-center gap-3">
      <div className="flex w-[122px] shrink-0 items-center gap-2">
        {Icon ? (
          <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
            <span className="h-1 w-1 rounded-full bg-zinc-300" />
          </span>
        )}
        <span className="truncate text-[12.5px] text-zinc-500">{label}</span>
      </div>
      <div className="flex min-h-[30px] min-w-0 flex-1 items-center rounded-md px-2 py-1 transition-colors hover:bg-zinc-50">
        {children}
      </div>
    </div>
  );
}

// ── Time estimate (Item.metadata.timeEstimate, minutes) ───────────

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0) return r > 0 ? `${h}h ${r}m` : `${h}h`;
  return `${r}m`;
}

/** Accepts "2h 30m", "2h", "90m", "1.5h", or a bare number (minutes). */
function parseEstimate(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hm = t.match(/(\d+(?:\.\d+)?)\s*h/);
  const mm = t.match(/(\d+(?:\.\d+)?)\s*m/);
  let total = 0;
  if (hm) total += parseFloat(hm[1]) * 60;
  if (mm) total += parseFloat(mm[1]);
  if (!hm && !mm) {
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    total = n;
  }
  const rounded = Math.round(total);
  return rounded > 0 ? rounded : null;
}

function TimeEstimateField({ item, canEdit, onPatch }: { item: BoardItemRow; canEdit: boolean; onPatch: (b: DetailPatch) => void }) {
  const raw = item.metadata?.timeEstimate;
  const minutes = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const next = parseEstimate(draft);
    setEditing(false);
    if (next === minutes) return;
    const md = { ...((item.metadata as Record<string, unknown> | undefined) ?? {}) };
    if (next) md.timeEstimate = next;
    else delete md.timeEstimate;
    onPatch({ metadata: md });
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="e.g. 2h 30m"
        className="h-7 w-[110px] rounded-md border border-[var(--os-brand)] bg-white px-2 text-[13px] outline-none placeholder:text-zinc-400"
      />
    );
  }

  if (!canEdit) {
    return minutes ? <span className="text-[13px] text-zinc-700 tabular-nums">{formatMinutes(minutes)}</span> : <span className="text-[13px] text-zinc-400">Empty</span>;
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(minutes ? formatMinutes(minutes) : ""); setEditing(true); }}
      className="text-left text-[13px]"
      title="Set time estimate"
    >
      {minutes ? (
        <span className="text-zinc-700 tabular-nums">{formatMinutes(minutes)}</span>
      ) : (
        <span className="text-zinc-400 hover:text-zinc-600">Empty</span>
      )}
    </button>
  );
}

// ── Track time (compact start/stop + popover with full tracker) ───

function formatTrackedMs(ms: number): string {
  if (ms < 1000) return "0m";
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatRunningClock(startedAt: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(startedAt).getTime());
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface TimerState {
  active: { id: string; startedAt: string } | null;
  totalMs: number;
  sessions: { id: string; stoppedAt: string | null; durationMs: number }[];
}

/** Compact grid-cell tracker: play/stop button + live total. The total
 *  opens a popover hosting the full TimeTracker (manual entry + sessions),
 *  so nothing is lost by removing the old bottom section. */
function TrackTimeField({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [state, setState] = useState<TimerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const load = useCallback(() => {
    fetch(`/api/timers?entityType=BOARD_ITEM&entityId=${itemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TimerState | null) => { if (d) setState(d); })
      .catch(() => {});
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!state?.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.active]);

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(state?.active ? "/api/timers/stop" : "/api/timers/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "BOARD_ITEM", entityId: itemId }),
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const running = Boolean(state?.active);
  const liveTotalMs = state
    ? state.totalMs +
      (state.active
        ? Math.max(0, now - new Date(state.active.startedAt).getTime() - state.sessions
            .filter((s) => !s.stoppedAt && s.id === state.active?.id)
            .reduce((acc, s) => acc + s.durationMs, 0))
        : 0)
    : 0;

  const closePopover = () => { setOpen(false); load(); };

  return (
    <div className="relative flex items-center gap-2">
      {canEdit ? (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          title={running ? "Stop timer" : "Start timer"}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
            running
              ? "bg-red-500 text-white hover:bg-red-600"
              : "border border-zinc-300 text-zinc-500 hover:border-[var(--os-brand)] hover:text-[var(--os-brand)]"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : running ? (
            <Square className="h-2.5 w-2.5 fill-current" />
          ) : (
            <Play className="ml-px h-3 w-3 fill-current" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => (open ? closePopover() : setOpen(true))}
        title="Time entries"
        className="text-left text-[13px] tabular-nums"
      >
        {running && state?.active ? (
          <span className="font-mono text-red-600">{formatRunningClock(state.active.startedAt, now)}</span>
        ) : liveTotalMs > 0 ? (
          <span className="text-zinc-700 hover:text-zinc-900">{formatTrackedMs(liveTotalMs)}</span>
        ) : (
          <span className="text-zinc-400 hover:text-zinc-600">Add time</span>
        )}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={closePopover} aria-hidden="true" />
          <div className="absolute right-0 top-full z-20 mt-1 w-[340px] rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)]">
            <TimeTracker entityType="BOARD_ITEM" entityId={itemId} canEdit={canEdit} />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Alignment (KRA/KPI) ───────────────────────────────────────────

// Alignment — the KRA/KPI this task serves. KPI-first: picking a KPI
// carries its parent KRA; a KRA can be chosen alone. Persisted into
// Item.metadata.kraId / .kpiId (the server replaces metadata wholesale,
// so we always spread the existing object). Mirrors the create-task modal.
type KraLite = { id: string; name: string; category?: string | null };
type KpiLite = { id: string; name: string; kra: { id: string; name: string } | null };

function AlignmentField({ item, canEdit, onPatch }: { item: BoardItemRow; canEdit: boolean; onPatch: (b: DetailPatch) => void }) {
  const kraId = typeof item.metadata?.kraId === "string" ? (item.metadata.kraId as string) : null;
  const kpiId = typeof item.metadata?.kpiId === "string" ? (item.metadata.kpiId as string) : null;
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [kras, setKras] = useState<KraLite[]>([]);
  const [kpis, setKpis] = useState<KpiLite[]>([]);
  const [q, setQ] = useState("");
  const loadedRef = useRef(false);

  // Load once when there's a tag to name, or when the picker opens. The
  // ref guards the fetch (no synchronous setState in the effect body);
  // state is only set from the async resolution.
  useEffect(() => {
    if (loadedRef.current || (!open && !kraId && !kpiId)) return;
    loadedRef.current = true;
    Promise.all([
      fetch("/api/kras?scope=all&limit=200").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/kpis").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([kr, kp]) => {
      setKras(Array.isArray(kr?.data) ? kr.data : Array.isArray(kr) ? kr : []);
      setKpis(Array.isArray(kp) ? kp : Array.isArray(kp?.data) ? kp.data : []);
      setReady(true);
    });
  }, [open, kraId, kpiId]);

  const kpiName = kpiId ? kpis.find((k) => k.id === kpiId)?.name ?? null : null;
  const kraName = kraId ? kras.find((k) => k.id === kraId)?.name ?? null : null;

  const commit = (nextKra: string | null, nextKpi: string | null) => {
    const md = { ...(item.metadata as Record<string, unknown> | undefined ?? {}) };
    if (nextKra) md.kraId = nextKra; else delete md.kraId;
    if (nextKpi) md.kpiId = nextKpi; else delete md.kpiId;
    onPatch({ metadata: md });
    setOpen(false);
    setQ("");
  };

  const needle = q.trim().toLowerCase();
  const fKpis = !needle ? kpis : kpis.filter((k) => k.name.toLowerCase().includes(needle) || (k.kra?.name ?? "").toLowerCase().includes(needle));
  const fKras = !needle ? kras : kras.filter((k) => k.name.toLowerCase().includes(needle) || (k.category ?? "").toLowerCase().includes(needle));

  const summary = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {kpiId ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: "#a78b8022", color: "#8e7165" }}>
          <Target className="w-3 h-3" />{kpiName ?? "KPI"}
        </span>
      ) : null}
      {kraId ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-600">
          <Flag className="w-3 h-3" />{kraName ?? "KRA"}
        </span>
      ) : null}
      {!kraId && !kpiId ? <span className="text-[13px] text-zinc-400">Empty</span> : null}
    </span>
  );

  if (!canEdit) return summary;

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 hover:opacity-80">
        {summary}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 right-0 w-[300px] rounded-xl border border-zinc-200 bg-white shadow-[0_16px_48px_-16px_rgba(24,24,27,0.30)] p-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#c39b8c] mb-2">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search KPIs or KRAs…" className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              <div className="px-1 pb-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">KPIs</div>
              {fKpis.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-zinc-400">{ready ? "No KPIs — pick a KRA below." : "Loading…"}</div>
              ) : (
                fKpis.map((k) => (
                  <button key={k.id} type="button" onClick={() => commit(k.kra?.id ?? null, k.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-zinc-50 rounded">
                    <Target className="w-3.5 h-3.5 text-[#a78b80] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-zinc-700">{k.name}</span>
                      {k.kra ? <span className="block text-[11px] text-zinc-400 truncate">KRA · {k.kra.name}</span> : null}
                    </span>
                    {kpiId === k.id ? <Check className="w-3.5 h-3.5 text-[#a78b80] shrink-0" /> : null}
                  </button>
                ))
              )}
              <div className="px-1 pt-2 pb-1 mt-1 border-t border-zinc-100 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">KRA only</div>
              {fKras.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-zinc-400">{ready ? "No KRAs available." : "Loading…"}</div>
              ) : (
                fKras.map((k) => (
                  <button key={k.id} type="button" onClick={() => commit(k.id, null)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-zinc-50 rounded">
                    <Flag className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-zinc-700">{k.name}</span>
                      {k.category ? <span className="block text-[11px] text-zinc-400 truncate">{k.category}</span> : null}
                    </span>
                    {kraId === k.id && !kpiId ? <Check className="w-3.5 h-3.5 text-[#a78b80] shrink-0" /> : null}
                  </button>
                ))
              )}
            </div>
            {(kraId || kpiId) ? (
              <button type="button" onClick={() => commit(null, null)} className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 pt-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-50 rounded border-t border-zinc-100">
                <Ban className="w-3.5 h-3.5 text-zinc-400" /> Clear alignment
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TitleField({ item, canEdit, onSave }: { item: BoardItemRow; canEdit: boolean; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [syncedTitle, setSyncedTitle] = useState(item.title);
  if (syncedTitle !== item.title) { setSyncedTitle(item.title); setDraft(item.title); }

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(item.title); setEditing(false); return; }
    if (trimmed !== item.title) onSave(trimmed);
    setEditing(false);
  };

  if (!canEdit || !editing) {
    return <button type="button" onClick={() => canEdit && setEditing(true)} className="w-full text-left text-[22px] font-semibold leading-snug tracking-[-0.01em] text-zinc-900">{item.title}</button>;
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(item.title); setEditing(false); } }}
      className="w-full text-[22px] font-semibold leading-snug tracking-[-0.01em] text-zinc-900 bg-transparent outline-none border-b border-[var(--os-brand)]"
    />
  );
}

function DescriptionField({ item, canEdit, onSave }: { item: BoardItemRow; canEdit: boolean; onSave: (description: string) => void }) {
  const initial = typeof item.metadata?.description === "string" ? item.metadata.description : "";
  const [draft, setDraft] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) { setSynced(initial); setDraft(initial); }
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Description</h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== initial) onSave(draft); }}
        disabled={!canEdit}
        rows={4}
        placeholder={canEdit ? "Add a description…" : "No description"}
        className="w-full px-3 py-2 rounded-lg border border-transparent hover:border-zinc-200 bg-transparent text-sm leading-relaxed resize-y transition-colors focus:outline-none focus:border-[var(--os-brand)] focus:bg-white disabled:opacity-60 placeholder:text-zinc-400"
      />
    </div>
  );
}

function StatusPicker({ value, statuses, canEdit, onChange }: { value: string | null; statuses: StatusOption[]; canEdit: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = value ? statuses.find((o) => o.value === value) ?? null : null;
  const pill = current ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${current.color}22`, color: current.color }}>{current.label}</span>
  ) : (
    <span className="text-[13px] text-zinc-400">Empty</span>
  );
  if (!canEdit) return pill;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5">{pill}<ChevronDown className="w-3 h-3 text-zinc-500" /></button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1" onMouseLeave={() => setOpen(false)}>
          {statuses.map((opt) => (
            <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }} className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${opt.color}22`, color: opt.color }}>{opt.label}</span>
              {opt.value === value ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
