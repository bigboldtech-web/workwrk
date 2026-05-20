"use client";

// Notetaker — Phase D6. Paste a meeting transcript, AI extracts summary
// + decisions + action items + attendees, you review/edit, save.

import { useState } from "react";
import {
  Mic,
  Sparkles,
  Loader2,
  Save,
  Plus,
  X,
  CheckCircle2,
  ChevronRight,
  Users as UsersIcon,
  Calendar,
} from "lucide-react";
import Link from "next/link";

type Extraction = {
  title?: string;
  type?: string;
  summary?: string;
  decisions?: string[];
  actionItems?: { title: string; assigneeName?: string; assigneeEmail?: string | null; deadlineDays?: number | null }[];
  attendees?: { name: string; email?: string | null }[];
};

const MEETING_TYPES = ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"];

const SAMPLE_TRANSCRIPT = `Alice: Okay let's kick off the standup. Quick updates from everyone.

Bob: I finished the migration to the new auth service yesterday. Going to spend today writing tests for the edge cases — should be done by Thursday.

Alice: Great. Carol, status on the analytics dashboard?

Carol: Stuck on the date-range picker bug. I'll pair with Bob tomorrow morning to get unblocked. Goal is to ship by end of week.

Dave: I caught a P1 with the email-send queue overnight. Patched it but need to write a postmortem by Friday. Also blocking on Carol's PR for the dashboard - need that merged before I can finish the launch email.

Alice: Decisions: Carol owns the dashboard ship by Friday, Dave does the postmortem by Friday. Bob and Carol pair tomorrow at 10am.

Bob: One more thing — we should probably move our weekly review to Wednesdays. Tuesdays don't work anymore now that Alice has the leadership offsite.

Alice: Agreed. Effective next week.`;

export default function NotetakerPage() {
  const [transcript, setTranscript] = useState("");
  const [hint, setHint] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [tokens, setTokens] = useState<{ in: number; out: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<{ meetingId: string; counts: Record<string, number> } | null>(null);
  const [spawnTasks, setSpawnTasks] = useState(true);

  async function extract() {
    if (!transcript.trim() || extracting) return;
    setExtracting(true);
    setExtraction(null);
    setSavedSummary(null);
    setError(null);
    try {
      const res = await fetch("/api/notetaker/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, hint: hint || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Extraction failed");
        return;
      }
      if (data.extraction) {
        setExtraction(data.extraction as Extraction);
      } else {
        setError("Model didn't return valid JSON. Raw output:\n\n" + (data.rawText ?? ""));
      }
      setTokens({ in: data.tokensIn ?? 0, out: data.tokensOut ?? 0 });
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    if (!extraction || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notetaker/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: extraction.title ?? "Meeting notes",
          type: MEETING_TYPES.includes(extraction.type ?? "") ? extraction.type : "ADHOC",
          summary: extraction.summary,
          decisions: extraction.decisions ?? [],
          attendees: extraction.attendees ?? [],
          actionItems: extraction.actionItems ?? [],
          transcript,
          spawnTasks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setSavedSummary({ meetingId: data.meeting.id, counts: data.counts });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setTranscript("");
    setHint("");
    setExtraction(null);
    setError(null);
    setTokens(null);
    setSavedSummary(null);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium mb-3">
          <Mic size={12} />
          Notetaker
        </div>
        <h1 className="text-2xl font-semibold mb-1">Meeting transcript → action items</h1>
        <p className="text-sm text-muted">Paste a transcript, Claude extracts the summary, decisions, action items, and attendees. Review, then save as a meeting with auto-spawned tasks.</p>
      </div>

      {savedSummary ? (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={20} className="text-emerald-600" />
            <h2 className="font-semibold text-emerald-900 dark:text-emerald-100">Meeting saved</h2>
          </div>
          <div className="text-sm text-emerald-900 dark:text-emerald-100 space-y-1 mb-4">
            <div>• {savedSummary.counts.attendees} attendees linked to users{savedSummary.counts.attendeesUnmatched > 0 && <span className="text-emerald-700"> ({savedSummary.counts.attendeesUnmatched} unmatched preserved in notes)</span>}</div>
            <div>• {savedSummary.counts.decisions} decisions captured</div>
            <div>• {savedSummary.counts.actionItems} action items created</div>
            {savedSummary.counts.tasksSpawned > 0 && <div>• {savedSummary.counts.tasksSpawned} tasks spawned to assignees</div>}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/meetings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              View in Meetings
              <ChevronRight size={12} />
            </Link>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-sm font-medium"
            >
              <Plus size={12} /> Notetake another
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Transcript input */}
          <div className="space-y-3 mb-6">
            <div>
              <label className="block text-xs font-medium text-muted-2 mb-1">Optional hint <span className="text-muted-2 font-normal">(meeting name, attendee names, anything ambiguous)</span></label>
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. Weekly product standup with the platform team"
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-muted-2">Transcript</label>
                <button
                  type="button"
                  onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
                  className="text-[10px] text-violet-600 hover:text-violet-700"
                >
                  Try with sample transcript
                </button>
              </div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={12}
                placeholder="Paste the transcript here. Any format works — Zoom export, Otter.ai, Granola, plain text from notes…"
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono"
              />
              <p className="text-[10px] text-muted-2 mt-1">{transcript.length.toLocaleString()} characters · max 120,000</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={extract}
                disabled={extracting || !transcript.trim() || transcript.length < 20}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {extracting ? "Extracting…" : "Extract with Claude"}
              </button>
              {extraction && (
                <button
                  type="button"
                  onClick={() => setExtraction(null)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Clear extraction
                </button>
              )}
            </div>
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 whitespace-pre-wrap font-mono">
                {error}
              </div>
            )}
          </div>

          {/* Extraction preview */}
          {extraction && (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-amber-900 dark:text-amber-100 inline-flex items-center gap-2">
                  <Sparkles size={14} /> Extraction
                </h2>
                {tokens && <span className="text-[10px] text-amber-700 dark:text-amber-300">{tokens.in} in + {tokens.out} out tokens</span>}
              </div>

              <Field label="Title">
                <input
                  value={extraction.title ?? ""}
                  onChange={(e) => setExtraction({ ...extraction, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white dark:bg-zinc-900 text-sm"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select
                    value={extraction.type ?? "ADHOC"}
                    onChange={(e) => setExtraction({ ...extraction, type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white dark:bg-zinc-900 text-sm"
                  >
                    {MEETING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <label className="flex items-end gap-2 text-sm pb-2">
                  <input type="checkbox" checked={spawnTasks} onChange={(e) => setSpawnTasks(e.target.checked)} />
                  Also create Tasks from action items
                </label>
              </div>

              <Field label="Summary">
                <textarea
                  value={extraction.summary ?? ""}
                  onChange={(e) => setExtraction({ ...extraction, summary: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white dark:bg-zinc-900 text-sm"
                />
              </Field>

              <Field label={`Attendees (${extraction.attendees?.length ?? 0})`}>
                <div className="space-y-2">
                  {(extraction.attendees ?? []).map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <UsersIcon size={12} className="text-muted-2 flex-shrink-0" />
                      <input
                        value={a.name}
                        onChange={(e) => {
                          const next = [...(extraction.attendees ?? [])];
                          next[i] = { ...a, name: e.target.value };
                          setExtraction({ ...extraction, attendees: next });
                        }}
                        placeholder="Name"
                        className="flex-1 px-2 py-1 rounded border border-amber-200 bg-white dark:bg-zinc-900 text-xs"
                      />
                      <input
                        value={a.email ?? ""}
                        onChange={(e) => {
                          const next = [...(extraction.attendees ?? [])];
                          next[i] = { ...a, email: e.target.value || null };
                          setExtraction({ ...extraction, attendees: next });
                        }}
                        placeholder="email@example.com (optional)"
                        className="flex-1 px-2 py-1 rounded border border-amber-200 bg-white dark:bg-zinc-900 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = (extraction.attendees ?? []).filter((_, idx) => idx !== i);
                          setExtraction({ ...extraction, attendees: next });
                        }}
                        className="p-1 text-muted-2 hover:text-rose-600"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExtraction({ ...extraction, attendees: [...(extraction.attendees ?? []), { name: "", email: "" }] })}
                    className="text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
                  >
                    <Plus size={11} /> Add attendee
                  </button>
                </div>
              </Field>

              <Field label={`Decisions (${extraction.decisions?.length ?? 0})`}>
                <div className="space-y-2">
                  {(extraction.decisions ?? []).map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-amber-700">•</span>
                      <input
                        value={d}
                        onChange={(e) => {
                          const next = [...(extraction.decisions ?? [])];
                          next[i] = e.target.value;
                          setExtraction({ ...extraction, decisions: next });
                        }}
                        className="flex-1 px-2 py-1 rounded border border-amber-200 bg-white dark:bg-zinc-900 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = (extraction.decisions ?? []).filter((_, idx) => idx !== i);
                          setExtraction({ ...extraction, decisions: next });
                        }}
                        className="p-1 text-muted-2 hover:text-rose-600"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExtraction({ ...extraction, decisions: [...(extraction.decisions ?? []), ""] })}
                    className="text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
                  >
                    <Plus size={11} /> Add decision
                  </button>
                </div>
              </Field>

              <Field label={`Action items (${extraction.actionItems?.length ?? 0})`}>
                <div className="space-y-2">
                  {(extraction.actionItems ?? []).map((ai, i) => (
                    <div key={i} className="rounded-lg bg-white dark:bg-zinc-900 border border-amber-200 p-2 space-y-1.5">
                      <input
                        value={ai.title}
                        onChange={(e) => {
                          const next = [...(extraction.actionItems ?? [])];
                          next[i] = { ...ai, title: e.target.value };
                          setExtraction({ ...extraction, actionItems: next });
                        }}
                        placeholder="What needs to happen"
                        className="w-full px-2 py-1 rounded border border-amber-200 bg-surface text-xs"
                      />
                      <div className="grid grid-cols-3 gap-1.5">
                        <input
                          value={ai.assigneeName ?? ""}
                          onChange={(e) => {
                            const next = [...(extraction.actionItems ?? [])];
                            next[i] = { ...ai, assigneeName: e.target.value };
                            setExtraction({ ...extraction, actionItems: next });
                          }}
                          placeholder="Assignee name"
                          className="px-2 py-1 rounded border border-amber-200 bg-surface text-xs"
                        />
                        <input
                          value={ai.assigneeEmail ?? ""}
                          onChange={(e) => {
                            const next = [...(extraction.actionItems ?? [])];
                            next[i] = { ...ai, assigneeEmail: e.target.value || null };
                            setExtraction({ ...extraction, actionItems: next });
                          }}
                          placeholder="Email (preferred)"
                          className="px-2 py-1 rounded border border-amber-200 bg-surface text-xs"
                        />
                        <div className="flex items-center gap-1">
                          <Calendar size={11} className="text-muted-2 flex-shrink-0" />
                          <input
                            type="number"
                            min={0}
                            max={365}
                            value={ai.deadlineDays ?? ""}
                            onChange={(e) => {
                              const next = [...(extraction.actionItems ?? [])];
                              next[i] = { ...ai, deadlineDays: e.target.value === "" ? null : Number(e.target.value) };
                              setExtraction({ ...extraction, actionItems: next });
                            }}
                            placeholder="days"
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-amber-200 bg-surface text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = (extraction.actionItems ?? []).filter((_, idx) => idx !== i);
                              setExtraction({ ...extraction, actionItems: next });
                            }}
                            className="p-1 text-muted-2 hover:text-rose-600 flex-shrink-0"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExtraction({ ...extraction, actionItems: [...(extraction.actionItems ?? []), { title: "", assigneeName: "", deadlineDays: null }] })}
                    className="text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
                  >
                    <Plus size={11} /> Add action item
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-2 rounded-lg text-sm text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !extraction.title}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {saving ? "Saving…" : "Save meeting"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
