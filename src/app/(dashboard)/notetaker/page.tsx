"use client";

/* Notetaker — paste-transcript-first workflow.
 *
 * Left: big textarea where you drop a meeting transcript.
 * Right: result panel that streams extracted decisions, action items,
 *        attendees as soon as you click Extract. Save commits a Meeting
 *        row + ActionItem rows + optional Task auto-spawn.
 *
 * Below: recent extractions as a thin recap list (last 8). No table.
 *
 * Reads:  GET  /api/meetings?limit=8
 * Writes: POST /api/notetaker/process { transcript }
 *         POST /api/notetaker/save    { title, type, decisions, attendees, actionItems, … }
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mic, Sparkles, Save, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

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

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotetakerPage() {
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [spawnTasks, setSpawnTasks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recents, setRecents] = useState<ApiMeeting[] | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

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
      if (!res.ok) throw new Error(`process ${res.status}`);
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
      if (!res.ok) throw new Error(`save ${res.status}`);
      toast(`Saved meeting "${extracted.title}"${spawnTasks && extracted.actionItems?.length ? ` + spawned ${extracted.actionItems.length} task(s)` : ""}`);
      setTranscript(""); setExtracted(null);
      void loadRecents();
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  return (
    <div className="ntk">
      <header className="ntk__head">
        <div className="ntk__head-l">
          <div className="ntk__icon"><Mic /></div>
          <div>
            <h1 className="ntk__title">Notetaker</h1>
            <div className="ntk__sub">Paste a transcript. Claude extracts decisions, action items, and attendees in seconds.</div>
          </div>
        </div>
      </header>

      <div className="ntk__grid">
        <section className="ntk__input">
          <header><FileText /> Transcript</header>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={"Paste the meeting transcript here…\n\nWorks with Zoom, Google Meet, Otter, raw notes — anything.\n\nExample:\n[10:02] Bigbold: Let's ship the new pricing page by Friday\n[10:03] Sarah: I can take the copy, who's doing engineering?\n[10:03] Arjun: I'll handle eng — can finish by Wednesday."}
            rows={20}
          />
          <footer>
            <span className="ntk__char">{transcript.length} chars</span>
            <button type="button" onClick={extract} disabled={extracting || transcript.trim().length < 20} className="ntk__btn ntk__btn--primary">
              {extracting ? <><Loader2 className="ntk__spin" /> Extracting…</> : <><Sparkles /> Extract</>}
            </button>
          </footer>
        </section>

        <section className="ntk__output">
          <header><Sparkles /> Result</header>
          {extracting ? (
            <div className="ntk__output-busy">
              <Loader2 className="ntk__spin" />
              <span>Claude is reading…</span>
            </div>
          ) : !extracted ? (
            <div className="ntk__output-empty">
              <p>Paste a transcript on the left and hit <strong>Extract</strong>. The structured output lands here.</p>
            </div>
          ) : (
            <div className="ntk__result">
              <div className="ntk__result-field">
                <label>Meeting title</label>
                <input
                  type="text"
                  value={extracted.title ?? ""}
                  onChange={(e) => setExtracted({ ...extracted, title: e.target.value })}
                />
              </div>
              <div className="ntk__result-row">
                <div className="ntk__result-field">
                  <label>Type</label>
                  <select value={extracted.type ?? "ADHOC"} onChange={(e) => setExtracted({ ...extracted, type: e.target.value })}>
                    <option value="DAILY_STANDUP">Daily standup</option>
                    <option value="WEEKLY_REVIEW">Weekly review</option>
                    <option value="ONE_ON_ONE">1:1</option>
                    <option value="QUARTERLY_REVIEW">Quarterly</option>
                    <option value="ANNUAL_PLANNING">Annual planning</option>
                    <option value="ADHOC">Ad-hoc</option>
                  </select>
                </div>
              </div>
              <div className="ntk__result-field">
                <label>Summary</label>
                <textarea
                  value={extracted.summary ?? ""}
                  onChange={(e) => setExtracted({ ...extracted, summary: e.target.value })}
                  rows={3}
                />
              </div>

              <h3>Decisions · {extracted.decisions?.length ?? 0}</h3>
              <ul className="ntk__list">
                {(extracted.decisions ?? []).map((d, i) => (
                  <li key={i}><CheckCircle2 style={{ width: 14, height: 14, color: "var(--os-c-green)" }} /> {d}</li>
                ))}
                {(extracted.decisions?.length ?? 0) === 0 && <li className="ntk__list-empty">No decisions captured.</li>}
              </ul>

              <h3>Action items · {extracted.actionItems?.length ?? 0}</h3>
              <ul className="ntk__list ntk__list--actions">
                {(extracted.actionItems ?? []).map((a, i) => (
                  <li key={i}>
                    <span>{a.title}</span>
                    <span className="ntk__action-who">
                      {a.assigneeName ?? "—"}
                      {a.deadlineDays != null && <em> · due in {a.deadlineDays}d</em>}
                    </span>
                  </li>
                ))}
                {(extracted.actionItems?.length ?? 0) === 0 && <li className="ntk__list-empty">No action items.</li>}
              </ul>

              <h3>Attendees · {extracted.attendees?.length ?? 0}</h3>
              <div className="ntk__attendees">
                {(extracted.attendees ?? []).map((a, i) => (
                  <span key={i} className="ntk__attendee">{a.name}{a.email ? ` · ${a.email}` : ""}</span>
                ))}
              </div>

              <footer className="ntk__result-foot">
                <label className="ntk__spawn">
                  <input type="checkbox" checked={spawnTasks} onChange={(e) => setSpawnTasks(e.target.checked)} />
                  Spawn a task for each action item
                </label>
                <button type="button" onClick={save} className="ntk__btn ntk__btn--primary" disabled={saving || !extracted.title}>
                  {saving ? "Saving…" : <><Save /> Save meeting</>}
                </button>
              </footer>
            </div>
          )}
        </section>
      </div>

      <section className="ntk__recents">
        <h2>Recent extractions</h2>
        {recents === null ? (
          <div className="ntk__recents-empty">Loading…</div>
        ) : recents.length === 0 ? (
          <div className="ntk__recents-empty">No processed meetings yet.</div>
        ) : (
          <div className="ntk__recents-list">
            {recents.map((m) => (
              <Link key={m.id} href={`/meetings/${m.id}`} className="ntk__recent">
                <span className="ntk__recent-title">{m.title}</span>
                <span className="ntk__recent-stats">
                  {(m.stats?.decisionCount ?? 0) > 0 && <span>{m.stats?.decisionCount} decision{m.stats?.decisionCount === 1 ? "" : "s"}</span>}
                  {(m.stats?.actionItemsTotal ?? 0) > 0 && <span>{m.stats?.actionItemsTotal} action{m.stats?.actionItemsTotal === 1 ? "" : "s"}</span>}
                </span>
                <span className="ntk__recent-time">{timeAgo(m.scheduledAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
