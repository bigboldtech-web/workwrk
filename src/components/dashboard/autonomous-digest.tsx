"use client";

// AutonomousDigest — dashboard card that surfaces what the agents got
// done while no one was looking. Pulls the latest N AgentRun rows
// across all enabled agents in this org with trigger=SCHEDULED and
// renders them in a tight stack: agent name, time, one-line summary,
// expand-to-see-the-full-output.
//
// "AI controls the people" needs to be visible to land — if the
// scheduler runs every hour but no one sees the output, it isn't
// felt. This card is that surface.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles, Zap, ChevronRight, ChevronDown, Loader2, AlertTriangle,
} from "lucide-react";

interface RunRow {
  id: string;
  agentName: string;
  agentSlug: string;
  agentHue: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  endedAt: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  output: { text?: string; toolCalls?: unknown[]; finishReason?: string | null } | null;
  error: string | null;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function AutonomousDigest() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/agents/runs?trigger=SCHEDULED&limit=6");
      if (!r.ok) { setRuns([]); return; }
      const d = await r.json();
      setRuns(d.runs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Hide the card when there's nothing autonomous to show — keeps the
  // dashboard from carrying dead space for orgs that haven't turned
  // on autonomous agents yet. Show on initial load to communicate
  // existence, then collapse to a CTA if still empty after fetch.
  if (!loading && (runs?.length ?? 0) === 0) {
    return (
      <Link
        href="/agents"
        className="group rounded-2xl border border-dashed border-violet-300/40 dark:border-violet-700/40 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/20 p-4 flex items-start gap-3 hover:border-violet-400 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/30 text-violet-600 flex items-center justify-center flex-shrink-0">
          <Zap size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Put your agents to work autonomously</p>
          <p className="text-xs text-muted-2 mt-0.5">
            Schedule any installed agent to run on its own — they&rsquo;ll crunch numbers and flag issues here while you focus on other work.
          </p>
        </div>
        <span className="text-xs text-violet-600 font-medium inline-flex items-center gap-1 mt-1 group-hover:translate-x-0.5 transition-transform">
          Configure <ChevronRight size={11} />
        </span>
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="inline-flex items-center gap-2">
          <Sparkles size={13} className="text-violet-600" />
          <h2 className="text-sm font-semibold">What your agents got done</h2>
          {!loading && (
            <span className="text-[10px] text-muted-2 tabular-nums">
              · {runs?.length ?? 0} recent
            </span>
          )}
        </div>
        <Link
          href="/agents"
          className="text-xs text-muted-2 hover:text-foreground inline-flex items-center gap-1"
        >
          Manage <ChevronRight size={11} />
        </Link>
      </div>

      {loading ? (
        <div className="p-6 text-xs text-muted-2 inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading recent runs…
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {(runs ?? []).map((r) => {
            const open = expanded === r.id;
            const summary = (() => {
              if (r.status === "FAILED") return r.error ?? "Run failed";
              if (r.status === "PENDING") return "Running…";
              const text = r.output?.text ?? "";
              return text.split("\n").find((l) => l.trim().length > 0) ?? "(no output)";
            })();
            const isFail = r.status === "FAILED";
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-2 flex items-start gap-3"
                >
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                      isFail
                        ? "bg-rose-100 dark:bg-rose-950/30 text-rose-600"
                        : "bg-violet-100 dark:bg-violet-950/30 text-violet-600"
                    }`}
                  >
                    {isFail ? <AlertTriangle size={13} /> : <Zap size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">{r.agentName}</span>
                      <span className="text-[10px] text-muted-2">· {relTime(r.startedAt)}</span>
                      {r.tokensIn !== null && r.tokensOut !== null && (
                        <span className="text-[10px] text-muted-2">
                          · {r.tokensIn + r.tokensOut} tok
                        </span>
                      )}
                    </div>
                    <p
                      className={
                        "text-xs " +
                        (isFail ? "text-rose-700 dark:text-rose-400" : "text-muted-2") +
                        (open ? " whitespace-pre-wrap" : " line-clamp-2")
                      }
                    >
                      {open ? (r.output?.text ?? summary) : summary}
                    </p>
                    {open && r.output?.toolCalls && Array.isArray(r.output.toolCalls) && r.output.toolCalls.length > 0 && (
                      <p className="text-[10px] text-muted-2 mt-1">
                        {r.output.toolCalls.length} tool call{r.output.toolCalls.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-2 flex-shrink-0 mt-1">
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
