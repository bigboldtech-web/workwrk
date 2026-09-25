"use client";

// Connect and Mirror cells (gap 13, monday.com's connect-boards model).
//
// CONNECT: a cell that links this task to tasks in other Lists. It shows the
// connected tasks THIS viewer can read as chips (a status dot, the title,
// struck through when done), each opening the task. Editing opens a panel
// with a search over the column's target Lists (GET
// /api/boards/[id]/fields/[key]/candidates, paged) and a Selected section.
//
// The cell keeps its OWN selection while the panel is open and commits it,
// debounced, through `onCommit`, with only the ids the viewer can see: the
// server keeps every connection the viewer cannot see, so a cell can never
// drop somebody else's link by leaving it out. A commit is flushed on close
// (Esc, a click outside, unmount). A refused commit keeps the selection,
// says why and offers Retry; one that fails after the panel closed raises a
// toast whose "Try again" sends the same selection again. Nothing is lost.
//
// MIRROR: read only. It shows, per connected task the viewer can read, the
// value of one field of that task's List, or a roll-up of them, formatted the
// way that field formats itself when every lookup names the same type.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Plus, RotateCcw, Search, X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { useLayer } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { formatDate } from "@/lib/format/date";
import { openTask } from "@/lib/nav/open-task";
import { MAX_CONNECTIONS, connectTargets, mirrorOptionsOf, type ConnectionRef, type MirrorValue as MirrorData } from "@/lib/list-connect";
import { PRIORITY_LOOKUP } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { accessMessage } from "@/lib/access-message";
import { useAnchorPos } from "./use-anchor-pos";

export type CommitResult = { ok: true } | { ok: false; message: string };

interface Candidate {
  id: string;
  title: string;
  statusLabel: string | null;
  statusColor: string | null;
  done: boolean;
  list: { id: string; name: string };
}

const PANEL_W = 320;
const COMMIT_DELAY_MS = 300;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** One connected task as a chip: status dot, title, struck through when done. */
function Chip({ task, onOpen }: { task: ConnectionRef; onOpen?: (id: string) => void }) {
  const inner = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: task.statusColor ?? "var(--os-ink-3)" }} aria-hidden />
      <span className={`truncate ${task.done ? "text-ink-3 line-through" : "text-ink"}`}>{task.title}</span>
    </>
  );
  const cls = "inline-flex h-6 max-w-[180px] min-w-0 items-center gap-1.5 rounded-[5px] border border-line bg-raised px-1.5 text-xs";
  if (!onOpen) return <span className={cls} title={task.title}>{inner}</span>;
  return (
    <span
      role="link"
      tabIndex={0}
      title={`Open ${task.title}`}
      onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onOpen(task.id); } }}
      className={`${cls} cursor-pointer transition-colors hover:border-line-strong hover:bg-hover`}
    >
      {inner}
    </span>
  );
}

export function ConnectValue({
  field,
  connections,
  readOnly,
  fieldListId,
  itemId,
  onCommit,
  popover = "fixed",
}: {
  field: FieldDef;
  /** The connected tasks this viewer can read (the server's projection). */
  connections: ConnectionRef[];
  readOnly: boolean;
  /** The List whose schema defines the column: its candidates route. */
  fieldListId: string | null;
  /** The task being edited, never offered as its own connection. */
  itemId: string | null;
  onCommit?: (next: string[] | null) => Promise<CommitResult>;
  /** "fixed" in a table cell (escapes its scroller); "absolute" inside the task drawer. */
  popover?: "fixed" | "absolute";
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [open, setOpen] = useState(false);
  // The panel's own selection, in order, with enough of each task to draw it.
  const [selection, setSelection] = useState<ConnectionRef[]>(connections);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // What the server last accepted (or last showed), so a commit that changes
  // nothing is never sent. Re-synced from the server's chips while closed.
  const committed = useRef<string[]>(connections.map((c) => c.id));
  const pending = useRef<string[] | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);

  const serverKey = connections.map((c) => c.id).join("|");
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (syncedKey !== serverKey && !open && !saving && !error) {
    setSyncedKey(serverKey);
    setSelection(connections);
    committed.current = connections.map((c) => c.id);
  }

  const send = useCallback(async (ids: string[]): Promise<void> => {
    const commit = commitRef.current;
    if (!commit) return;
    if (sameIds(ids, committed.current)) return;
    setSaving(true);
    setError(null);
    const res = await commit(ids.length ? ids : null).catch((): CommitResult => ({ ok: false, message: "Couldn't reach the server. Your selection is kept; try again." }));
    setSaving(false);
    if (res.ok) {
      committed.current = ids;
      return;
    }
    setError(res.message);
    // Closed already: the words go to a toast with a real Try again.
    if (!openRef.current) {
      toast(res.message, {
        tone: "danger",
        key: `connect:${itemId}:${field.key}`,
        action: { label: "Try again", onClick: () => { void send(ids); } },
      });
    }
  }, [toast, itemId, field.key]);

  /** Send what is waiting now, after whatever is already on its way. */
  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const ids = pending.current;
    pending.current = null;
    if (!ids) return;
    if (inFlight.current) await inFlight.current;
    const p = send(ids).finally(() => { if (inFlight.current === p) inFlight.current = null; });
    inFlight.current = p;
    await p;
  }, [send]);

  const schedule = useCallback((ids: string[]) => {
    pending.current = ids;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, COMMIT_DELAY_MS);
  }, [flush]);

  // A cell leaving the screen (a virtualized row, a navigation) still saves.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => () => { void flushRef.current(); }, []);

  const close = useCallback(() => {
    setOpen(false);
    void flush();
  }, [flush]);
  useLayer(open, { kind: "popover", close });

  // Click outside the cell and its panel closes (and so saves).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  // Each click is its own event and re-renders before the next, so the
  // selection it reads is current; the commit is scheduled from here, never
  // from inside a state updater (which React may run twice).
  const toggle = (c: ConnectionRef) => {
    const has = selection.some((p) => p.id === c.id);
    if (!has && selection.length >= MAX_CONNECTIONS) {
      setError(`A cell holds up to ${MAX_CONNECTIONS} connected tasks`);
      return;
    }
    setError(null);
    const next = has ? selection.filter((p) => p.id !== c.id) : [...selection, c];
    setSelection(next);
    schedule(next.map((p) => p.id));
  };

  const openTaskFromChip = (id: string) => openTask(router, id);
  const noTargets = connectTargets(field).length === 0;
  // A table cell is narrow: one readable chip and a count beat two chips cut
  // to nothing (monday's connect cell). The drawer has room for three.
  const chipCap = popover === "absolute" ? 3 : 1;
  const shown = selection.slice(0, chipCap);
  const overflow = selection.length - shown.length;

  if (readOnly || !onCommit) {
    // Nothing connected reads as an empty cell, like an empty mirror.
    if (connections.length === 0) return <span />;
    const vis = connections.slice(0, chipCap);
    return (
      <span className="flex min-w-0 items-center gap-1">
        {vis.map((c) => <Chip key={c.id} task={c} onOpen={openTaskFromChip} />)}
        {connections.length > vis.length ? (
          <span className="shrink-0 text-xs text-ink-2" title={connections.slice(vis.length).map((c) => c.title).join(", ")}>+{connections.length - vis.length}</span>
        ) : null}
      </span>
    );
  }

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => { if (open) close(); else { setOpen(true); setError(null); } }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-start"
      >
        {selection.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-3">
            <Plus className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Connect
          </span>
        ) : (
          <>
            {shown.map((c) => <Chip key={c.id} task={c} onOpen={openTaskFromChip} />)}
            {overflow > 0 ? <span className="shrink-0 text-xs text-ink-2" title={selection.slice(chipCap).map((c) => c.title).join(", ")}>+{overflow}</span> : null}
          </>
        )}
        {saving ? <Dots variant="pending" className="ms-1 shrink-0 text-ink-3" /> : null}
        {error && !open ? <span className="ms-1 shrink-0 text-xs text-danger-text" title={error}>Not saved</span> : null}
      </button>
      {open ? (
        <ConnectPanel
          anchorRef={anchorRef}
          panelRef={panelRef}
          mode={popover}
          field={field}
          fieldListId={fieldListId}
          itemId={itemId}
          noTargets={noTargets}
          selection={selection}
          onToggle={toggle}
          error={error}
          saving={saving}
          onRetry={() => { setError(null); void send(selection.map((c) => c.id)); }}
          onDone={close}
        />
      ) : null}
    </div>
  );
}

function ConnectPanel({
  anchorRef,
  panelRef,
  mode,
  field,
  fieldListId,
  itemId,
  noTargets,
  selection,
  onToggle,
  error,
  saving,
  onRetry,
  onDone,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  mode: "fixed" | "absolute";
  field: FieldDef;
  fieldListId: string | null;
  itemId: string | null;
  noTargets: boolean;
  selection: ConnectionRef[];
  onToggle: (c: ConnectionRef) => void;
  error: string | null;
  saving: boolean;
  onRetry: () => void;
  onDone: () => void;
}) {
  const pos = useAnchorPos(anchorRef, mode === "fixed", PANEL_W);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "forbidden">("loading");
  const [more, setMore] = useState(false);

  const load = useCallback(async (query: string, after: string | null, append: boolean) => {
    if (!fieldListId) { setState("forbidden"); return; }
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (itemId) params.set("item", itemId);
    if (after) params.set("cursor", after);
    try {
      const res = await fetch(`/api/boards/${fieldListId}/fields/${encodeURIComponent(field.key)}/candidates?${params}`, { cache: "no-store" });
      if (res.status === 404) { setState("forbidden"); return; }
      if (!res.ok) { setState("failed"); return; }
      const data = (await res.json()) as { items?: Candidate[]; nextCursor?: string | null };
      const page = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => (append ? [...prev, ...page.filter((p) => !prev.some((x) => x.id === p.id))] : page));
      setCursor(data.nextCursor ?? null);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [fieldListId, field.key, itemId]);

  useEffect(() => {
    if (noTargets) return;
    const t = window.setTimeout(() => { void load(q, null, false); }, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [q, load, noTargets]);

  const chosen = new Set(selection.map((c) => c.id));
  const atCap = selection.length >= MAX_CONNECTIONS;

  const body = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Connect tasks: ${field.label}`}
      onClick={(e) => e.stopPropagation()}
      className={`${mode === "fixed" ? "fixed z-[70]" : "absolute start-0 top-full z-[61] mt-1"} flex flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-[var(--os-shadow-pop)]`}
      style={
        mode === "fixed" && pos
          ? { left: pos.left, width: PANEL_W, ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }), maxHeight: Math.min(420, pos.maxHeight) }
          : { width: PANEL_W, maxHeight: 420 }
      }
    >
      {noTargets ? (
        <p className="px-3 py-3 text-sm text-ink-2">None of this column&apos;s Lists are shared with you</p>
      ) : (
        <>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
            <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks to connect"
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {selection.length > 0 ? (
              <div className="pb-1">
                <div className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-ink-3">Selected</div>
                {selection.map((c) => (
                  <div key={c.id} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.statusColor ?? "var(--os-ink-3)" }} aria-hidden />
                    <span className={`min-w-0 flex-1 truncate text-sm ${c.done ? "text-ink-3 line-through" : "text-ink"}`}>{c.title}</span>
                    <button
                      type="button"
                      onClick={() => onToggle(c)}
                      aria-label={`Remove ${c.title}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-ink-3">Tasks</div>
            {state === "forbidden" ? (
              <p className="px-2 py-2 text-sm text-ink-2">You can&apos;t pick connected tasks from this List</p>
            ) : state === "failed" ? (
              <p className="px-2 py-2 text-sm text-ink-2">Couldn&apos;t load tasks. Check your connection and try again.</p>
            ) : state === "loading" && items.length === 0 ? (
              <div className="px-2 py-2"><Dots variant="pending" label="Finding tasks" className="text-ink-3" /></div>
            ) : items.length === 0 ? (
              <p className="px-2 py-2 text-sm text-ink-2">{q.trim() ? "No task matches that" : "No tasks to connect yet"}</p>
            ) : (
              items.map((c) => {
                const on = chosen.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!on && atCap}
                    onClick={() => onToggle({ id: c.id, title: c.title, statusLabel: c.statusLabel, statusColor: c.statusColor, done: c.done })}
                    className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-hover disabled:opacity-50"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.statusColor ?? "var(--os-ink-3)" }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${c.done ? "text-ink-3 line-through" : "text-ink"}`}>{c.title}</span>
                      <span className="block truncate text-xs text-ink-2">{c.list.name}</span>
                    </span>
                    {on ? <Check className="h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} aria-hidden /> : null}
                  </button>
                );
              })
            )}
            {cursor && state === "ready" ? (
              <button
                type="button"
                disabled={more}
                onClick={async () => { setMore(true); await load(q, cursor, true); setMore(false); }}
                className="mt-1 flex h-8 w-full items-center justify-center rounded-md text-sm text-ink-2 hover:bg-hover disabled:opacity-50"
              >
                {more ? <Dots variant="pending" /> : "Show more"}
              </button>
            ) : null}
          </div>
          {atCap ? <p className="shrink-0 border-t border-line px-3 py-1.5 text-xs text-ink-2">A cell holds up to {MAX_CONNECTIONS} connected tasks</p> : null}
        </>
      )}
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-xs text-danger-text">{error}</span>
          <button type="button" onClick={onRetry} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-ink hover:bg-hover">
            <RotateCcw className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Retry
          </button>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-2 py-1.5">
        {saving ? <span className="me-auto inline-flex items-center gap-1 text-xs text-ink-2"><Dots variant="pending" /> Saving</span> : null}
        <button type="button" onClick={onDone} className="h-7 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover">Done</button>
      </div>
    </div>
  );
  // In a table the panel is portalled with a fixed position, so no scroller or
  // frozen column can clip or cover it. Inside the task drawer it stays a DOM
  // child, which keeps it in the drawer's own Esc and focus order.
  if (mode === "fixed") {
    if (!pos || typeof document === "undefined") return null;
    return createPortal(body, document.body);
  }
  return body;
}

// ── Mirror ───────────────────────────────────────────────────────────

const fieldsByList = new Map<string, Promise<FieldDef[]>>();
function listFields(boardId: string): Promise<FieldDef[]> {
  let p = fieldsByList.get(boardId);
  if (!p) {
    p = fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((d) => parseBoardSchema({ fields: Array.isArray(d?.fields) ? d.fields : [] }).fields)
      .catch(() => {
        fieldsByList.delete(boardId);
        return [] as FieldDef[];
      });
    fieldsByList.set(boardId, p);
  }
  return p;
}

const BUILTIN_LABEL: Record<string, string> = {
  __builtin_status: "Status",
  __builtin_priority: "Priority",
  __builtin_due: "Due date",
  __builtin_start: "Start date",
  __builtin_owner: "Assignee",
};

export function MirrorValue({
  field,
  mirror,
  renderField,
}: {
  field: FieldDef;
  mirror: MirrorData | undefined;
  /** Renders one value with the looked-up field's own display (FieldValue). */
  renderField: (def: FieldDef, value: unknown, boardId: string) => React.ReactNode;
}) {
  const prefs = useDatePrefs();
  // Keyed by the lookups' CONTENT: mirrorOptionsOf builds a new object on
  // every render, and an effect keyed on that object re-ran (and re-set its
  // state) on every render, a loop that never settled.
  const lookupKey = JSON.stringify(mirrorOptionsOf(field)?.lookupFieldKeys ?? {});
  const lookups = useMemo(() => Object.entries(JSON.parse(lookupKey) as Record<string, string>), [lookupKey]);
  const [defs, setDefs] = useState<Map<string, FieldDef | null> | null>(null);

  // One read per target List (cached for the page), only when a lookup names
  // a List field: builtins format themselves.
  useEffect(() => {
    let alive = true;
    const custom = lookups.filter(([, key]) => !BUILTIN_LABEL[key]);
    if (custom.length === 0) { setDefs(new Map()); return; }
    void Promise.all(custom.map(async ([listId, key]) => [listId, (await listFields(listId)).find((f) => f.key === key) ?? null] as const))
      .then((pairs) => { if (alive) setDefs(new Map(pairs)); });
    return () => { alive = false; };
  }, [lookups]);

  if (!mirror) return <span />;
  if (mirror.rollup !== undefined) {
    if (mirror.rollup === null || mirror.rollup === "") return <span />;
    if (typeof mirror.rollup === "number") {
      return <span className="text-xs tabular-nums text-ink">{new Intl.NumberFormat(prefs.language ?? undefined, { maximumFractionDigits: 2 }).format(mirror.rollup)}</span>;
    }
    return <span className="block truncate text-xs text-ink" title={mirror.rollup}>{mirror.rollup}</span>;
  }
  const values = mirror.values.filter((v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (values.length === 0) return <span />;

  // One type across every lookup: format each value the way that field does.
  const keys = new Set(lookups.map(([, k]) => k));
  const onlyBuiltin = keys.size === 1 && BUILTIN_LABEL[[...keys][0]] ? [...keys][0] : null;
  const typed = !onlyBuiltin && defs && lookups.length > 0
    ? (() => {
        const found = lookups.map(([listId]) => ({ listId, def: defs.get(listId) ?? null }));
        const types = new Set(found.map((f) => f.def?.type ?? "?"));
        return types.size === 1 && found[0].def ? found[0] : null;
      })()
    : null;

  const piece = (v: unknown, i: number) => {
    if (onlyBuiltin === "__builtin_priority" && typeof v === "string") return <span key={i} className="text-xs text-ink">{PRIORITY_LOOKUP[v]?.label ?? v}</span>;
    if ((onlyBuiltin === "__builtin_due" || onlyBuiltin === "__builtin_start") && typeof v === "string") {
      return <span key={i} className="text-xs text-ink">{formatDate(v, prefs, "date")}</span>;
    }
    if (onlyBuiltin === "__builtin_owner" && typeof v === "string") {
      return <span key={i} className="inline-flex">{renderField({ key: "__mirror_owner", label: "Assignee", type: "USER", position: 0 }, v, lookups[0]?.[0] ?? "")}</span>;
    }
    if (typed?.def) return <span key={i} className="inline-flex min-w-0">{renderField(typed.def, v, typed.listId)}</span>;
    return <span key={i} className="text-xs text-ink">{Array.isArray(v) ? v.join(", ") : String(v)}</span>;
  };
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{values.map(piece)}</span>;
}

/** A refusal from a connect or mirror route, as a sentence (re-exported for the config). */
export function connectMessage(payload: unknown, fallback: string): string {
  return accessMessage(payload, fallback);
}
