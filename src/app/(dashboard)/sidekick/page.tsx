"use client";

// WorkwrK Sidekick — Phase D1 real runtime.
//
// Two-column chat surface modeled on monday.com Sidekick. Left rail =
// list of sessions (pin + delete); main = chat thread with input at
// bottom. Sends to /api/sidekick/chat which calls Claude via the org's
// AI client (BYOK if Enterprise).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRODUCT_CATALOG } from "@/lib/products/catalog";
import { getBoard } from "@/lib/products/boards";
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
  Wrench,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
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

/** Active session's board-level context — set when the session was
 *  opened from inside an app surface (/crm/pipeline → Sidekick link).
 *  Rendered as a chip above the chat so the user can see what scope
 *  the model is in. */
type ActiveContext = {
  productSlug: string;
  productName: string;
  boardKey: string | null;
  boardName: string | null;
} | null;

type ToolCall = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  errorText: string | null;
  durationMs: number;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  modelUsed?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  finishReason?: string | null;
  toolCalls?: ToolCall[] | null;
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
  const searchParams = useSearchParams();
  const initialSessionId = searchParams.get("session");
  // Board-context params from the launch URL — set by BoardShell and
  // AppWorkspaceNav when the user clicks Sidekick from inside an app.
  const initialProductContext = searchParams.get("context");
  const initialBoardContext = searchParams.get("board");

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialSessionId);
  const [activeContext, setActiveContext] = useState<ActiveContext>(null);
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

  /** Resolve product + board slugs into display labels (or null if
   *  the catalog/registry doesn't know them — shouldn't happen for
   *  links we generate, but be defensive against typo'd ?context=).
   *  Studio context is special: productContext = "studio" and
   *  boardContext = the StudioBoard slug; we fetch the board name on
   *  demand so the chip still reads cleanly. */
  const resolveContext = useCallback(
    async (productSlug: string | null, boardKey: string | null): Promise<ActiveContext> => {
      if (!productSlug) return null;

      if (productSlug === "studio") {
        let boardName: string | null = null;
        if (boardKey) {
          try {
            const r = await fetch(`/api/studio/boards/${boardKey}`);
            if (r.ok) {
              const d = await r.json();
              boardName = d.board?.name ?? null;
            }
          } catch {
            // Fall through with no board name; chip still renders generic.
          }
        }
        return {
          productSlug,
          productName: "Studio",
          boardKey: boardKey ?? null,
          boardName,
        };
      }

      const product = PRODUCT_CATALOG.find((p) => p.slug === productSlug);
      if (!product) return null;
      const board = boardKey ? getBoard(productSlug, boardKey) : null;
      return {
        productSlug,
        productName: product.name.replace(/^WorkwrK\s+/, ""),
        boardKey: boardKey ?? null,
        boardName: board?.name ?? null,
      };
    },
    [],
  );

  // If a ?session=<id> arrived via the URL (e.g. from /agents → Chat
  // with <agent>), auto-load that session's messages on mount. If a
  // ?context=<slug> arrived without a session, resolve it async (the
  // studio path needs a fetch to get the board name) and surface the
  // chip so the user knows the scope before sending anything.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialSessionId) openSession(initialSessionId);
    else if (initialProductContext) {
      void resolveContext(initialProductContext, initialBoardContext).then(
        (ctx) => setActiveContext(ctx),
      );
    }
  }, []);

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
      // Re-apply the session's stored board context so the chip
      // follows the session, not the launch URL.
      const ctx = await resolveContext(
        data.session?.productContext ?? null,
        data.session?.boardContext ?? null,
      );
      setActiveContext(ctx);
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
    setActiveContext(null);
    await loadSessions();
  }

  async function send() {
    if (!input.trim() || sending) return;
    const message = input.trim();
    setInput("");

    let sessionId = activeId;
    if (!sessionId) {
      // First message in a brand-new session — carry forward the
      // launch URL's product+board context (if any) so the new
      // session is properly scoped on the server.
      const r = await fetch("/api/sidekick/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          initialProductContext
            ? {
                productContext: initialProductContext,
                boardContext: initialBoardContext ?? undefined,
              }
            : {},
        ),
      });
      if (!r.ok) { setInput(message); return; }
      const data = await r.json();
      sessionId = data.session.id as string;
      setActiveId(sessionId);
      // Keep the chip in sync with what the server actually stored.
      if (data.session.productContext) {
        const ctx = await resolveContext(
          data.session.productContext,
          data.session.boardContext ?? null,
        );
        setActiveContext(ctx);
      }
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
        {/* Context chip — visible whenever the session is scoped to a
            product/board. Tells the user the AI already knows which
            surface they're on so they don't have to repeat it. */}
        {activeContext && (
          <div className="border-b border-border bg-violet-50/40 dark:bg-violet-950/20 px-6 py-2 flex items-center gap-2 text-xs">
            <Sparkles size={12} className="text-violet-600" />
            <span className="text-muted-2">Scoped to</span>
            <span className="font-medium text-foreground">
              {activeContext.productName}
              {activeContext.boardName ? ` · ${activeContext.boardName}` : ""}
            </span>
            <span className="ml-auto text-[10px] text-muted-2">
              Tools + context narrowed to this surface
            </span>
          </div>
        )}
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
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex items-center justify-center flex-shrink-0">
        <Sparkles size={14} />
      </div>
      <div className="flex-1 pt-1 text-sm whitespace-pre-wrap min-w-0">
        {toolCalls.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {toolCalls.map((tc) => <ToolCallCard key={tc.toolUseId} toolCall={tc} />)}
          </div>
        )}
        {renderContent(message.content)}
        {(message.tokensIn || message.tokensOut) && (
          <div className="mt-2 text-[10px] text-muted-2">
            {message.modelUsed} · {message.tokensIn} in + {message.tokensOut} out tokens
            {toolCalls.length > 0 && <span> · {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const ok = !toolCall.errorText;
  const summary = toolCallSummary(toolCall);

  return (
    <div
      className={`rounded-lg border ${ok ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20" : "border-rose-200 bg-rose-50 dark:bg-rose-950/20"} overflow-hidden`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-xs"
      >
        {ok ? <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" /> : <AlertCircle size={12} className="text-rose-600 flex-shrink-0" />}
        <Wrench size={11} className="text-muted-2 flex-shrink-0" />
        <span className="font-mono text-[11px] text-muted-2">{toolCall.name}</span>
        <span className="flex-1 text-left text-muted truncate">{summary}</span>
        <span className="text-[10px] text-muted-2 flex-shrink-0">{toolCall.durationMs}ms</span>
        {open ? <ChevronDown size={11} className="text-muted-2" /> : <ChevronRight size={11} className="text-muted-2" />}
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-2 text-[11px] font-mono">
          <div>
            <div className="text-muted-2 mb-0.5">Input</div>
            <pre className="bg-surface rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(toolCall.input, null, 2)}</pre>
          </div>
          <div>
            <div className="text-muted-2 mb-0.5">Result</div>
            <pre className="bg-surface rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(toolCall.result, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// One-line summary for a tool call so the user can see what happened
// without expanding the card. Falls back to JSON if we don't have a
// nice format for this tool name.
function toolCallSummary(tc: ToolCall): string {
  if (tc.errorText) return tc.errorText;
  const input = tc.input ?? {};
  const result = tc.result as Record<string, unknown> | undefined;
  const count = (result?.count as number | undefined) ?? undefined;
  switch (tc.name) {
    case "create_task":
      return `Created task: ${String(input.title ?? "")}`;
    case "search_tasks":
      return `Found ${count ?? 0} task${count === 1 ? "" : "s"}`;
    case "send_kudos":
      return `Sent kudos to ${String(input.receiverEmail ?? "")}`;
    case "search_employees":
      return `Found ${count ?? 0} employee${count === 1 ? "" : "s"}`;
    case "search_kb":
      return `Found ${count ?? 0} KB article${count === 1 ? "" : "s"} for "${String(input.query ?? "")}"`;
    case "create_lead":
      return `Logged lead: ${String(input.firstName ?? "")} ${String(input.lastName ?? "")}${input.company ? " · " + String(input.company) : ""}`;
    case "search_leads":
      return `Found ${count ?? 0} lead${count === 1 ? "" : "s"}`;
    case "update_lead_status":
      return `Lead status → ${String(input.status ?? "")}`;
    case "create_opportunity":
      return `Created deal: ${String(input.name ?? "")}${input.amount ? " · $" + String(input.amount) : ""}`;
    case "search_opportunities":
      return `Found ${count ?? 0} deal${count === 1 ? "" : "s"}`;
    case "move_opportunity_stage":
      return `Moved deal to "${String(input.newStageName ?? "")}"`;
    case "create_ticket":
      return `Filed ticket: ${String(input.title ?? "")}`;
    case "search_tickets":
      return `Found ${count ?? 0} ticket${count === 1 ? "" : "s"}`;
    case "update_ticket_status":
      return `Ticket → ${String(input.status ?? "")}`;
    case "create_contract":
      return `Logged contract: ${String(input.title ?? "")} (${String(input.counterparty ?? "")})`;
    case "search_contracts":
      return `Found ${count ?? 0} contract${count === 1 ? "" : "s"}`;
    case "create_sprint":
      return `Planned sprint: ${String(input.name ?? "")}`;
    case "create_campaign":
      return `Created campaign: ${String(input.name ?? "")}`;
    case "create_support_ticket":
      return `Filed support ticket: ${String(input.subject ?? "")}`;
    case "apply_macro":
      return `Applied macro "${String(input.macroSlug ?? "")}"`;
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

// Very lightweight rendering: split paragraphs, preserve newlines. Real
// markdown rendering can come in a follow-up via react-markdown.
function renderContent(text: string) {
  return text.split(/\n\n+/).map((para, i) => (
    <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>
  ));
}
