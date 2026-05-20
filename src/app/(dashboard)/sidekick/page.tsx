"use client";

// WorkwrK Sidekick — Phase D1 real runtime.
//
// Two-column chat surface modeled on monday.com Sidekick. Left rail =
// list of sessions (pin + delete); main = chat thread with input at
// bottom. Sends to /api/sidekick/chat which calls Claude via the org's
// AI client (BYOK if Enterprise).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Plus,
  ArrowUp,
  Pin,
  PinOff,
  X,
  Loader2,
  Wand2,
  FileText,
  Search,
  BarChart3,
  Lightbulb,
  Image as ImageIcon,
  BookOpen,
} from "lucide-react";

type SessionRow = {
  id: string;
  title: string | null;
  pinned: boolean;
  lastModel: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  modelUsed?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  finishReason?: string | null;
  createdAt: string;
};

const STARTERS = [
  { label: "Create a board", icon: Wand2, prompt: "Help me design a board for tracking ", hue: "violet" },
  { label: "Write a doc", icon: FileText, prompt: "Draft a doc about ", hue: "teal" },
  { label: "Research", icon: Search, prompt: "Research this for me: ", hue: "amber" },
  { label: "Analyze", icon: BarChart3, prompt: "Help me analyze ", hue: "rose" },
  { label: "Brainstorm", icon: Lightbulb, prompt: "Brainstorm ideas for ", hue: "amber" },
  { label: "Generate image", icon: ImageIcon, prompt: "Generate an image of ", hue: "green" },
  { label: "Build app", icon: Sparkles, prompt: "Build a Vibe app that ", hue: "pink" },
  { label: "Learn about", icon: BookOpen, prompt: "Teach me about ", hue: "sky" },
] as const;

export default function SidekickPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sidekick/sessions");
    if (!res.ok) return;
    const data = await res.json();
    setSessions(data.sessions ?? []);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function openSession(id: string) {
    setActiveId(id);
    setLoadingSession(true);
    try {
      const res = await fetch(`/api/sidekick/sessions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } finally {
      setLoadingSession(false);
    }
  }

  async function startNew() {
    const res = await fetch("/api/sidekick/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const data = await res.json();
    setActiveId(data.session.id);
    setMessages([]);
    await loadSessions();
  }

  async function send() {
    if (!input.trim() || sending) return;
    const message = input.trim();
    setInput("");

    let sessionId = activeId;
    if (!sessionId) {
      const r = await fetch("/api/sidekick/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!r.ok) { setInput(message); return; }
      const data = await r.json();
      sessionId = data.session.id as string;
      setActiveId(sessionId);
    }

    // Optimistic user message
    const optimistic: Message = {
      id: "tmp-" + Date.now(),
      role: "USER",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    try {
      const res = await fetch("/api/sidekick/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), { ...optimistic, content: message + "\n\n⚠️ " + (data.error ?? "send failed") }]);
        return;
      }
      // Replace optimistic + append assistant response
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        data.userMessage,
        data.assistantMessage,
      ]);
      // Refresh session list so title + recency updates
      await loadSessions();
    } catch (err) {
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), { ...optimistic, content: message + "\n\n⚠️ network error" }]);
    } finally {
      setSending(false);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    await fetch(`/api/sidekick/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !pinned }) });
    await loadSessions();
  }

  async function deleteSession(id: string) {
    await fetch(`/api/sidekick/sessions/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await loadSessions();
  }

  function applyStarter(prompt: string) {
    setInput(prompt);
    // Focus the textarea
    requestAnimationFrame(() => {
      const ta = document.getElementById("sidekick-input") as HTMLTextAreaElement | null;
      if (ta) { ta.focus(); ta.setSelectionRange(prompt.length, prompt.length); }
    });
  }

  const pinned = sessions.filter((s) => s.pinned);
  const recent = sessions.filter((s) => !s.pinned);

  return (
    <div className="flex h-[calc(100vh-var(--app-topbar-height,56px))]">
      {/* Sessions rail */}
      <aside className="w-[260px] flex-shrink-0 border-r border-border bg-surface-2 flex flex-col">
        <div className="p-3 border-b border-border">
          <button
            type="button"
            onClick={startNew}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 text-sm font-medium hover:bg-violet-100"
          >
            <Plus size={14} /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {pinned.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-muted-2 font-semibold inline-flex items-center gap-1">
                <Pin size={9} /> Pinned
              </div>
              {pinned.map((s) => (
                <SessionItem key={s.id} session={s} active={activeId === s.id} onOpen={() => openSession(s.id)} onTogglePin={() => togglePin(s.id, s.pinned)} onDelete={() => deleteSession(s.id)} />
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-muted-2 font-semibold">Recent</div>
              {recent.map((s) => (
                <SessionItem key={s.id} session={s} active={activeId === s.id} onOpen={() => openSession(s.id)} onTogglePin={() => togglePin(s.id, s.pinned)} onDelete={() => deleteSession(s.id)} />
              ))}
            </div>
          )}
          {sessions.length === 0 && (
            <div className="text-center text-xs text-muted-2 py-6 px-3">
              Your chats will appear here
            </div>
          )}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeId && messages.length === 0 ? (
          // Empty state — starter pills + welcome
          <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto px-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-6">
              <Sparkles size={12} />
              WorkwrK Sidekick
            </div>
            <h1 className="text-3xl font-semibold mb-2">What would you like to work on?</h1>
            <p className="text-sm text-muted mb-8 max-w-xl">
              Transform a challenge into a practical, ready-to-use solution. Powered by Claude.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl mb-8">
              {STARTERS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => applyStarter(s.prompt)}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-violet-300 transition-colors"
                  >
                    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full bg-${s.hue}-100 text-${s.hue}-600`}>
                      <Icon size={16} />
                    </span>
                    <span className="text-xs">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div ref={threadRef} className="flex-1 overflow-y-auto px-6 py-4">
            <div className="max-w-3xl mx-auto space-y-6">
              {loadingSession ? (
                <div className="text-center text-sm text-muted py-10">Loading session…</div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
              {sending && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={14} />
                  </div>
                  <div className="flex-1 pt-1 text-sm text-muted inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Thinking…
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border bg-surface p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl border-2 border-violet-200 dark:border-violet-800 bg-surface focus-within:border-violet-400 transition-colors">
              <textarea
                id="sidekick-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask Sidekick anything…"
                rows={3}
                disabled={sending}
                className="w-full px-4 py-3 text-sm bg-transparent focus:outline-none resize-none rounded-2xl"
              />
              <div className="flex items-center justify-between px-3 pb-2">
                <span className="text-[11px] text-muted-2">
                  Enter to send · Shift+Enter for newline
                </span>
                <button
                  type="button"
                  onClick={send}
                  disabled={!input.trim() || sending}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Send"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionItem({
  session,
  active,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  session: SessionRow;
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        "group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer mb-0.5 " +
        (active ? "bg-violet-100 dark:bg-violet-950/40" : "hover:bg-surface")
      }
      onClick={onOpen}
    >
      <span className="flex-1 text-sm truncate">
        {session.title || "Untitled chat"}
      </span>
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 p-1 text-muted-2 hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
        aria-label={session.pinned ? "Unpin" : "Pin"}
      >
        {session.pinned ? <PinOff size={11} /> : <Pin size={11} />}
      </button>
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 p-1 text-muted-2 hover:text-rose-600"
        onClick={(e) => { e.stopPropagation(); if (confirm("Archive this chat?")) onDelete(); }}
        aria-label="Archive"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-violet-600 text-white text-sm">
          {renderContent(message.content)}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex items-center justify-center flex-shrink-0">
        <Sparkles size={14} />
      </div>
      <div className="flex-1 pt-1 text-sm whitespace-pre-wrap">
        {renderContent(message.content)}
        {(message.tokensIn || message.tokensOut) && (
          <div className="mt-2 text-[10px] text-muted-2">
            {message.modelUsed} · {message.tokensIn} in + {message.tokensOut} out tokens
          </div>
        )}
      </div>
    </div>
  );
}

// Very lightweight rendering: split paragraphs, preserve newlines. Real
// markdown rendering can come in a follow-up via react-markdown.
function renderContent(text: string) {
  return text.split(/\n\n+/).map((para, i) => (
    <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>
  ));
}
