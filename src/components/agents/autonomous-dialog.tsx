"use client";

// AutonomousDialog — controls for putting an agent on a schedule (or
// running it once on demand). Powers the "AI controls the people"
// pillar: the user picks a recurring beat + a brief, and from then on
// the agent fires without being asked.
//
// PATCH /api/agents/[slug]/schedule writes the schedule; POST on the
// same route does an immediate dry-run so the user can see what the
// agent would produce before letting it loose.

import { useCallback, useEffect, useState } from "react";
import {
  X, Sparkles, Loader2, Clock, Play, Check, AlertCircle, History,
  ChevronDown, ChevronRight, Zap, AlertTriangle,
} from "lucide-react";

interface ScheduleState {
  autonomousEnabled: boolean;
  scheduleCron: string | null;
  autonomousPrompt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface Props {
  agentSlug: string;
  agentName: string;
  initial: ScheduleState;
  onClose: () => void;
  onSaved: (next: ScheduleState) => void;
}

const PRESETS: { label: string; value: string; hint: string }[] = [
  { label: "Hourly", value: "hourly", hint: "Every 60 minutes" },
  { label: "Every 4 hours", value: "every 4 hours", hint: "6× per day" },
  { label: "Daily", value: "daily", hint: "Once a day at 9am" },
  { label: "Weekly", value: "weekly", hint: "Once a week, 9am" },
];

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const future = ms > 0;
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return future ? "in <1m" : "<1m ago";
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

interface RunHistoryRow {
  id: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  tokensIn: number | null;
  tokensOut: number | null;
  output: { text?: string; toolCalls?: unknown[] } | null;
  error: string | null;
}

export function AutonomousDialog({ agentSlug, agentName, initial, onClose, onSaved }: Props) {
  const [autonomousEnabled, setEnabled] = useState(initial.autonomousEnabled);
  const [scheduleCron, setSchedule] = useState(initial.scheduleCron ?? "daily");
  const [autonomousPrompt, setPrompt] = useState(initial.autonomousPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState(initial.lastRunAt);
  const [nextRunAt, setNextRunAt] = useState(initial.nextRunAt);
  const [recentRuns, setRecentRuns] = useState<RunHistoryRow[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const loadRecentRuns = useCallback(async () => {
    try {
      const r = await fetch(`/api/agents/runs?limit=5&agent=${encodeURIComponent(agentSlug)}`);
      if (!r.ok) return;
      const d = await r.json();
      // The runs API returns a generic shape — narrow to what we need.
      setRecentRuns(
        (d.runs ?? []).map((r: RunHistoryRow & { agentSlug: string }) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          output: r.output,
          error: r.error,
        })),
      );
    } catch {
      // Best-effort — history is a nicety, not load-blocking.
    }
  }, [agentSlug]);

  useEffect(() => { loadRecentRuns(); }, [loadRecentRuns]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentSlug}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autonomousEnabled,
          scheduleCron: scheduleCron.trim() || null,
          autonomousPrompt: autonomousPrompt.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Save failed");
        return;
      }
      setLastRunAt(d.agent.lastRunAt);
      setNextRunAt(d.agent.nextRunAt);
      onSaved({
        autonomousEnabled: d.agent.autonomousEnabled,
        scheduleCron: d.agent.scheduleCron,
        autonomousPrompt: d.agent.autonomousPrompt,
        lastRunAt: d.agent.lastRunAt,
        nextRunAt: d.agent.nextRunAt,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setError(null);
    setRunOutput(null);
    try {
      // Always save the current draft first so what we run is what
      // the user just typed — feels right and matches the schedule.
      if (autonomousEnabled !== initial.autonomousEnabled ||
          scheduleCron !== (initial.scheduleCron ?? "") ||
          autonomousPrompt !== (initial.autonomousPrompt ?? "")) {
        await handleSave();
      }
      const r = await fetch(`/api/agents/${agentSlug}/schedule`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Run failed");
        return;
      }
      setRunOutput(d.result?.output || "(no text output)");
      if (d.result?.status === "FAILED") {
        setError(d.result.errorText || "Run failed");
      }
      setLastRunAt(new Date().toISOString());
      // Refresh inline history so the new run shows up at the top.
      await loadRecentRuns();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={() => { if (!saving && !running) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Sparkles size={16} className="text-violet-600" />
            {agentName} · autonomous run
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || running}
            className="p-1 rounded hover:bg-surface-2 text-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-muted-2">
          Set a recurring beat + a brief. The agent fires on schedule without anyone prompting it — results land on your dashboard.
        </p>

        <label className="flex items-start gap-2 p-3 rounded-lg border border-border bg-surface cursor-pointer">
          <input
            type="checkbox"
            checked={autonomousEnabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5"
          />
          <span className="flex-1">
            <span className="text-sm font-medium block">Run autonomously on this schedule</span>
            <span className="text-xs text-muted-2">When off, the agent only runs when you chat with it or hit &ldquo;Run now&rdquo;.</span>
          </span>
        </label>

        <div>
          <p className="text-xs font-medium text-muted-2 mb-1.5">Schedule</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSchedule(p.value)}
                className={
                  "px-2.5 py-1.5 rounded-md border text-xs text-left " +
                  (scheduleCron === p.value
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300"
                    : "border-border hover:border-violet-300")
                }
              >
                <span className="block font-medium">{p.label}</span>
                <span className="block text-[10px] text-muted-2">{p.hint}</span>
              </button>
            ))}
          </div>
          <input
            type="text"
            value={scheduleCron}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder='hourly · daily · "every 15 minutes"'
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono"
          />
          <p className="text-[11px] text-muted-2 mt-1">
            Supports <code>hourly</code>, <code>daily</code>, <code>weekly</code>, or <code>every N minutes</code> / <code>every N hours</code>.
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-2 mb-1.5">Brief (what should they do every cycle?)</p>
          <textarea
            value={autonomousPrompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder='e.g. "Review yesterday&apos;s deals. Flag anything stuck >5 days in the same stage. Post a one-paragraph summary."'
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
          <p className="text-[11px] text-muted-2 mt-1">
            The agent runs this as the recurring user message. Be specific — &ldquo;flag stuck deals&rdquo; works better than &ldquo;check in&rdquo;.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-2 px-1">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} /> Last run {relTime(lastRunAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={11} /> Next run {autonomousEnabled ? relTime(nextRunAt) : "paused"}
          </span>
        </div>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300 inline-flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {runOutput && !error && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <div className="inline-flex items-center gap-1 font-semibold mb-1">
              <Check size={12} /> Dry-run output
            </div>
            <div className="whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{runOutput}</div>
          </div>
        )}

        {recentRuns.length > 0 && (
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-2 inline-flex items-center gap-1.5">
              <History size={10} /> Recent runs
            </div>
            <ul className="divide-y divide-border">
              {recentRuns.map((r) => {
                const open = expandedRunId === r.id;
                const isFail = r.status === "FAILED";
                const text = r.output?.text ?? "";
                const summary = isFail
                  ? r.error ?? "Failed"
                  : text.split("\n").find((l) => l.trim().length > 0) ?? "(no output)";
                const mins = Math.round((Date.now() - new Date(r.startedAt).getTime()) / 60000);
                const rel =
                  mins < 1 ? "just now" :
                  mins < 60 ? `${mins}m ago` :
                  mins < 60 * 24 ? `${Math.round(mins / 60)}h ago` :
                  `${Math.round(mins / 60 / 24)}d ago`;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(open ? null : r.id)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-2 flex items-start gap-2"
                    >
                      {isFail ? (
                        <AlertTriangle size={11} className="text-rose-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Zap size={11} className="text-violet-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-2">
                          <span>{rel}</span>
                          {r.tokensIn !== null && r.tokensOut !== null && (
                            <span>· {r.tokensIn + r.tokensOut} tok</span>
                          )}
                        </div>
                        <p
                          className={
                            "text-xs " +
                            (isFail ? "text-rose-700 dark:text-rose-400" : "text-foreground") +
                            (open ? " whitespace-pre-wrap" : " line-clamp-1")
                          }
                        >
                          {open ? (text || summary) : summary}
                        </p>
                      </div>
                      <span className="text-muted-2 flex-shrink-0">
                        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleRunNow}
            disabled={saving || running}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-violet-500 text-violet-700 dark:text-violet-300 text-xs font-medium hover:bg-violet-50 dark:hover:bg-violet-950/20 disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? "Running…" : "Run now"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || running}
              className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || running}
              className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
