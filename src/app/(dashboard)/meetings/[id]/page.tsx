"use client";

/* Meeting room — bespoke detail page.
 *
 * Two-column layout:
 *   Left (2/3): Notes editor with AI tools (voice → text, AI summary,
 *               paste transcript). Auto-saves every 30s.
 *   Right (1/3): Stacked sidebar — meeting info, attendees, decisions,
 *                action items, follow-up alert from previous meeting.
 *
 * Header: inline-editable title + type chip + when + attendee avatars
 * + delete + back. New `actions` slot used; no shared chrome.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Edit3, Save, Trash2, FileText, Users, CheckSquare,
  MessageSquare, Plus, Calendar as CalendarIcon, Clock, X,
  CheckCircle, Square, ExternalLink, Mic, Sparkles, ClipboardPaste,
  Loader2, AlertTriangle, ChevronRight,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { C } from "@/components/layout/os/catalog";

// ─── Types ────────────────────────────────────────────────

interface ActionItem {
  id: string;
  title: string;
  assigneeId: string;
  assignee: { id: string; firstName: string; lastName: string };
  deadline: string | null;
  status: string;
  completedAt: string | null;
}

interface Decision {
  text: string;
  decidedBy: string;
  date: string;
}

interface Meeting {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  duration: number;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  meetingUrl?: string | null;
  attendees: { id: string; userId: string; attended: boolean; user: { id: string; firstName: string; lastName: string; avatar: string | null; email: string } }[];
  actionItems: ActionItem[];
}

interface UserLite { id: string; firstName: string; lastName: string }

const TYPE_LABELS: Record<string, string> = {
  DAILY_STANDUP: "Daily standup", WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1", QUARTERLY_REVIEW: "Quarterly review",
  ANNUAL_PLANNING: "Annual planning", ADHOC: "Ad hoc",
};
const TYPE_COLORS: Record<string, string> = {
  DAILY_STANDUP: C.orange, WEEKLY_REVIEW: C.purple, ONE_ON_ONE: C.blue,
  QUARTERLY_REVIEW: C.indigo, ANNUAL_PLANNING: C.pink, ADHOC: C.yellow,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim()[0] ?? "";
  const l = (last ?? "").trim()[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

// ─── Voice-to-text (kept from previous implementation) ────

function VoiceRecordButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [interimText, setInterimText] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  const recognitionRef = useRef<{ stop: () => void; start: () => void } | null>(null);
  const isRecordingRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const MAX_CONSECUTIVE_FAILURES = 5;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  function buildRecognition() {
    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new (SR as new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      onstart: () => void; onresult: (e: { resultIndex: number; results: { isFinal: boolean; [k: number]: { transcript: string } }[] }) => void;
      onerror: (e: { error: string }) => void; onend: () => void;
      start: () => void; stop: () => void;
    })();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      consecutiveFailuresRef.current = 0;
      setReconnecting(false);
      setErrorMsg("");
    };
    recognition.onresult = (event) => {
      if (reconnecting) setReconnecting(false);
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          if (transcript) { onTranscriptRef.current(transcript); setInterimText(""); }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) setInterimText(interim);
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setErrorMsg("Microphone access denied — allow it in browser settings.");
        isRecordingRef.current = false;
        setIsRecording(false);
        setReconnecting(false);
        return;
      }
      if (e.error === "network") {
        if (isRecordingRef.current) setReconnecting(true);
        return;
      }
      console.error("[Voice] Error:", e.error);
    };
    recognition.onend = () => {
      if (!isRecordingRef.current) {
        setReconnecting(false); setInterimText(""); setIsRecording(false);
        return;
      }
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current > MAX_CONSECUTIVE_FAILURES) {
        setErrorMsg("Recognition keeps failing — check your connection or type directly.");
        isRecordingRef.current = false; setIsRecording(false); setReconnecting(false);
        return;
      }
      setReconnecting(true);
      const delay = Math.min(300 * Math.pow(2, consecutiveFailuresRef.current - 1), 4000);
      restartTimerRef.current = setTimeout(() => {
        if (!isRecordingRef.current) return;
        try {
          const fresh = buildRecognition();
          if (!fresh) return;
          recognitionRef.current = fresh;
          fresh.start();
        } catch { /* next onend will retry */ }
      }, delay);
    };
    return recognition;
  }

  function toggle() {
    setErrorMsg("");
    if (!supported) { setErrorMsg("Voice only works in Chrome."); return; }
    if (isRecording) {
      isRecordingRef.current = false;
      if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setIsRecording(false); setInterimText(""); setReconnecting(false);
      return;
    }
    isRecordingRef.current = true;
    consecutiveFailuresRef.current = 0;
    const fresh = buildRecognition();
    if (!fresh) { setErrorMsg("Voice only works in Chrome."); isRecordingRef.current = false; return; }
    recognitionRef.current = fresh;
    try { fresh.start(); setIsRecording(true); }
    catch { setErrorMsg("Couldn't start — check microphone permission."); isRecordingRef.current = false; }
  }

  if (!supported) return null;

  return (
    <div className="mtgr-tool">
      <button type="button" className={`mtgr-tool__btn ${isRecording ? "is-recording" : ""}`} onClick={toggle}>
        {isRecording ? (
          <>
            <span className="mtgr-tool__pulse" />
            Stop recording
          </>
        ) : (
          <><Mic /> Voice record</>
        )}
      </button>
      {isRecording && reconnecting && <span className="mtgr-tool__hint">Reconnecting…</span>}
      {isRecording && !reconnecting && interimText && <span className="mtgr-tool__interim">{interimText}…</span>}
      {isRecording && !reconnecting && !interimText && <span className="mtgr-tool__hint">Listening…</span>}
      {errorMsg && <span className="mtgr-tool__error">{errorMsg}</span>}
    </div>
  );
}

function AISummaryButton({ notes, onSummary }: { notes: string; onSummary: (s: string) => void }) {
  const [generating, setGenerating] = useState(false);
  const { toast } = useOsToast();

  async function generate() {
    if (!notes.trim()) { toast("Write some notes first."); return; }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `Convert these raw meeting notes into a structured Minutes of Meeting (MOM) format. Include sections: Attendees, Discussion Points, Key Decisions, Action Items (with owners), Next Steps. Keep it professional and concise.\n\n${notes}`,
          type: "meeting_summary",
        }),
      });
      if (!res.ok) { toast("AI service unavailable."); return; }
      const data = await res.json();
      const summary = data.response || data.data?.response || data.answer || "";
      if (summary) {
        onSummary(`— MINUTES OF MEETING —\n\n${summary}\n\n— Original notes —\n${notes}`);
        toast("Summary generated");
      } else { toast("AI returned no summary."); }
    } catch { toast("Couldn't generate summary"); }
    finally { setGenerating(false); }
  }

  return (
    <button type="button" className="mtgr-tool__btn" onClick={generate} disabled={generating || !notes.trim()}>
      {generating ? <Loader2 className="mtgr-spin" /> : <Sparkles />} {generating ? "Generating…" : "AI summary"}
    </button>
  );
}

function PasteTranscriptButton({ onPaste }: { onPaste: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");

  return (
    <>
      <button type="button" className="mtgr-tool__btn" onClick={() => setOpen(true)}>
        <ClipboardPaste /> Paste transcript
      </button>
      {open && (
        <Modal title="Paste meeting transcript" onClose={() => setOpen(false)} maxWidth={620}>
          <p className="mtgr-modal__hint">Paste from Zoom, Google Meet, Teams, or any transcription tool. Run AI summary after to structure it.</p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste your meeting transcript here…"
            rows={14}
            className="mtgr-modal__textarea"
          />
          <footer className="mtgr-modal__foot">
            <button type="button" className="mtgr-btn mtgr-btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="mtgr-btn mtgr-btn--primary" onClick={() => {
              if (transcript.trim()) { onPaste(transcript.trim()); setTranscript(""); setOpen(false); }
            }} disabled={!transcript.trim()}>
              Add to notes
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}

// ─── Reusable modal (matches OS aesthetic) ───────────────

function Modal({ title, onClose, children, maxWidth = 480 }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="mtgr-modal-back" onClick={onClose}>
      <div className="mtgr-modal" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <header className="mtgr-modal__head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className="mtgr-modal__body">{children}</div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [prevIncomplete, setPrevIncomplete] = useState<ActionItem[]>([]);

  // Title (inline-editable)
  const [titleDraft, setTitleDraft] = useState("");

  // Notes
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decisions
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [addingDecision, setAddingDecision] = useState(false);
  const [newDecision, setNewDecision] = useState("");

  // Action items
  const [addingAction, setAddingAction] = useState(false);
  const [aiTitle, setAiTitle] = useState("");
  const [aiAssigneeId, setAiAssigneeId] = useState("");
  const [aiDeadline, setAiDeadline] = useState("");

  // Delete
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ── Fetchers ────────────────────────────────────────────
  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${id}`);
      if (!res.ok) throw new Error("not ok");
      const data: Meeting = await res.json();
      setMeeting(data);
      setTitleDraft(data.title);
      setNotes(data.notes ?? "");
      try {
        const parsed = data.decisions ? JSON.parse(data.decisions) : [];
        setDecisions(Array.isArray(parsed) ? parsed : []);
      } catch {
        setDecisions(data.decisions ? [{ text: data.decisions, decidedBy: "", date: "" }] : []);
      }
    } catch (err) { console.error("Fetch meeting failed:", err); }
    finally { setLoading(false); }
  }, [id]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (!res.ok) return;
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : data?.data ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchPrevIncomplete = useCallback(async (m: Meeting) => {
    try {
      const res = await fetch(`/api/meetings?type=${m.type}`);
      if (!res.ok) return;
      const all = await res.json();
      const list = Array.isArray(all) ? all : all?.data?.items ?? [];
      const current = new Date(m.scheduledAt).getTime();
      const previous = list
        .filter((x: Meeting) => new Date(x.scheduledAt).getTime() < current && x.id !== m.id)
        .sort((a: Meeting, b: Meeting) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];
      if (!previous) return;
      const detailRes = await fetch(`/api/meetings/${previous.id}`);
      if (!detailRes.ok) return;
      const detail = await detailRes.json();
      const incomplete = (detail.actionItems ?? []).filter((ai: ActionItem) => ai.status !== "COMPLETED");
      setPrevIncomplete(incomplete);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchMeeting(); void fetchUsers(); }, [fetchMeeting, fetchUsers]);
  useEffect(() => { if (meeting) void fetchPrevIncomplete(meeting); }, [meeting, fetchPrevIncomplete]);

  // ── Auto-save notes ────────────────────────────────────
  useEffect(() => {
    if (!notesDirty || !meeting) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      setNotesSaving(true);
      await fetch(`/api/meetings/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      setNotesDirty(false);
      setNotesSaving(false);
    }, 2500); // shorter window — feels live
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [notes, notesDirty, id, meeting]);

  // ── Actions ────────────────────────────────────────────
  async function saveTitle() {
    if (!meeting || titleDraft.trim() === meeting.title) return;
    await fetch(`/api/meetings/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    void fetchMeeting();
  }

  async function saveAgenda(agenda: string) {
    if (!meeting) return;
    setMeeting({ ...meeting, agenda });
    await fetch(`/api/meetings/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agenda }),
    });
  }

  async function handleDelete() {
    const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    if (res.ok) { toast("Meeting deleted"); router.push("/meetings"); }
    else toast("Couldn't delete meeting");
    setConfirmingDelete(false);
  }

  async function addDecision() {
    if (!newDecision.trim()) return;
    const updated = [...decisions, { text: newDecision.trim(), decidedBy: "", date: new Date().toISOString().slice(0, 10) }];
    await fetch(`/api/meetings/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: JSON.stringify(updated) }),
    });
    setDecisions(updated);
    setNewDecision("");
    setAddingDecision(false);
  }

  async function removeDecision(idx: number) {
    const updated = decisions.filter((_, i) => i !== idx);
    await fetch(`/api/meetings/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: JSON.stringify(updated) }),
    });
    setDecisions(updated);
  }

  async function addActionItem() {
    if (!aiTitle || !aiAssigneeId) return;
    const res = await fetch(`/api/meetings/${id}/action-items`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: aiTitle, assigneeId: aiAssigneeId, deadline: aiDeadline || undefined }),
    });
    if (res.ok) {
      setAddingAction(false); setAiTitle(""); setAiAssigneeId(""); setAiDeadline("");
      void fetchMeeting();
    }
  }

  async function toggleAction(item: ActionItem) {
    const next = item.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    await fetch(`/api/meetings/${id}/action-items`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, status: next }),
    });
    void fetchMeeting();
  }

  async function deleteAction(itemId: string) {
    await fetch(`/api/meetings/${id}/action-items?itemId=${itemId}`, { method: "DELETE" });
    void fetchMeeting();
  }

  async function convertToTask(itemId: string) {
    const res = await fetch(`/api/meetings/${id}/action-items`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (res.ok) {
      const data = await res.json();
      toast(`Task created: ${data.task.title}`);
    }
  }

  // ── Render ──────────────────────────────────────────────
  if (loading) {
    return <div className="mtgr__loading"><Loader2 className="mtgr-spin" /> Loading meeting…</div>;
  }
  if (!meeting) {
    return (
      <div className="mtgr__not-found">
        <p>Meeting not found.</p>
        <button type="button" className="mtgr-btn mtgr-btn--ghost" onClick={() => router.push("/meetings")}>
          <ArrowLeft /> Back to meetings
        </button>
      </div>
    );
  }

  const color = TYPE_COLORS[meeting.type] ?? C.indigo;
  const typeLabel = TYPE_LABELS[meeting.type] ?? meeting.type;
  const actionsDone = meeting.actionItems.filter((a) => a.status === "COMPLETED").length;
  const actionsTotal = meeting.actionItems.length;
  const startMs = new Date(meeting.scheduledAt).getTime();
  const isPast = startMs + meeting.duration * 60_000 < Date.now();
  const isLive = startMs <= Date.now() && Date.now() < startMs + meeting.duration * 60_000;

  return (
    <div className="mtgr" style={{ ["--mtgr-color" as string]: color }}>
      {/* Header */}
      <header className="mtgr__head">
        <button type="button" className="mtgr__back" onClick={() => router.push("/meetings")} aria-label="Back">
          <ArrowLeft />
        </button>
        <div className="mtgr__head-main">
          <div className="mtgr__head-meta">
            <span className="mtgr__type-chip" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>{typeLabel}</span>
            {isLive && <span className="mtgr__live"><span className="mtgr__live-dot" /> Live now</span>}
            {isPast && !isLive && <span className="mtgr__past">Completed</span>}
            <span className="mtgr__head-when"><CalendarIcon /> {fmtDateTime(meeting.scheduledAt)}</span>
            <span className="mtgr__head-when"><Clock /> {meeting.duration} min</span>
          </div>
          <input
            type="text"
            className="mtgr__title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            placeholder="Untitled meeting"
          />
        </div>
        <div className="mtgr__head-actions">
          <button type="button" className="mtgr-btn mtgr-btn--ghost mtgr-btn--danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 /> Delete
          </button>
        </div>
      </header>

      {/* Follow-up alert */}
      {prevIncomplete.length > 0 && (
        <div className="mtgr__followup">
          <AlertTriangle />
          <div>
            <strong>{prevIncomplete.length} unfinished action{prevIncomplete.length === 1 ? "" : "s"} from your last {typeLabel.toLowerCase()}</strong>
            <ul>
              {prevIncomplete.slice(0, 3).map((ai) => (
                <li key={ai.id}>
                  {ai.title}
                  <em>— {ai.assignee.firstName} {ai.assignee.lastName}</em>
                </li>
              ))}
              {prevIncomplete.length > 3 && <li className="mtgr__followup-more">+{prevIncomplete.length - 3} more</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div className="mtgr__body">
        {/* Left: notes */}
        <main className="mtgr__notes">
          <header className="mtgr__notes-head">
            <h2><FileText /> Notes</h2>
            <div className="mtgr__notes-status">
              {notesSaving ? <><Loader2 className="mtgr-spin" /> Saving…</>
                : notesDirty ? <>Unsaved</>
                : <>All changes saved</>}
            </div>
          </header>
          <div className="mtgr__tools">
            <VoiceRecordButton onTranscript={(text) => { setNotes((prev) => prev + (prev ? "\n" : "") + text); setNotesDirty(true); }} />
            <AISummaryButton notes={notes} onSummary={(summary) => { setNotes(summary); setNotesDirty(true); }} />
            <PasteTranscriptButton onPaste={(text) => { setNotes((prev) => prev + (prev ? "\n\n— Pasted transcript —\n" : "") + text); setNotesDirty(true); }} />
          </div>
          <textarea
            className="mtgr__textarea"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
            placeholder={`Start typing notes for "${meeting.title}", or record voice, or paste a transcript above…`}
          />
        </main>

        {/* Right: sidebar */}
        <aside className="mtgr__side">
          {/* Agenda card */}
          <section className="mtgr-card">
            <header><h3><Edit3 /> Agenda</h3></header>
            <textarea
              className="mtgr-card__agenda"
              defaultValue={meeting.agenda ?? ""}
              onBlur={(e) => saveAgenda(e.target.value)}
              placeholder="What are we covering?"
              rows={3}
            />
          </section>

          {/* Attendees card */}
          <section className="mtgr-card">
            <header>
              <h3><Users /> Attendees</h3>
              <span className="mtgr-card__count">{meeting.attendees.length}</span>
            </header>
            <div className="mtgr-att-list">
              {meeting.attendees.length === 0 ? (
                <div className="mtgr-card__empty">No attendees added.</div>
              ) : meeting.attendees.map((a) => (
                <div key={a.id} className="mtgr-att-row">
                  <span className="mtgr-att-row__chip" style={{ background: avatarColorFor(a.userId) }}>
                    {initialsFor(a.user.firstName, a.user.lastName)}
                  </span>
                  <span className="mtgr-att-row__name">{a.user.firstName} {a.user.lastName}</span>
                  {a.attended && <CheckCircle className="mtgr-att-row__check" />}
                </div>
              ))}
            </div>
          </section>

          {/* Decisions card */}
          <section className="mtgr-card">
            <header>
              <h3><MessageSquare /> Decisions</h3>
              <span className="mtgr-card__count">{decisions.length}</span>
              <button type="button" className="mtgr-card__add" onClick={() => setAddingDecision(true)} aria-label="Add decision"><Plus /></button>
            </header>
            {decisions.length === 0 ? (
              <div className="mtgr-card__empty">No decisions recorded.</div>
            ) : (
              <ol className="mtgr-dec-list">
                {decisions.map((d, i) => (
                  <li key={i} className="mtgr-dec-row">
                    <p>{d.text}</p>
                    {d.date && <span>{fmtDate(d.date)}</span>}
                    <button type="button" onClick={() => removeDecision(i)} aria-label="Remove"><X /></button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Action items card */}
          <section className="mtgr-card">
            <header>
              <h3><CheckSquare /> Action items</h3>
              <span className="mtgr-card__count">{actionsDone} / {actionsTotal}</span>
              <button type="button" className="mtgr-card__add" onClick={() => setAddingAction(true)} aria-label="Add action"><Plus /></button>
            </header>
            {meeting.actionItems.length === 0 ? (
              <div className="mtgr-card__empty">Nothing assigned yet.</div>
            ) : (
              <ol className="mtgr-action-list">
                {meeting.actionItems.map((item) => (
                  <li key={item.id} className={`mtgr-action-row ${item.status === "COMPLETED" ? "is-done" : ""}`}>
                    <button type="button" onClick={() => toggleAction(item)} aria-label="Toggle done">
                      {item.status === "COMPLETED" ? <CheckCircle /> : <Square />}
                    </button>
                    <div className="mtgr-action-row__body">
                      <p>{item.title}</p>
                      <div>
                        <span>{item.assignee.firstName} {item.assignee.lastName}</span>
                        {item.deadline && <span>· due {fmtDate(item.deadline)}</span>}
                      </div>
                    </div>
                    <div className="mtgr-action-row__act">
                      <button type="button" onClick={() => convertToTask(item.id)} title="Convert to task"><ExternalLink /></button>
                      <button type="button" onClick={() => deleteAction(item.id)} title="Delete"><Trash2 /></button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {/* ── Modals ──────────────────────────────────── */}

      {addingDecision && (
        <Modal title="Add decision" onClose={() => setAddingDecision(false)}>
          <label className="mtgr-modal__label">What was decided?</label>
          <textarea
            value={newDecision}
            onChange={(e) => setNewDecision(e.target.value)}
            rows={4}
            className="mtgr-modal__textarea"
            placeholder="e.g. Ship v2 by Q3 end with feature X scoped down…"
          />
          <footer className="mtgr-modal__foot">
            <button type="button" className="mtgr-btn mtgr-btn--ghost" onClick={() => setAddingDecision(false)}>Cancel</button>
            <button type="button" className="mtgr-btn mtgr-btn--primary" onClick={addDecision} disabled={!newDecision.trim()}>
              Add decision <ChevronRight />
            </button>
          </footer>
        </Modal>
      )}

      {addingAction && (
        <Modal title="Add action item" onClose={() => setAddingAction(false)}>
          <label className="mtgr-modal__label">Title</label>
          <input type="text" value={aiTitle} onChange={(e) => setAiTitle(e.target.value)} className="mtgr-modal__input" placeholder="What needs to be done?" />
          <label className="mtgr-modal__label">Assigned to</label>
          <select value={aiAssigneeId} onChange={(e) => setAiAssigneeId(e.target.value)} className="mtgr-modal__input">
            <option value="">Pick someone…</option>
            {(meeting.attendees ?? []).map((a) => (
              <option key={a.user.id} value={a.user.id}>{a.user.firstName} {a.user.lastName} (in meeting)</option>
            ))}
            {users.filter((u) => !meeting.attendees.some((a) => a.user.id === u.id)).map((u) => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
          <label className="mtgr-modal__label">Deadline (optional)</label>
          <input type="date" value={aiDeadline} onChange={(e) => setAiDeadline(e.target.value)} className="mtgr-modal__input" />
          <footer className="mtgr-modal__foot">
            <button type="button" className="mtgr-btn mtgr-btn--ghost" onClick={() => setAddingAction(false)}>Cancel</button>
            <button type="button" className="mtgr-btn mtgr-btn--primary" onClick={addActionItem} disabled={!aiTitle || !aiAssigneeId}>
              Add action <ChevronRight />
            </button>
          </footer>
        </Modal>
      )}

      {confirmingDelete && (
        <Modal title="Delete this meeting?" onClose={() => setConfirmingDelete(false)}>
          <p className="mtgr-modal__hint">
            This permanently deletes &ldquo;{meeting.title}&rdquo; along with all notes, decisions, and action items. This can&apos;t be undone.
          </p>
          <footer className="mtgr-modal__foot">
            <button type="button" className="mtgr-btn mtgr-btn--ghost" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            <button type="button" className="mtgr-btn mtgr-btn--danger" onClick={handleDelete}>
              <Trash2 /> Delete meeting
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
