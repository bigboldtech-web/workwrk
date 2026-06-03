"use client";

/* Brain — the right-dock AI panel.
 *
 * Distinct from the left-side agents shell: this panel is the system-
 * wide knowledge oracle. It answers questions about the workspace
 * (boards, items, KRAs, KPIs, SOPs, weekly reviews, team alignment)
 * via /api/sidekick/chat/stream, which runs Claude with tools wired to
 * the org's read-only data through resolveAccess.
 *
 * The panel hosts two views — chat + history — toggled from the top
 * bar. Sessions are persisted server-side (ChatSession + ChatMessage),
 * so reopening a chat from history re-renders the saved thread.
 *
 * Page context: usePathname() drives the productContext / boardContext
 * we pass on session creation, so the model already knows "the user is
 * on /spaces/marketing" without having to ask.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Edit3, Clock, ChevronDown, MoreHorizontal,
  ChevronsRight, ArrowUp, Plus, Globe, Search, Lightbulb,
  Wand2, ListChecks, Image as ImageIcon, CalendarDays, MessageCircle, HelpCircle,
  FileSearch, Globe2, Loader2, Wrench,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { OsMarkdown } from "./markdown";
import { BloomMark } from "./bloom-mark";

type View = "chat" | "history";

type SessionRow = {
  id: string;
  title: string | null;
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
};

type ToolEvent = { name: string; isError: boolean };

type Msg = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  toolEvents?: ToolEvent[];
  streaming?: boolean;
};

/** Map the current URL into the productContext / boardContext slugs the
 *  /api/sidekick chat API understands. Unknown segments pass through;
 *  buildContextPrefix on the server bails gracefully when the slug
 *  isn't in the catalog, so we don't have to whitelist here. */
function deriveContext(pathname: string): { productContext: string | null; boardContext: string | null } {
  if (!pathname || pathname === "/") return { productContext: null, boardContext: null };
  const parts = pathname.replace(/^\/+/, "").split("/");
  return { productContext: parts[0] ?? null, boardContext: parts[1] ?? null };
}

function groupByDate(rows: SessionRow[]): { label: string; rows: SessionRow[] }[] {
  const today: SessionRow[] = [];
  const yesterday: SessionRow[] = [];
  const older: SessionRow[] = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  for (const r of rows) {
    const t = new Date(r.updatedAt).getTime();
    if (t >= startOfToday) today.push(r);
    else if (t >= startOfYesterday) yesterday.push(r);
    else older.push(r);
  }
  const out: { label: string; rows: SessionRow[] }[] = [];
  if (today.length) out.push({ label: "Today", rows: today });
  if (yesterday.length) out.push({ label: "Yesterday", rows: yesterday });
  if (older.length) out.push({ label: "Older", rows: older });
  return out;
}

const SUGGESTED = [
  { icon: ListChecks,  label: "What's on my plate this week?" },
  { icon: Lightbulb,   label: "Summarize my team's progress" },
  { icon: HelpCircle,  label: "Who is at risk on KPI compliance?" },
];

const FEATURED: Array<{ icon: typeof Wand2; label: string; tag?: string }> = [
  { icon: Wand2,         label: "Create a board",        tag: "New" },
  { icon: ImageIcon,     label: "Generate an image",     tag: "New" },
  { icon: CalendarDays,  label: "Today's calendar",      tag: "New" },
  { icon: MessageCircle, label: "Ask about my notes",    tag: "New" },
  { icon: HelpCircle,    label: "Help using WorkwrK" },
];

const SEARCH: Array<{ icon: typeof Search; label: string; tag?: string }> = [
  { icon: FileSearch, label: "Deep search",       tag: "New" },
  { icon: Search,     label: "Search WorkwrK" },
  { icon: Globe2,     label: "Search the web" },
];

export function OsSidekickPanel() {
  const { sidekickOpen, closeSidekick, consumeSidekickInitialPrompt } = useOsShell();
  const pathname = usePathname() ?? "/";

  const [view, setView] = useState<View>("chat");
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const sessionsLoadedRef = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sidekick/sessions", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.sessions)) setSessions(data.sessions);
    } catch {}
  }, []);

  useEffect(() => {
    if (sidekickOpen && !sessionsLoadedRef.current) {
      sessionsLoadedRef.current = true;
      void loadSessions();
    }
  }, [sidekickOpen, loadSessions]);

  // Consume an initial prompt handed off from the palette's Ask AI pill
  // (or any other caller of openSidekick(prompt)).
  useEffect(() => {
    if (!sidekickOpen) return;
    const seed = consumeSidekickInitialPrompt();
    if (seed) {
      setInput(seed);
      setView("chat");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [sidekickOpen, consumeSidekickInitialPrompt]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setView("chat");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const openSession = useCallback(async (id: string) => {
    setCurrentSessionId(id);
    setView("chat");
    setMessages([]);
    setError(null);
    try {
      const res = await fetch(`/api/sidekick/sessions/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.messages)) {
        const msgs: Msg[] = data.messages
          .filter((m: { role: string }) => m.role === "USER" || m.role === "ASSISTANT")
          .map((m: { id: string; role: "USER" | "ASSISTANT"; content: string; toolCalls?: { name: string }[] }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolEvents: m.toolCalls?.map((t) => ({ name: t.name, isError: false })),
          }));
        setMessages(msgs);
      }
    } catch {}
  }, []);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    let sid = currentSessionId;
    if (!sid) {
      const { productContext, boardContext } = deriveContext(pathname);
      try {
        const res = await fetch("/api/sidekick/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productContext, boardContext }),
        });
        if (!res.ok) throw new Error("Could not start a new chat session.");
        const data = await res.json();
        sid = data.session.id as string;
        setCurrentSessionId(sid);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start session");
        setBusy(false);
        return;
      }
    }

    const tempUserId = `u-${Date.now()}`;
    const tempAiId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: "USER", content: message },
      { id: tempAiId, role: "ASSISTANT", content: "", streaming: true, toolEvents: [] },
    ]);

    try {
      const res = await fetch("/api/sidekick/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sid, message }),
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "text_delta") {
              setMessages((prev) =>
                prev.map((m) => (m.id === tempAiId ? { ...m, content: m.content + evt.text } : m)),
              );
            } else if (evt.type === "tool_use") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAiId
                    ? { ...m, toolEvents: [...(m.toolEvents ?? []), { name: evt.name, isError: false }] }
                    : m,
                ),
              );
            } else if (evt.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== tempAiId) return m;
                  const events = [...(m.toolEvents ?? [])];
                  // Mark the most-recent pending chip for this tool as resolved.
                  for (let i = events.length - 1; i >= 0; i--) {
                    if (events[i].name === evt.name) {
                      events[i] = { name: evt.name, isError: !!evt.isError };
                      break;
                    }
                  }
                  return { ...m, toolEvents: events };
                }),
              );
            } else if (evt.type === "error") {
              setError(evt.message ?? "An error occurred");
            } else if (evt.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAiId
                    ? {
                        ...m,
                        id: evt.message?.id ?? m.id,
                        content: evt.message?.content ?? m.content,
                        streaming: false,
                      }
                    : m,
                ),
              );
            }
          } catch {
            /* malformed SSE line — skip */
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream failed");
      setMessages((prev) =>
        prev.map((m) => (m.id === tempAiId ? { ...m, streaming: false } : m)),
      );
    } finally {
      setBusy(false);
      void loadSessions();
    }
  }, [busy, currentSessionId, input, pathname, loadSessions]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const filteredSessions = useMemo(() => {
    if (!sessions) return null;
    const q = historySearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q));
  }, [sessions, historySearch]);

  const grouped = useMemo(
    () => (filteredSessions ? groupByDate(filteredSessions) : null),
    [filteredSessions],
  );

  return (
    <aside
      className={`os-sk ${sidekickOpen ? "is-open" : ""}`}
      aria-hidden={!sidekickOpen}
      aria-label="Brain — AI knowledge assistant"
    >
      <div className="os-sk__inner">
        <div className="os-sk__topbar">
          <button type="button" className="os-sk__iconbtn" onClick={newChat} title="New chat" aria-label="New chat">
            <Edit3 />
          </button>
          <button
            type="button"
            className={`os-sk__iconbtn ${view === "history" ? "is-on" : ""}`}
            onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
            title="Chat history"
            aria-label="Chat history"
          >
            <Clock />
          </button>
          <div className="os-sk__topbar-spacer" />
          {view === "chat" ? (
            <button type="button" className="os-sk__model-pill" title="Change model">
              <BloomMark size={14} />
              <span>Max</span>
              <ChevronDown />
            </button>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--os-ink)" }}>All chats</div>
          )}
          <div className="os-sk__topbar-spacer" />
          <button type="button" className="os-sk__iconbtn" title="More" aria-label="More">
            <MoreHorizontal />
          </button>
          <button
            type="button"
            className="os-sk__iconbtn"
            onClick={closeSidekick}
            title="Collapse"
            aria-label="Collapse Brain panel"
          >
            <ChevronsRight />
          </button>
        </div>

        {view === "history" ? (
          <>
            <div className="os-sk__hist-search">
              <Search />
              <input
                type="text"
                placeholder="Search conversations"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
            <div className="os-sk__hist-list">
              {grouped === null ? (
                <div className="os-sk__hist-empty">Loading…</div>
              ) : grouped.length === 0 ? (
                <div className="os-sk__hist-empty">
                  {historySearch ? "No chats match that search." : "No chats yet. Start one below."}
                </div>
              ) : (
                grouped.map((g) => (
                  <div key={g.label}>
                    <div className="os-sk__hist-group-title">{g.label}</div>
                    {g.rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className="os-sk__hist-item"
                        onClick={() => openSession(row.id)}
                      >
                        <MessageCircle style={{ width: 13, height: 13, color: "var(--os-ink-3)", flexShrink: 0 }} />
                        <span className="os-sk__hist-item-title">{row.title ?? "Untitled chat"}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        ) : messages.length === 0 ? (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="os-sk__greet">
              <div className="os-sk__greet-row">
                <span className="os-sk__greet-avatar">
                  <BloomMark size={26} animated />
                </span>
                <div>
                  <div className="os-sk__greet-eyebrow">Brain</div>
                  <div className="os-sk__greet-title">What can I help with?</div>
                </div>
              </div>
              <div className="os-sk__greet-body">
                I know your boards, items, KRAs, KPIs, SOPs, weekly reviews, and team alignment. Ask me anything about what&apos;s happening in your workspace.
              </div>
            </div>
            <div className="os-sk__sec">
              <div className="os-sk__sec-title">Suggested</div>
              {SUGGESTED.map((s) => (
                <button key={s.label} type="button" className="os-sk__sec-row" onClick={() => setInput(s.label)}>
                  <span className="os-sk__sec-icon"><s.icon /></span>
                  <span className="os-sk__sec-row-label">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="os-sk__sec">
              <div className="os-sk__sec-title">Featured</div>
              {FEATURED.map((s) => (
                <button key={s.label} type="button" className="os-sk__sec-row" onClick={() => setInput(s.label)}>
                  <span className="os-sk__sec-icon"><s.icon /></span>
                  <span className="os-sk__sec-row-label">{s.label}</span>
                  {s.tag ? (
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "var(--os-brand-soft)", color: "var(--os-brand-deep)", fontWeight: 700 }}>
                      {s.tag}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="os-sk__sec">
              <div className="os-sk__sec-title">Search</div>
              {SEARCH.map((s) => (
                <button key={s.label} type="button" className="os-sk__sec-row" onClick={() => setInput(s.label)}>
                  <span className="os-sk__sec-icon"><s.icon /></span>
                  <span className="os-sk__sec-row-label">{s.label}</span>
                  {s.tag ? (
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "var(--os-brand-soft)", color: "var(--os-brand-deep)", fontWeight: 700 }}>
                      {s.tag}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="os-sk__thread" ref={threadRef}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: "contents" }}>
                {m.role === "USER" ? (
                  <div className="os-sk__bubble os-sk__bubble--user">{m.content}</div>
                ) : (
                  <>
                    {(m.toolEvents ?? []).map((t, i) => (
                      <span
                        key={`${m.id}-t${i}`}
                        className={`os-sk__tool-chip ${t.isError ? "os-sk__tool-chip--err" : ""}`}
                        title={t.name}
                      >
                        <Wrench /> Ran <code style={{ fontSize: 11 }}>{t.name}</code>
                      </span>
                    ))}
                    {m.content ? (
                      <div className="os-sk__bubble os-sk__bubble--ai">
                        <OsMarkdown text={m.content} />
                      </div>
                    ) : m.streaming ? (
                      <span className="os-sk__typing">
                        <span className="os-sk__typing-dot" />
                        <span className="os-sk__typing-dot" />
                        <span className="os-sk__typing-dot" />
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ))}
            {error ? (
              <div className="os-sk__bubble os-sk__bubble--ai" style={{ color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                {error}
              </div>
            ) : null}
          </div>
        )}

        <div className="os-sk__composer">
          <div className="os-sk__composer-shell">
            <textarea
              ref={inputRef}
              className="os-sk__composer-input"
              placeholder={messages.length === 0 ? "Ask, create, search, @ to mention" : "Tell Brain what to do next"}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 160) + "px";
              }}
              onKeyDown={onKeyDown}
              rows={1}
            />
            <div className="os-sk__composer-foot">
              <button type="button" className="os-sk__composer-side" title="Attach">
                <Plus />
              </button>
              <span className="os-sk__composer-sources">
                <Globe />
                All sources
                <ChevronDown style={{ width: 11, height: 11 }} />
              </span>
              <button
                type="button"
                className="os-sk__composer-send"
                onClick={() => void send()}
                disabled={busy || input.trim().length === 0}
                title="Send (Enter)"
              >
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
