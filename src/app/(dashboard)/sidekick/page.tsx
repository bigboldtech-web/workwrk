"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, Plus, Search, Trash2, Paperclip, ArrowUp,
  Wrench, Pin, MessageSquare,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { OsMarkdown } from "@/components/layout/os/markdown";
import { useOsToast } from "@/components/layout/os/toast";

type Session = {
  id: string;
  title: string | null;
  pinned: boolean;
  lastModel: string | null;
  updatedAt: string;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  modelUsed?: string | null;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }> | null;
  createdAt: string;
};

const STARTERS = [
  { tag: "PIPELINE", text: "What deals are stalled more than 14 days?" },
  { tag: "DRAFT",    text: "Draft a follow-up email to Acme Corp about renewal." },
  { tag: "PLAN",     text: "Plan my week — pick the 3 things that matter most." },
  { tag: "ANALYZE",  text: "Summarize last week's wins, losses, and risks." },
];

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDay(sessions: Session[]) {
  const today: Session[] = [];
  const week: Session[] = [];
  const older: Session[] = [];
  const now = Date.now();
  for (const s of sessions) {
    const age = now - new Date(s.updatedAt).getTime();
    if (age < 24 * 60 * 60 * 1000) today.push(s);
    else if (age < 7 * 24 * 60 * 60 * 1000) week.push(s);
    else older.push(s);
  }
  return { today, week, older };
}

export default function SidekickPage() {
  const { toast } = useOsToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [search, setSearch] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const filtered = sessions.filter(
    (s) => !search || (s.title ?? "Untitled").toLowerCase().includes(search.toLowerCase()),
  );
  const grouped = groupByDay(filtered);

  // ── Effects ────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sidekick/sessions");
      const data = await res.json();
      if (Array.isArray(data.sessions)) setSessions(data.sessions);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    setLoadingMsgs(true);
    fetch(`/api/sidekick/sessions/${activeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .finally(() => setLoadingMsgs(false));
  }, [activeId]);

  // auto-scroll to bottom on new messages
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, sending]);

  // ── Actions ────────────────────────────────────────────
  async function newChat() {
    try {
      const res = await fetch("/api/sidekick/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.session?.id) {
        await loadSessions();
        setActiveId(data.session.id);
        setMessages([]);
        setTimeout(() => inputRef.current?.focus(), 60);
      } else {
        toast("Couldn't start a new chat");
      }
    } catch {
      toast("Couldn't start a new chat");
    }
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    await fetch(`/api/sidekick/sessions/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await loadSessions();
    toast("Chat archived");
  }

  async function send(text: string) {
    if (!text.trim() || sending) return;
    let sessionId = activeId;

    // start a fresh session if none active
    if (!sessionId) {
      try {
        const res = await fetch("/api/sidekick/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        sessionId = data.session?.id;
        if (!sessionId) { toast("Couldn't start a chat"); return; }
        setActiveId(sessionId);
      } catch {
        toast("Couldn't start a chat"); return;
      }
    }

    // optimistically append user msg + an empty assistant msg we'll fill
    // as deltas arrive
    const userOptimisticId = `opt-user-${Date.now()}`;
    const assistantStreamId = `streaming-${Date.now()}`;
    const userOptimistic: Message = {
      id: userOptimisticId,
      role: "USER",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const assistantStreaming: Message = {
      id: assistantStreamId,
      role: "ASSISTANT",
      content: "",
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, userOptimistic, assistantStreaming]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/sidekick/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      if (!res.ok || !res.body) {
        toast(`Stream failed (${res.status})`);
        setMessages((ms) => ms.filter((m) => m.id !== userOptimisticId && m.id !== assistantStreamId));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumText = "";
      const accumToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: events are separated by blank lines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === "user_message") {
            const msg = event.message as Message;
            setMessages((ms) => ms.map((m) => m.id === userOptimisticId ? msg : m));
          } else if (event.type === "text_delta") {
            accumText += event.text as string;
            setMessages((ms) => ms.map((m) =>
              m.id === assistantStreamId ? { ...m, content: accumText } : m
            ));
          } else if (event.type === "tool_use") {
            accumToolCalls.push({ name: event.name as string, input: (event.input as Record<string, unknown>) ?? {} });
            setMessages((ms) => ms.map((m) =>
              m.id === assistantStreamId ? { ...m, toolCalls: [...accumToolCalls] } : m
            ));
          } else if (event.type === "tool_result") {
            // visual ping — nothing to update yet, the next text_delta will follow
          } else if (event.type === "done") {
            const finalMsg = event.message as Message;
            setMessages((ms) => ms.map((m) => m.id === assistantStreamId ? finalMsg : m));
            void loadSessions();
          } else if (event.type === "error") {
            toast((event.message as string) ?? "Stream error");
          }
        }
      }
    } catch {
      toast("Couldn't reach the server");
      setMessages((ms) => ms.filter((m) => m.id !== userOptimisticId && m.id !== assistantStreamId));
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  // ── Render ─────────────────────────────────────────────
  const active = sessions.find((s) => s.id === activeId);

  return (
    <>
      <OsTitleBar
        title="Sidekick"
        Icon={Sparkles}
        iconGradient={GRAD.pinkPurple}
        description={active?.title ? `Chat · ${active.title}` : "Your AI working partner · ⌘J to toggle the side panel"}
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={2}
        showActions={false}
      />

      <div className="os-chat">
        {/* ── Left: session list ── */}
        <aside className="os-chat__rail">
          <div className="os-chat__rail-head">
            <button type="button" className="os-chat__new" onClick={newChat}>
              <Plus />
              New chat
            </button>
            <div className="os-chat__search">
              <Search />
              <input
                placeholder="Search chats…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="os-chat__list">
            {sessions.length === 0 ? (
              <div style={{ padding: "32px 14px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 12.5, lineHeight: 1.5 }}>
                No chats yet.<br />Start one with the button above or any starter on the right.
              </div>
            ) : null}

            {grouped.today.length > 0 ? (
              <>
                <div className="os-chat__group-title">Today</div>
                {grouped.today.map((s) => (
                  <SessionRow key={s.id} s={s} active={s.id === activeId} onSelect={() => setActiveId(s.id)} onDelete={(e) => deleteSession(s.id, e)} />
                ))}
              </>
            ) : null}
            {grouped.week.length > 0 ? (
              <>
                <div className="os-chat__group-title">This week</div>
                {grouped.week.map((s) => (
                  <SessionRow key={s.id} s={s} active={s.id === activeId} onSelect={() => setActiveId(s.id)} onDelete={(e) => deleteSession(s.id, e)} />
                ))}
              </>
            ) : null}
            {grouped.older.length > 0 ? (
              <>
                <div className="os-chat__group-title">Older</div>
                {grouped.older.map((s) => (
                  <SessionRow key={s.id} s={s} active={s.id === activeId} onSelect={() => setActiveId(s.id)} onDelete={(e) => deleteSession(s.id, e)} />
                ))}
              </>
            ) : null}
          </div>
        </aside>

        {/* ── Right: thread + composer ── */}
        <div className="os-chat__main">
          <div className="os-chat__thread" ref={threadRef}>
            <div className="os-chat__thread-wrap">
              {!activeId || (messages.length === 0 && !loadingMsgs) ? (
                <div className="os-chat__welcome">
                  <div className="os-chat__welcome-logo">
                    <Sparkles />
                  </div>
                  <h2>Good morning, BigBold.</h2>
                  <p>
                    Sidekick can answer questions about your boards, draft work,
                    schedule things, and act on your behalf when you let it.
                  </p>
                  <div className="os-chat__starters">
                    {STARTERS.map((s) => (
                      <button
                        key={s.text}
                        type="button"
                        className="os-chat__starter"
                        onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                      >
                        <span className="os-chat__starter-tag">{s.tag}</span>
                        <span className="os-chat__starter-text">{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : loadingMsgs ? (
                <div style={{ padding: "60px 0", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>
                  Loading messages…
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageRow key={m.id} m={m} streaming={sending && m.id.startsWith("streaming-")} />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="os-chat__composer-wrap">
            <div className="os-chat__composer-inner">
              <div className="os-chat__composer">
                <button type="button" className="os-chat__composer-attach" aria-label="Attach">
                  <Paperclip />
                </button>
                <textarea
                  ref={inputRef}
                  className="os-chat__composer-input"
                  placeholder={activeId ? "Reply to Sidekick…" : "Ask Sidekick anything…"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                />
                <button
                  type="button"
                  className="os-chat__composer-send"
                  onClick={() => void send(input)}
                  disabled={!input.trim() || sending}
                  aria-label="Send"
                >
                  <ArrowUp />
                </button>
              </div>
              <div className="os-chat__composer-foot">
                <span><kbd>⏎</kbd> send</span>
                <span><kbd>⇧⏎</kbd> newline</span>
                <span><kbd>⌘J</kbd> toggle side panel</span>
                <span className="os-chat__composer-model">
                  <span className="os-chat__composer-model-dot" />
                  Sonnet 4.6
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SessionRow({
  s, active, onSelect, onDelete,
}: {
  s: Session; active: boolean; onSelect: () => void; onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button type="button" className={`os-chat__item ${active ? "is-active" : ""}`} onClick={onSelect}>
      <span className="os-chat__item-title">{s.title ?? "Untitled chat"}</span>
      <span className="os-chat__item-meta">
        <MessageSquare style={{ width: 11, height: 11 }} />
        {fmtRelative(s.updatedAt)}
        {s.lastModel ? <span style={{ color: "var(--os-ink-4)" }}>· {s.lastModel.replace("claude-", "").replace(/-4-6$/, " 4.6").replace(/-4-7$/, " 4.7")}</span> : null}
      </span>
      {s.pinned ? <span className="os-chat__item-pin"><Pin /></span> : (
        <button type="button" className="os-chat__item-del" onClick={onDelete} aria-label="Archive">
          <Trash2 />
        </button>
      )}
    </button>
  );
}

function MessageRow({ m, streaming = false }: { m: Message; streaming?: boolean }) {
  const isUser = m.role === "USER";
  const showTyping = streaming && !m.content && (!m.toolCalls || m.toolCalls.length === 0);
  return (
    <div className="os-msg">
      <div
        className={`os-msg__av ${isUser ? "" : "os-msg__av--ai"}`}
        style={isUser ? { background: "var(--os-c-purple)" } : undefined}
      >
        {isUser ? "BB" : <Sparkles />}
      </div>
      <div className="os-msg__body">
        <div className="os-msg__head">
          <span className="os-msg__author">{isUser ? "You" : "Sidekick"}</span>
          {streaming ? null : <span className="os-msg__time">{fmtRelative(m.createdAt)}</span>}
        </div>
        {m.toolCalls && m.toolCalls.length > 0 ? (
          <div>
            {m.toolCalls.map((tc, i) => (
              <div key={i} className="os-msg__tool">
                <div className="os-msg__tool-name">
                  <Wrench />
                  Ran tool: <code>{tc.name}</code>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {showTyping ? (
          <div className="os-chat__typing">
            <span /><span /><span />
          </div>
        ) : (
          <div className="os-msg__text">
            <OsMarkdown text={m.content} />
          </div>
        )}
      </div>
    </div>
  );
}
