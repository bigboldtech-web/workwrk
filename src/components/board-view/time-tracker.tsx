"use client";

// TimeTracker — start/stop timer + manual entry + recent-sessions list,
// scoped to a polymorphic entity (today: BOARD_ITEM). Mirrors the shape
// of /api/timers — one running session per user, many stopped sessions
// summed into a total.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Plus, Clock, Loader2, X } from "lucide-react";

interface Session {
  id: string;
  userId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number;
}

interface ApiState {
  active: { id: string; startedAt: string } | null;
  totalMs: number;
  sessions: Session[];
}

interface Props {
  entityType: "BOARD_ITEM" | "TASK" | "KRA" | "KPI" | "SOP";
  entityId: string;
  canEdit: boolean;
}

function formatMs(ms: number): string {
  if (ms < 1000) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRunning(startedAt: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(startedAt).getTime());
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TimeTracker({ entityType, entityId, canEdit }: Props) {
  const [state, setState] = useState<ApiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingManual, setAddingManual] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick once per second when there's a running timer, so the elapsed
  // display updates live without a server roundtrip.
  const activeRef = useRef<boolean>(false);
  activeRef.current = Boolean(state?.active);
  useEffect(() => {
    if (!state?.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.active]);

  const load = useCallback(() => {
    fetch(`/api/timers?entityType=${entityType}&entityId=${entityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ApiState | null) => {
        if (data) setState(data);
      })
      .catch(() => {});
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      await fetch("/api/timers/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await fetch("/api/timers/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const isRunning = Boolean(state?.active);
  const liveTotalMs = state
    ? state.totalMs +
      (state.active
        ? Math.max(0, now - new Date(state.active.startedAt).getTime() - state.sessions
            .filter((s) => !s.stoppedAt && s.id === state.active?.id)
            .reduce((acc, s) => acc + s.durationMs, 0))
        : 0)
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Time tracked
          {state ? (
            <span className="text-zinc-400 normal-case font-normal">
              · {formatMs(liveTotalMs)} total
            </span>
          ) : null}
        </h3>
        {canEdit && !addingManual ? (
          <button
            type="button"
            onClick={() => setAddingManual(true)}
            className="text-[11px] text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Manual entry
          </button>
        ) : null}
      </div>

      {canEdit ? (
        <div className="mb-2 flex items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={stop}
              disabled={busy}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-red-500 hover:bg-red-600 text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
              Stop
              {state?.active ? (
                <span className="font-mono tabular-nums text-[11.5px] opacity-90">
                  {formatRunning(state.active.startedAt, now)}
                </span>
              ) : null}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
              Start timer
            </button>
          )}
        </div>
      ) : null}

      {addingManual ? (
        <ManualEntryForm
          entityType={entityType}
          entityId={entityId}
          onCancel={() => setAddingManual(false)}
          onSaved={() => {
            setAddingManual(false);
            load();
          }}
        />
      ) : null}

      {state === null ? (
        <div className="text-xs text-zinc-400">Loading…</div>
      ) : state.sessions.length === 0 ? (
        <div className="text-xs text-zinc-400 leading-relaxed">
          No time logged yet. Start the timer when you begin a focused block.
        </div>
      ) : (
        <ul className="space-y-1">
          {state.sessions.slice(0, 6).map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 text-[12px] text-zinc-600 px-2 py-1 rounded-md hover:bg-zinc-50"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.stoppedAt ? "bg-zinc-300" : "bg-emerald-500 animate-pulse"
                }`}
                aria-hidden
              />
              <span className="font-mono tabular-nums">{formatMs(s.durationMs)}</span>
              <span className="text-zinc-400">·</span>
              <span className="truncate">{relTime(s.startedAt)}</span>
            </li>
          ))}
          {state.sessions.length > 6 ? (
            <li className="text-[11px] text-zinc-400 px-2">
              +{state.sessions.length - 6} earlier sessions
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function ManualEntryForm({
  entityType,
  entityId,
  onCancel,
  onSaved,
}: {
  entityType: string;
  entityId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const h = Math.max(0, parseInt(hours, 10) || 0);
    const m = Math.max(0, parseInt(minutes, 10) || 0);
    const durationMs = (h * 3600 + m * 60) * 1000;
    if (durationMs < 1000) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/timers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId, durationMs, notes: notes.trim() || undefined }),
      });
      onSaved();
    } catch {
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={24}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="h-7 w-12 px-1.5 text-center rounded border border-zinc-200 bg-white text-[12.5px] focus:outline-none focus:border-zinc-400"
          aria-label="Hours"
        />
        <span className="text-[11px] text-zinc-500">h</span>
        <input
          type="number"
          min={0}
          max={59}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-7 w-12 px-1.5 text-center rounded border border-zinc-200 bg-white text-[12.5px] focus:outline-none focus:border-zinc-400"
          aria-label="Minutes"
        />
        <span className="text-[11px] text-zinc-500">m</span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you worked on (optional)"
          className="flex-1 h-7 px-2 rounded border border-zinc-200 bg-white text-[12px] focus:outline-none focus:border-zinc-400"
        />
      </div>
      <div className="flex items-center gap-1 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-7 w-7 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-500"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-7 px-2.5 rounded bg-zinc-900 text-white text-[12px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Log time
        </button>
      </div>
    </div>
  );
}
