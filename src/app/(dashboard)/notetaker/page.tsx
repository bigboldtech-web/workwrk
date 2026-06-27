"use client";

/* Notetaker — paste-transcript-first AI extractor.
 *
 * Drop a meeting transcript on the left → Claude returns structured
 * decisions, action items, attendees on the right → one click saves
 * as a real Meeting (and optionally spawns Tasks for each action item).
 *
 *  Read:  GET  /api/meetings?limit=8
 *  Write: POST /api/notetaker/process { transcript }
 *         POST /api/notetaker/save    { title, type, decisions, ... }
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Mic, Sparkles, Save, FileText, CheckCircle2, Loader2, Eraser,
  AtSign, Calendar as CalendarIcon, Users, ArrowRight, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";

type Extracted = {
  title?: string;
  type?: string;
  summary?: string;
  decisions?: string[];
  actionItems?: { title: string; assigneeName?: string; assigneeEmail?: string | null; deadlineDays?: number | null }[];
  attendees?: { name: string; email?: string | null }[];
};

type ApiMeeting = {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  stats?: { decisionCount: number; actionItemsTotal: number; actionItemsDone: number; hasNotes: boolean };
};

const TYPE_LABELS: Record<string, string> = {
  DAILY_STANDUP: "Daily standup", WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1", QUARTERLY_REVIEW: "Quarterly", ANNUAL_PLANNING: "Annual planning",
  ADHOC: "Ad-hoc",
};

function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const EXAMPLE_TRANSCRIPT = `[10:02] Bigbold: Let's ship the new pricing page by Friday.
[10:03] Sarah:   I can take the copy — who's doing engineering?
[10:03] Arjun:   I'll handle eng — can finish by Wednesday.
[10:04] Bigbold: Great. Sarah, can you also write a launch tweet?
[10:04] Sarah:   On it — Thursday EOD.
[10:05] Bigbold: We agreed to drop the "Free trial" badge for now and
                 lead with the new $19 starter price instead.`;

export default function NotetakerPage() {
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [spawnTasks, setSpawnTasks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recents, setRecents] = useState<ApiMeeting[] | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();

  const loadRecents = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings?limit=8");
      if (!res.ok) return setRecents([]);
      const data = await res.json();
      const list: ApiMeeting[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRecents(list.filter((m) => m.stats?.hasNotes || (m.stats?.actionItemsTotal ?? 0) > 0));
    } catch { setRecents([]); }
  }, []);
  useEffect(() => { void loadRecents(); }, [loadRecents]);
  const v = rowVersion("notetaker");
  useEffect(() => { if (v > 0) void loadRecents(); }, [v, loadRecents]);

  async function extract() {
    if (transcript.trim().length < 20) { toast("Paste at least a short transcript first"); return; }
    setExtracting(true); setExtracted(null);
    try {
      const res = await fetch("/api/notetaker/process", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setExtracted(data.data ?? data);
    } catch { toast("Couldn't extract — Claude may be busy. Try again."); }
    finally { setExtracting(false); }
  }

  async function save() {
    if (!extracted?.title) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notetaker/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: extracted.title,
          type: (extracted.type as string) || "ADHOC",
          summary: extracted.summary,
          decisions: extracted.decisions ?? [],
          attendees: extracted.attendees ?? [],
          actionItems: extracted.actionItems ?? [],
          transcript,
          spawnTasks,
        }),
      });
      if (!res.ok) throw new Error();
      const actionsCount = extracted.actionItems?.length ?? 0;
      toast(`Saved "${extracted.title}"${spawnTasks && actionsCount ? ` + ${actionsCount} task${actionsCount === 1 ? "" : "s"} spawned` : ""}`);
      setTranscript(""); setExtracted(null);
      void loadRecents();
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  function loadExample() {
    setTranscript(EXAMPLE_TRANSCRIPT);
    setExtracted(null);
  }

  async function clearAll() {
    if (transcript.length === 0 && !extracted) return;
    if (!(await confirm({ title: "Clear transcript?", description: "Clear the transcript and result?", destructive: true, confirmLabel: "Clear" }))) return;
    setTranscript(""); setExtracted(null);
  }

  return (
    <>
      <OsTitleBar
        title="Notetaker"
        Icon={Mic}
        iconGradient={GRAD.pinkPurple}
        description="Paste any meeting transcript — Claude extracts decisions, action items, and attendees in seconds."
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={2}
        actions={
          <div className="ntk__head-actions">
            <button type="button" className="ntk__btn ntk__btn--ghost" onClick={loadExample}>
              <Sparkles /> Try example
            </button>
            <button type="button" className="ntk__btn ntk__btn--ghost" onClick={clearAll} disabled={!transcript && !extracted}>
              <Eraser /> Clear
            </button>
          </div>
        }
      />

      <div className="ntk">
        <div className="ntk__grid">
          {/* ── Left: transcript ─────────────────────────── */}
          <section className="ntk-pane ntk-pane--input">
            <header className="ntk-pane__head">
              <h2><FileText /> Transcript</h2>
              <span className="ntk-pane__count">{transcript.length.toLocaleString()} chars</span>
            </header>
            <textarea
              className="ntk-pane__textarea"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={`Paste your meeting transcript here.\n\nWorks with Zoom, Google Meet, Otter, raw notes — anything.\n\n${EXAMPLE_TRANSCRIPT.split("\n").slice(0, 3).join("\n")}`}
            />
            <footer className="ntk-pane__foot">
              <span className="ntk-pane__hint">
                {transcript.trim().length < 20 ? "Paste at least 20 characters to extract" : `Ready to extract`}
              </span>
              <button
                type="button"
                onClick={extract}
                disabled={extracting || transcript.trim().length < 20}
                className="ntk__btn ntk__btn--primary"
              >
                {extracting ? <><Loader2 className="ntk__spin" /> Extracting…</> : <><Sparkles /> Extract <ChevronRight /></>}
              </button>
            </footer>
          </section>

          {/* ── Right: result ────────────────────────────── */}
          <section className="ntk-pane ntk-pane--output">
            <header className="ntk-pane__head">
              <h2><Sparkles style={{ color: "var(--os-c-pink)" }} /> AI extraction</h2>
              {extracted && <span className="ntk-pane__count">Editable</span>}
            </header>

            {extracting ? (
              <div className="ntk__busy">
                <div className="ntk__busy-dots"><span /><span /><span /></div>
                <p>Claude is reading your transcript…</p>
                <small>Usually 3–8 seconds.</small>
              </div>
            ) : !extracted ? (
              <div className="ntk__empty">
                <Sparkles />
                <h3>Paste a transcript &amp; hit Extract</h3>
                <p>Structured decisions, action items, and attendees will land here. Every field is editable before you save.</p>
                <div className="ntk__empty-features">
                  <span><CheckCircle2 /> Decisions captured</span>
                  <span><CheckCircle2 /> Action items with owners</span>
                  <span><CheckCircle2 /> Attendees auto-listed</span>
                  <span><CheckCircle2 /> One click → real Meeting + Tasks</span>
                </div>
              </div>
            ) : (
              <div className="ntk__result">
                {/* Title + type */}
                <div className="ntk__result-row">
                  <div className="ntk__field ntk__field--grow">
                    <label>Meeting title</label>
                    <input
                      type="text"
                      value={extracted.title ?? ""}
                      onChange={(e) => setExtracted({ ...extracted, title: e.target.value })}
                      placeholder="Untitled meeting"
                    />
                  </div>
                  <div className="ntk__field">
                    <label>Type</label>
                    <select value={extracted.type ?? "ADHOC"} onChange={(e) => setExtracted({ ...extracted, type: e.target.value })}>
                      {Object.entries(TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="ntk__field">
                  <label>Summary</label>
                  <textarea
                    value={extracted.summary ?? ""}
                    onChange={(e) => setExtracted({ ...extracted, summary: e.target.value })}
                    rows={3}
                    placeholder="One-paragraph recap"
                  />
                </div>

                {/* Decisions */}
                <SectionHeader Icon={CheckCircle2} label="Decisions" count={extracted.decisions?.length ?? 0} color="var(--os-c-green)" />
                {(extracted.decisions?.length ?? 0) === 0 ? (
                  <p className="ntk__list-empty">No decisions captured.</p>
                ) : (
                  <ul className="ntk__decisions">
                    {(extracted.decisions ?? []).map((d, i) => (
                      <li key={i}>
                        <CheckCircle2 />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Action items */}
                <SectionHeader Icon={ArrowRight} label="Action items" count={extracted.actionItems?.length ?? 0} color="var(--os-c-blue)" />
                {(extracted.actionItems?.length ?? 0) === 0 ? (
                  <p className="ntk__list-empty">No action items detected.</p>
                ) : (
                  <ul className="ntk__actions">
                    {(extracted.actionItems ?? []).map((a, i) => (
                      <li key={i}>
                        <span className="ntk__actions-title">{a.title}</span>
                        <span className="ntk__actions-meta">
                          {a.assigneeName && <span className="ntk__actions-who">{a.assigneeName}</span>}
                          {a.deadlineDays != null && <span className="ntk__actions-due"><CalendarIcon /> in {a.deadlineDays}d</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Attendees */}
                <SectionHeader Icon={Users} label="Attendees" count={extracted.attendees?.length ?? 0} color="var(--os-c-purple)" />
                {(extracted.attendees?.length ?? 0) === 0 ? (
                  <p className="ntk__list-empty">No attendees identified.</p>
                ) : (
                  <div className="ntk__attendees">
                    {(extracted.attendees ?? []).map((a, i) => (
                      <span key={i} className="ntk__attendee">
                        {a.name}
                        {a.email && <em><AtSign />{a.email}</em>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Save footer */}
                <footer className="ntk__result-foot">
                  <label className="ntk__spawn">
                    <input type="checkbox" checked={spawnTasks} onChange={(e) => setSpawnTasks(e.target.checked)} />
                    <span>Spawn a task for each action item</span>
                  </label>
                  <button
                    type="button"
                    onClick={save}
                    className="ntk__btn ntk__btn--primary"
                    disabled={saving || !extracted.title}
                  >
                    {saving ? <><Loader2 className="ntk__spin" /> Saving…</> : <><Save /> Save meeting</>}
                  </button>
                </footer>
              </div>
            )}
          </section>
        </div>

        {/* ── Recent extractions ─────────────────────────── */}
        <section className="ntk__recents">
          <header>
            <h2>Recent extractions</h2>
            {recents && recents.length > 0 && (
              <span className="ntk__recents-count">{recents.length}</span>
            )}
          </header>
          {recents === null ? (
            <div className="ntk__recents-empty"><Loader2 className="ntk__spin" /> Loading recent meetings…</div>
          ) : recents.length === 0 ? (
            <div className="ntk__recents-empty">No processed meetings yet — your first one will appear here.</div>
          ) : (
            <div className="ntk__recents-grid">
              {recents.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="ntk__recent">
                  <div className="ntk__recent-title">{m.title}</div>
                  <div className="ntk__recent-meta">
                    <span className="ntk__recent-type">{TYPE_LABELS[m.type] ?? m.type}</span>
                    {(m.stats?.decisionCount ?? 0) > 0 && (
                      <span className="ntk__recent-stat"><CheckCircle2 /> {m.stats?.decisionCount}</span>
                    )}
                    {(m.stats?.actionItemsTotal ?? 0) > 0 && (
                      <span className="ntk__recent-stat"><ArrowRight /> {m.stats?.actionItemsDone}/{m.stats?.actionItemsTotal}</span>
                    )}
                    <span className="ntk__recent-time">{relTime(m.scheduledAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SectionHeader({ Icon, label, count, color }: { Icon: typeof Sparkles; label: string; count: number; color: string }) {
  return (
    <h3 className="ntk__section-h" style={{ ["--ntk-color" as string]: color }}>
      <Icon /> {label}
      <span>{count}</span>
    </h3>
  );
}
