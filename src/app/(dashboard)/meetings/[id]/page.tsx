"use client";

/* The meeting detail page (naming canon: Meetings, never "Meeting room").
 *
 * Two-column layout:
 *   Left (2/3): Notes editor with AI tools (voice to text, AI summary,
 *               paste transcript). Auto-saves every 30s.
 *   Right (1/3): Stacked sidebar: meeting info, people, decisions,
 *                action items, follow-up alert from previous meeting.
 *
 * Header: inline-editable title + type chip + when + attendee avatars
 * + delete + back. New `actions` slot used; no shared chrome.
 */

import { BackButton } from "@/components/ui/back-button";
import { Dots } from "@/components/ui/dots";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Edit3,
  Trash2,
  FileText,
  Users,
  CheckSquare,
  MessageSquare,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  X,
  CheckCircle,
  Square,
  ExternalLink,
  Mic,
  Sparkles,
  ClipboardPaste,
  AlertTriangle,
  ChevronRight,
  Video,
  Link2,
  Copy,
  CalendarPlus,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useOsToast } from "@/components/layout/os/toast";
import { useLayer, useOsShell } from "@/components/layout/os/shell-context";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Chip } from "@/components/ui/chip";
import { Avatar } from "@/components/ui/avatar-stack";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { DateTimeField } from "@/components/ui/date-time-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  type MeetingTypeWord,
} from "@/lib/meeting-type";
import { MEETING_LENGTHS, formatLength, meetingWindow } from "@/lib/meeting-list";
import { zonedInputToIso, zonedInputValue } from "@/lib/zoned-input";
import { NotFoundView } from "@/components/access/not-found-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { formatDate, type DateFormatPrefs } from "@/lib/format/date";

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
  call?: { room: string; guestUrl: string };
  /** What this viewer may do, decided by the server (GET /api/meetings/[id]). */
  viewerRole?: "full" | "edit" | "none";
  canEdit?: boolean;
  canDelete?: boolean;
}

interface UserLite { id: string; firstName: string; lastName: string }

// A meeting type is a LABEL, not a signal, so it is a neutral Chip and
// never a colour (design-system 5.16). The six hue aliases that used to key
// this page (C.orange for a standup, C.purple for a review) are gone, and
// so is the avatar palette that tinted somebody's initials by a hash of
// their user id: an identity colour nobody chose is a fake fact about a
// person. Attendees render through the shared Avatar, which uses the real
// picture when there is one.
const TYPE_LABELS: Record<string, string> = MEETING_TYPE_LABELS;

// Both of these render in the VIEWER'S time zone and date order
// (home.locale), not the machine's and not en-US. A meeting stored at
// 10:00 UTC used to read as the server box's afternoon to every reader.
function fmtDate(iso: string | null, prefs: DateFormatPrefs): string {
  if (!iso) return "-";
  return formatDate(iso, prefs, "date");
}
function fmtDateTime(iso: string, prefs: DateFormatPrefs): string {
  return `${formatDate(iso, prefs, "weekday")} ${formatDate(iso, prefs, "date")} · ${formatDate(iso, prefs, "time")}`;
}

// ─── Voice-to-text (kept from previous implementation) ────

function VoiceRecordButton({ onTranscript, onRecordingChange }: {
  onTranscript: (text: string) => void;
  /** So the notes header can hold the tools panel open while it is live. */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [interimText, setInterimText] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  const recognitionRef = useRef<{ stop: () => void; start: () => void } | null>(null);
  const isRecordingRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest callback, kept in a ref so the long-lived SpeechRecognition
  // handlers below never close over a stale one. Written in an effect, not
  // during render: a render can be thrown away or replayed, and a ref written
  // in one is a side effect React never agreed to.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; });

  const MAX_CONSECUTIVE_FAILURES = 5;

  // Reported in an effect rather than from inside the handlers, so the
  // parent's state change is a reaction to this one and never a second
  // render inside the first (react-hooks/set-state-in-effect).
  const recordingChangeRef = useRef(onRecordingChange);
  useEffect(() => { recordingChangeRef.current = onRecordingChange; });
  useEffect(() => { recordingChangeRef.current?.(isRecording); }, [isRecording]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    // "This browser has Web Speech" is a fact about the browser, so it is
    // read after mount (the server has no window) and written on the next
    // tick rather than synchronously inside the effect, which would cascade
    // a second render before the first has painted.
    let hide: ReturnType<typeof setTimeout> | null = null;
    if (!SR) hide = setTimeout(() => setSupported(false), 0);
    return () => {
      if (hide) clearTimeout(hide);
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
        setErrorMsg("Microphone access denied. Allow it in browser settings.");
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
        setErrorMsg("Recognition keeps failing. Check your connection, or type directly.");
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
    catch { setErrorMsg("Couldn't start. Check the microphone permission."); isRecordingRef.current = false; }
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
        onSummary(`MINUTES OF MEETING\n\n${summary}\n\nOriginal notes\n${notes}`);
        toast("Summary generated");
      } else { toast("AI returned no summary."); }
    } catch { toast("Couldn't generate summary"); }
    finally { setGenerating(false); }
  }

  return (
    <button type="button" className="mtgr-tool__btn" onClick={generate} disabled={generating || !notes.trim()}>
      {generating ? <Dots variant="pending" /> : <Sparkles />} {generating ? "Generating…" : "AI summary"}
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

/**
 * The header overflow (spec-planner section 2 /meetings/[id]).
 *
 * "Add to my Google Calendar" is a real ICS download from the endpoint this
 * product already serves, not a Google integration: it opens in the calendar
 * the person actually uses, and it renders for everyone because everyone has
 * a calendar. Nothing here is a "Coming soon" row.
 */
function MeetingMenu({ meeting, onCopyLink, onDuplicate, onStartCall, onDelete }: {
  meeting: Meeting;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onStartCall: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayer(open, { kind: "popover", close: () => setOpen(false) });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="mtgr-btn mtgr-btn--ghost"
        aria-label="More meeting actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </button>
      <MorePortal anchorRef={btnRef} width={240} open={open} panelRef={panelRef} placement="below">
        <MenuList aria-label="Meeting actions">
          <MenuItem icon={Link2} label="Copy link" onClick={run(onCopyLink)} />
          <MenuItem icon={Copy} label="Duplicate" onClick={run(onDuplicate)} />
          {meeting.call?.room ? (
            <MenuItem icon={Video} label="Start call again" onClick={run(onStartCall)} />
          ) : null}
          <MenuItem
            icon={CalendarPlus}
            label="Add to my calendar"
            href={`/api/meetings/${meeting.id}/ics`}
            onClick={() => setOpen(false)}
          />
          {onDelete ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete" destructive onClick={run(onDelete)} />
            </>
          ) : null}
        </MenuList>
      </MorePortal>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const datePrefs = useDatePrefs();

  const { data: session } = useSession();
  const sessionName = session?.user?.name ?? null;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  // The meeting call runs in the shell-level CallDock so it survives leaving
  // this page. callOpen just derives whether THIS meeting is the active call.
  const { activeCall, startCall: startGlobalCall, setCallMinimized, railApps } = useOsShell();
  const callOpen = activeCall?.meetingId === id;
  /** Is the AI module entitled for this org? The rail is the one read. */
  const aiEntitled = railApps.some((a) => a.key === "ai");
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserLite[]>([]);
  // The clock, sampled in an effect and refreshed once a minute. Nothing on
  // this page reads Date.now() during render.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  const [prevIncomplete, setPrevIncomplete] = useState<ActionItem[]>([]);
  const [prevMeeting, setPrevMeeting] = useState<{ id: string; title: string } | null>(null);
  const [carrying, setCarrying] = useState<string | null>(null);

  // Title (inline-editable)
  const [titleDraft, setTitleDraft] = useState("");

  // Notes
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  /** The tools panel under the Notes heading, and whether voice is live. */
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
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
  /** The last write that did not land, kept on screen until one does. */
  const [saveError, setSaveError] = useState<string | null>(null);

  // The details strip
  const peopleOptions = useMemo<PickerOption[]>(
    () => users.map((u) => ({
      value: u.id,
      label: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Someone",
    })),
    [users],
  );
  const [stripSaving, setStripSaving] = useState(false);
  /** Non-null while a custom length is being typed on the details strip. */
  const [customLength, setCustomLength] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);

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
      // The previous meeting's id and title are kept, so the block that
      // names its unfinished work can be OPENED. It listed the items as
      // plain text with no link and no way to act on them, which is a block
      // that names a destination it cannot reach.
      setPrevMeeting({ id: previous.id, title: previous.title ?? "the last one" });
      setPrevIncomplete(incomplete);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchMeeting(); void fetchUsers(); }, [fetchMeeting, fetchUsers]);
  useEffect(() => { if (meeting) void fetchPrevIncomplete(meeting); }, [meeting, fetchPrevIncomplete]);

  /**
   * THE ONE WRITE PATH for this meeting, and the one place a failure is
   * reported. Keepalive, so a save fired as the tab closes still reaches the
   * server; the server's own sentence when there is one, because only it can
   * say WHICH rule refused; `false` on every failure so the caller keeps
   * what the person typed rather than clearing it.
   *
   * SAVE PATHS (the phase's hard rule): a write on this page is meeting
   * minutes. It is never dropped in silence.
   */
  const putMeeting = useCallback(async (patch: Record<string, unknown>, label: string): Promise<boolean> => {
    let res: Response | null = null;
    try {
      res = await fetch(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      });
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setSaveError(
        typeof body?.error === "string"
          ? body.error
          : res
            ? `Couldn't save the ${label}. Try again`
            : `You're offline, so the ${label} has not been saved. It is still here.`,
      );
      return false;
    }
    setSaveError(null);
    return true;
  }, [id]);

  // ?call=1 deep link → auto-join the meeting call in the shell dock, once.
  const meetingCallHandledRef = useRef(false);
  useEffect(() => {
    const wantCall = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("call") === "1";
    if (!wantCall || meetingCallHandledRef.current || !meeting?.call?.room) return;
    meetingCallHandledRef.current = true;
    startGlobalCall({
      meetingId: id,
      subject: meeting.title,
      displayName: sessionName,
      audioOnly: false,
      href: `/meetings/${id}`,
    });
  }, [meeting, id, sessionName, startGlobalCall]);

  // ── Auto-save notes ────────────────────────────────────
  //
  // A SAVE THAT FAILED USED TO READ AS A SAVE THAT WORKED. This effect
  // awaited the PUT, never looked at `res.ok`, never caught a network
  // failure, and then set notesDirty to false, so the header said "All
  // changes saved" over minutes the server had rejected and the next reload
  // showed an empty page. It also carried no keepalive, so a save fired as
  // the tab closed was dropped. Every write on this page now goes through
  // `putMeeting`, which reports honestly.
  useEffect(() => {
    if (!notesDirty || !meeting) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      void (async () => {
        setNotesSaving(true);
        const ok = await putMeeting({ notes }, "notes");
        setNotesSaving(false);
        // Still dirty on failure: the composer keeps what was typed and the
        // header keeps saying "Unsaved" until it actually lands.
        if (ok) setNotesDirty(false);
      })();
    }, 2500); // shorter window, feels live
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [notes, notesDirty, id, meeting, putMeeting]);

  // ── Actions ────────────────────────────────────────────
  async function saveTitle() {
    if (!meeting || titleDraft.trim() === meeting.title) return;
    const ok = await putMeeting({ title: titleDraft.trim() }, "title");
    if (!ok) { setTitleDraft(meeting.title); return; }
    void fetchMeeting();
  }

  /**
   * One write path for every field on the details strip.
   *
   * Time, length, type and attendees were DISPLAY ONLY on this page: the
   * only way to move a meeting by ten minutes was to delete it and make a
   * new one (comms.md section 5, "cannot edit time, type or attendees").
   * The API has always accepted all four on PUT; nothing ever sent them.
   *
   * The row is updated locally first so the control does not snap back
   * while the request is in flight, and a failure re-reads the server so
   * the screen never keeps a value the server refused.
   */
  async function saveField(patch: Record<string, unknown>, label: string) {
    if (!meeting) return;
    setMeeting({ ...meeting, ...(patch as Partial<Meeting>) });
    setStripSaving(true);
    const ok = await putMeeting(patch, label);
    setStripSaving(false);
    // A failure re-reads the server, so the screen never keeps a value the
    // server refused.
    void fetchMeeting();
    if (!ok) return;
  }

  async function saveAgenda(agenda: string) {
    if (!meeting) return;
    setMeeting({ ...meeting, agenda });
    const ok = await putMeeting({ agenda }, "agenda");
    if (!ok) void fetchMeeting();
  }

  /** The same meeting a week on, with its people, agenda and length. */
  async function duplicateMeeting() {
    if (!meeting) return;
    const next = new Date(new Date(meeting.scheduledAt).getTime() + 7 * 86_400_000).toISOString();
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meeting.title,
          type: meeting.type,
          scheduledAt: next,
          duration: meeting.duration,
          agenda: meeting.agenda ?? undefined,
          attendeeIds: meeting.attendees.map((a) => a.userId),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast(typeof body?.error === "string" ? body.error : "Couldn't duplicate this meeting. Try again", { tone: "danger" });
        return;
      }
      const newId = body?.id ?? body?.data?.id;
      toast("Duplicated a week later");
      if (newId) router.push(`/meetings/${newId}`);
    } catch {
      toast("Couldn't reach the server. Nothing was duplicated", { tone: "danger" });
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
      if (res.ok) { toast("Meeting moved to Trash"); router.push("/meetings"); }
      else {
        // The server's own sentence: it is the only text that can say WHICH
        // rule refused. A generic toast threw away "Only the person who
        // scheduled this meeting can delete it." and left the person
        // clicking a button that would never work.
        const body = await res.json().catch(() => null);
        toast(typeof body?.error === "string" ? body.error : "Couldn't delete the meeting. Try again");
      }
    } catch {
      toast("Couldn't reach the server. Check your connection and try again");
    }
    setConfirmingDelete(false);
  }

  async function addDecision() {
    if (!newDecision.trim()) return;
    // The decider is the writer. `decidedBy: ""` was written on every
    // decision this page has ever recorded, so the card could show WHAT was
    // decided and never WHO decided it (comms.md section 5).
    const updated = [...decisions, {
      text: newDecision.trim(),
      decidedBy: sessionName ?? "",
      date: new Date().toISOString().slice(0, 10),
    }];
    // The dialog stays open with the text still in it if this fails.
    const ok = await putMeeting({ decisions: JSON.stringify(updated) }, "decision");
    if (!ok) return;
    setDecisions(updated);
    setNewDecision("");
    setAddingDecision(false);
  }

  async function removeDecision(idx: number) {
    const updated = decisions.filter((_, i) => i !== idx);
    const ok = await putMeeting({ decisions: JSON.stringify(updated) }, "decisions");
    if (!ok) return;
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

  /** Copy an unfinished item from the previous meeting onto this one. */
  async function carryOver(item: ActionItem) {
    setCarrying(item.id);
    let ok = false;
    try {
      const res = await fetch(`/api/meetings/${id}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          assigneeId: item.assigneeId ?? item.assignee?.id,
          ...(item.deadline ? { deadline: item.deadline } : {}),
        }),
        keepalive: true,
      });
      ok = res.ok;
      if (!ok) {
        const body = await res.json().catch(() => null);
        toast(typeof body?.error === "string" ? body.error : "Couldn't carry this over. Try again", { tone: "danger" });
      }
    } catch {
      toast("Couldn't reach the server. The item has not been carried over", { tone: "danger" });
    }
    setCarrying(null);
    if (ok) { toast("Carried over to this meeting"); void fetchMeeting(); }
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
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.task) {
      toast(data?.error ?? "Couldn't convert this to a task. Try again");
      return;
    }
    // The server answers `alreadyConverted` on a repeat and hands back the
    // SAME task (that is what ActionItem.itemId is for). Saying "Task
    // created" then is a lie, and the second click is the one people make.
    toast(data.alreadyConverted ? `Already a task: ${data.task.title}` : `Task created: ${data.task.title}`);
    void fetchMeeting();
  }

  // ── Render ──────────────────────────────────────────────
  if (loading) {
    return <SkeletonRows />;
  }
  // The in-shell 404 (spec-shell 2.4): the same view as any unknown object.
  if (!meeting) return <NotFoundView />;

  const typeLabel = TYPE_LABELS[meeting.type] ?? meeting.type;
  const actionsDone = meeting.actionItems.filter((a) => a.status === "COMPLETED").length;
  const actionsTotal = meeting.actionItems.length;
  // The window, from the sampled clock rather than from Date.now() during
  // render: a component that reads the clock while rendering gives the
  // server and the first client paint two different answers.
  const callWindow = meetingWindow(meeting.scheduledAt, meeting.duration, nowMs);
  const isLive = callWindow === "live";
  const isPast = callWindow === "ended";

  return (
    <div className="mtgr">
      {/* The bar names the meeting: "Planner > Meetings > {title}". Without
          this the location row ended at the container (spec-shell 2.1 rule 2)
          and every meeting looked like the same page. */}
      <Breadcrumb items={[{ label: "Meetings", href: "/meetings" }, { label: meeting.title || "Untitled meeting" }]} />
      {/* Header */}
      <header className="mtgr__head">
        <BackButton fallbackHref="/meetings" label="Meetings" />
        {/* TITLE FIRST, ON THE BACK BUTTON'S OWN LINE (spec-planner section 2
            /meetings/[id]: "Title row (48): BackButton ..., then the title
            22/600, a pale chip"). It used to put the chip, the time and the
            length on row one and drop the title onto a second row starting
            at x=462, so the one thing the page is about lined up with
            nothing else on it: not the back row at 370, not the card at 358.
            The when and the length are the meta line UNDER the title, where
            a detail page's meta belongs. */}
        <div className="mtgr__head-main">
          <div className="mtgr__head-title">
            {/* The editable control is the input; the page still needs a real
                heading, and an <input> is never one. */}
            <h1 className="sr-only">{meeting.title || "Untitled meeting"}</h1>
            <input
              type="text"
              className="mtgr__title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              placeholder="Untitled meeting"
              aria-label="Meeting title"
            />
            <Chip as="span">{typeLabel}</Chip>
            {isLive && <span className="mtgr__live"><span className="mtgr__live-dot" /> Live now</span>}
            {isPast && !isLive && <span className="mtgr__past">Ended</span>}
          </div>
          <div className="mtgr__head-meta">
            <span className="mtgr__head-when"><CalendarIcon /> {fmtDateTime(meeting.scheduledAt, datePrefs)}</span>
            <span className="mtgr__head-when"><Clock /> {formatLength(meeting.duration)}</span>
          </div>
        </div>
        <div className="mtgr__head-actions">
          {/* THE CALL SLOT HAS THREE STATES, and only three (spec-planner
              section 2 /meetings/[id]):
                before the window  a secondary "Start call": any attendee
                                   may start early, but a meeting three days
                                   out does not get the loudest button on
                                   the page
                in the window      the blue "Join call", from 15 minutes
                                   before the start until the end
                after the end      a ghost "Start call again", because a
                                   finished meeting never wears a live
                                   affordance and reopening the room should
                                   be a deliberate act
              The control is present in all three: nothing became
              unreachable, it changed weight. */}
          <button
            type="button"
            className={callWindow === "soon" || callWindow === "live" || callOpen
              ? "mtgr-btn mtgr-btn--primary"
              : "mtgr-btn mtgr-btn--ghost"}
            onClick={() => {
              if (callOpen) { setCallMinimized(false); return; } // already on it → re-expand the dock
              if (!meeting.call?.room) return;
              startGlobalCall({
                meetingId: id,
                subject: meeting.title,
                displayName: sessionName,
                audioOnly: false,
                href: `/meetings/${id}`,
              });
            }}
          >
            <Video /> {callOpen
              ? "In call"
              : callWindow === "ended"
                ? "Start call again"
                : callWindow === "before"
                  ? "Start call"
                  : "Join call"}
          </button>
          {meeting.call?.guestUrl ? (
            <button
              type="button"
              className="mtgr-btn mtgr-btn--ghost"
              title="Anyone with this link joins the call: external guests and AI notetaker bots included. No account needed."
              onClick={() => {
                void navigator.clipboard.writeText(meeting.call!.guestUrl);
                toast("Guest link copied. Anyone with it joins this call without an account.");
              }}
            >
              <Link2 /> Guest link
            </button>
          ) : null}
          {/* THE OVERFLOW. Four destinations the spec puts behind a "..." had
              no route at all on this page (Copy link, Duplicate, Start call
              again as a deliberate row, Add to my Google Calendar), while
              Delete sat as a third top-level button beside two others.
              Delete is full access only (the creator or an org admin): a
              control the role cannot use is not rendered, because an
              attendee who clicked it got a 403 and a meeting still there. */}
          <MeetingMenu
            meeting={meeting}
            onCopyLink={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/meetings/${id}`);
              toast("Link copied");
            }}
            onDuplicate={() => { void duplicateMeeting(); }}
            onStartCall={() => {
              if (callOpen) { setCallMinimized(false); return; }
              if (!meeting.call?.room) return;
              startGlobalCall({
                meetingId: id,
                subject: meeting.title,
                displayName: sessionName,
                audioOnly: false,
                href: `/meetings/${id}`,
              });
            }}
            onDelete={meeting.canDelete !== false ? () => setConfirmingDelete(true) : undefined}
          />
        </div>
      </header>

      {/* The meeting call renders in the shell-level CallDock (persists across
          navigation), not inline here. */}

      {/* Follow-up alert */}
      {prevIncomplete.length > 0 && (
        <div className="mtgr__followup">
          <AlertTriangle />
          <div>
            <strong>
              {prevIncomplete.length} unfinished action{prevIncomplete.length === 1 ? "" : "s"} from your last {typeLabel.toLowerCase()}
              {prevMeeting ? (
                <>
                  {" "}
                  <Link href={`/meetings/${prevMeeting.id}`} className="mtgr__followup-link">
                    Open {prevMeeting.title}
                  </Link>
                </>
              ) : null}
            </strong>
            <ul>
              {prevIncomplete.slice(0, 3).map((ai) => (
                <li key={ai.id}>
                  <span className="mtgr__followup-title">{ai.title}</span>
                  <em>{ai.assignee.firstName} {ai.assignee.lastName}</em>
                  {/* CARRY OVER, which the spec names and which had no
                      control: the item is copied onto THIS meeting with the
                      same owner, so the thing that did not get done is on
                      the agenda of the meeting that is about it. */}
                  {meeting.canEdit === false ? null : (
                    <button
                      type="button"
                      className="mtgr__followup-carry"
                      disabled={carrying !== null}
                      onClick={() => { void carryOver(ai); }}
                    >
                      {carrying === ai.id ? <Dots variant="pending" /> : "Carry over"}
                    </button>
                  )}
                </li>
              ))}
              {prevIncomplete.length > 3 && <li className="mtgr__followup-more">+{prevIncomplete.length - 3} more</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div className="mtgr__body">
        {/* Left: the details strip, then the notes */}
        <main className="mtgr__notes">
          {/* THE DETAILS STRIP. Every row here writes through
              PUT /api/meetings/[id]; until Phase 4 all four were display
              only. A viewer who cannot edit sees the values as plain text
              rather than as disabled controls (access spec 5.4). */}
          <section className="mtgr-strip">
            <div className="mtgr-strip__row">
              <span className="mtgr-strip__label">When</span>
              {meeting.canEdit === false ? (
                <span className="mtgr-strip__value">{fmtDateTime(meeting.scheduledAt, datePrefs)}</span>
              ) : (
                /* The field means the VIEWER'S zone, not the browser's.
                   The wall clock carries no zone, so an untranslated field
                   showed "3:30 PM" here while the header three lines above
                   showed "6:00 AM" for the same meeting
                   (src/lib/zoned-input.ts). And it is the product's own date
                   and time pickers, not the operating system's: a native
                   control ignores home.locale, which the rest of this page
                   honours (design-system section 5). */
                <DateTimeField
                  label="When"
                  value={zonedInputValue(meeting.scheduledAt, datePrefs.timezone)}
                  onChange={(next) => {
                    const iso = zonedInputToIso(next, datePrefs.timezone);
                    if (!iso) return;
                    void saveField({ scheduledAt: iso }, "time");
                  }}
                />
              )}
            </div>

            <div className="mtgr-strip__row">
              <span className="mtgr-strip__label">Length</span>
              {meeting.canEdit === false ? (
                <span className="mtgr-strip__value">{formatLength(meeting.duration)}</span>
              ) : (
                /* CUSTOM IS A TWO WAY DOOR HERE TOO. The create modal offers
                   Custom and this strip did not, so a 90 minute meeting wore
                   "90" as its own dead segment and any move off it to 15, 30,
                   45 or 60 could never be reversed to another custom value.
                   Same control, same "Custom" option, same minutes field. */
                <span className="mtgr-strip__control">
                  <SegmentedControl<string>
                    size="sm"
                    label="Length in minutes"
                    value={customLength !== null || !MEETING_LENGTHS.includes(meeting.duration as 15 | 30 | 45 | 60)
                      ? "custom"
                      : String(meeting.duration)}
                    onChange={(v) => {
                      if (v === "custom") { setCustomLength(String(meeting.duration)); return; }
                      setCustomLength(null);
                      void saveField({ duration: Number(v) }, "length");
                    }}
                    options={[
                      ...MEETING_LENGTHS.map((m) => ({ value: String(m), label: String(m) })),
                      { value: "custom", label: "Custom" },
                    ]}
                  />
                  {customLength !== null || !MEETING_LENGTHS.includes(meeting.duration as 15 | 30 | 45 | 60) ? (
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={customLength ?? String(meeting.duration)}
                      onChange={(e) => setCustomLength(e.target.value)}
                      onBlur={() => {
                        const n = Number(customLength);
                        setCustomLength(null);
                        if (Number.isFinite(n) && n > 0 && n <= 1440 && n !== meeting.duration) {
                          void saveField({ duration: Math.round(n) }, "length");
                        }
                      }}
                      aria-label="Length in minutes"
                      className="mtgr-strip__minutes"
                    />
                  ) : null}
                  <span className="mtgr-strip__hint">minutes</span>
                </span>
              )}
            </div>

            <div className="mtgr-strip__row">
              <span className="mtgr-strip__label">Type</span>
              {meeting.canEdit === false ? (
                <span className="mtgr-strip__value">{typeLabel}</span>
              ) : (
                <span className="mtgr-strip__control">
                  <button
                    type="button"
                    className="mtgr-strip__btn"
                    onClick={() => setTypeOpen((o) => !o)}
                  >
                    {typeLabel}
                  </button>
                  <Picker
                    open={typeOpen}
                    onClose={() => setTypeOpen(false)}
                    ariaLabel="Meeting type"
                    selected={meeting.type}
                    sections={[{ options: MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABELS[t] })) }]}
                    onSelect={(vv) => { setTypeOpen(false); void saveField({ type: vv as MeetingTypeWord }, "type"); }}
                  />
                </span>
              )}
            </div>

            <div className="mtgr-strip__row">
              <span className="mtgr-strip__label">People</span>
              <span className="mtgr-strip__control">
                <span className="mtgr-strip__faces">
                  {meeting.attendees.map((a) => (
                    <Avatar
                      key={a.id}
                      person={{ id: a.userId, firstName: a.user.firstName, lastName: a.user.lastName, avatar: a.user.avatar }}
                      size={24}
                    />
                  ))}
                </span>
                {meeting.canEdit === false ? null : (
                  <>
                    <button type="button" className="mtgr-strip__btn" onClick={() => setPeopleOpen((o) => !o)}>
                      Add or remove
                    </button>
                    <Picker
                      open={peopleOpen}
                      onClose={() => setPeopleOpen(false)}
                      multi
                      ariaLabel="Attendees"
                      searchPlaceholder="Search people"
                      selected={meeting.attendees.map((a) => a.userId)}
                      sections={[{ options: peopleOptions }]}
                      onSelect={(uid) => {
                        const current = meeting.attendees.map((a) => a.userId);
                        const next = current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid];
                        void saveField({ attendeeIds: next }, "people");
                      }}
                      emptyLabel="Nobody to add"
                    />
                  </>
                )}
              </span>
            </div>

            {meeting.call?.guestUrl ? (
              <div className="mtgr-strip__row">
                <span className="mtgr-strip__label">Room</span>
                <span className="mtgr-strip__value mtgr-strip__room">
                  <code>{meeting.call.guestUrl.replace(/^https?:\/\//, "")}</code>
                  <button
                    type="button"
                    className="mtgr-strip__btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(meeting.call!.guestUrl);
                      toast("Guest link copied. Anyone with it joins this call without an account.");
                    }}
                  >
                    Copy
                  </button>
                </span>
              </div>
            ) : null}

            {stripSaving ? <p className="mtgr-strip__saving"><Dots variant="pending" /> Saving</p> : null}
          </section>

          {/* A FAILED SAVE SAYS SO, AND STAYS SAID. The status line below
              used to read "All changes saved" over notes the server had
              refused; this banner is the honest state and does not fade. */}
          {saveError ? (
            <div className="mtgr__savefail" role="status">
              <AlertTriangle />
              <span>{saveError}</span>
              <button type="button" onClick={() => { setNotesDirty(true); setSaveError(null); }}>Retry</button>
            </div>
          ) : null}

          {/* THE NOTES TOOLS LIVE BEHIND A GHOST "...", which is what the
              spec asks for: three bordered buttons above the writing area
              competed with the writing area for attention, and two of the
              three are used once a meeting at most.

              THE PANEL IS HIDDEN, NOT UNMOUNTED. Voice record owns a live
              SpeechRecognition session; unmounting it to close a menu would
              stop a recording mid sentence. `hidden` keeps it mounted, and
              a live recording holds the panel open so its status is never
              somewhere the person cannot see it. */}
          <header className="mtgr__notes-head">
            <h2><FileText /> Notes</h2>
            <div className="mtgr__notes-status">
              {notesSaving ? <><Dots variant="pending" /> Saving</>
                : saveError ? <>Not saved</>
                : notesDirty ? <>Unsaved</>
                : <>All changes saved</>}
            </div>
            <button
              type="button"
              className="mtgr__tools-toggle"
              aria-label="Notes tools"
              aria-expanded={toolsOpen || recording}
              onClick={() => setToolsOpen((o) => !o)}
            >
              <MoreHorizontal />
            </button>
          </header>
          <div className="mtgr__tools" hidden={!toolsOpen && !recording}>
            <VoiceRecordButton
              onTranscript={(text) => { setNotes((prev) => prev + (prev ? "\n" : "") + text); setNotesDirty(true); }}
              onRecordingChange={setRecording}
            />
            {/* AI SUMMARY ONLY WHEN THE AI MODULE IS ENTITLED. It rendered
                unconditionally and was disabled only on empty notes, so an
                organization without the module saw the button and could
                press it (spec-planner section 2 /meetings/[id]). The shell's
                rail apps are the same read the "Ask AI" slot uses. */}
            {aiEntitled ? (
              <AISummaryButton notes={notes} onSummary={(summary) => { setNotes(summary); setNotesDirty(true); }} />
            ) : null}
            <PasteTranscriptButton onPaste={(text) => { setNotes((prev) => prev + (prev ? "\n\nPasted transcript\n" : "") + text); setNotesDirty(true); }} />
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
              {/* naming-canon section 2.4 retires "Attendees" for People. */}
              <h3><Users /> People</h3>
              <span className="mtgr-card__count">{meeting.attendees.length}</span>
            </header>
            <div className="mtgr-att-list">
              {meeting.attendees.length === 0 ? (
                <div className="mtgr-card__empty">No attendees added.</div>
              ) : meeting.attendees.map((a) => (
                <div key={a.id} className="mtgr-att-row">
                  <Avatar
                    person={{ id: a.userId, firstName: a.user.firstName, lastName: a.user.lastName, avatar: a.user.avatar }}
                    size={24}
                  />
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
                    {d.decidedBy || d.date ? (
                      <span>{[d.decidedBy, d.date ? fmtDate(d.date, datePrefs) : ""].filter(Boolean).join(" · ")}</span>
                    ) : null}
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
                        {item.deadline && <span>· due {fmtDate(item.deadline, datePrefs)}</span>}
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
            &ldquo;{meeting.title}&rdquo; moves to Trash with its notes, decisions and action items, and its guest link stops working straight away. You can restore it from Trash.
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
