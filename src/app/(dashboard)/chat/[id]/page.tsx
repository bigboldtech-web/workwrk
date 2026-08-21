"use client";

/* Conversation view — Slack-style thread + composer, with Zoom-grade
 * calls one click away (docs/plans/comms-hub.md Phase 3).
 *
 *  - Poll: open pane fetches only messages newer than the last one,
 *    every 4s, paused while the tab is hidden. One indexed query.
 *  - Sends are optimistic: the message renders instantly, then swaps
 *    for the server row; failures surface a Retry — never silent loss.
 *  - Calls: video/audio buttons mount the same Jitsi embed meetings
 *    use, in a room derived from the conversation id. Starting a call
 *    posts a call-card message so everyone else can join from it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bell, BellOff, Loader2, LogOut, MoreHorizontal, Pencil, Phone,
  RefreshCw, Send, Users, Video,
} from "lucide-react";
import { MeetingCall } from "@/components/meetings/meeting-call";
import { TeamAvatar } from "@/components/team/ui";
import { useOsToast } from "@/components/layout/os/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { conversationTitle, type ChatUserLite } from "@/components/chat/conversation-utils";

const POLL_MS = 4_000;

type Message = {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  deletedAt?: string | null;
  metadata?: { kind?: string } | null;
  author: ChatUserLite;
  /** Client-only send states. */
  pending?: boolean;
  failed?: boolean;
};

type ConversationMeta = {
  id: string;
  type: "DM" | "GROUP" | "CHANNEL";
  name: string | null;
  members: { userId: string; notifyLevel?: string; user: ChatUserLite & { email?: string } }[];
  call: { room: string };
};

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const myName = session?.user?.name ?? null;

  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [callOpen, setCallOpen] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("call") === "1");
  const [callAudioOnly, setCallAudioOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Latest real (non-pending) message timestamp — the poll cursor.
  const lastRealTs = useRef<string | null>(null);

  /* ── data: meta ─────────────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    setMeta(null);
    setMetaError(false);
    fetch(`/api/conversations/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (active) setMeta(d); })
      .catch(() => { if (active) setMetaError(true); });
    return () => { active = false; };
  }, [id]);

  /* ── data: initial page ─────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    setMessages([]);
    setLoadedOnce(false);
    lastRealTs.current = null;
    fetch(`/api/conversations/${id}/messages`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!active) return;
        const rows: Message[] = d.messages ?? [];
        setMessages(rows);
        setHasMore(Boolean(d.hasMore));
        if (rows.length > 0) lastRealTs.current = rows[rows.length - 1].createdAt;
        setLoadedOnce(true);
        void markRead();
      })
      .catch(() => { if (active) setLoadedOnce(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const markRead = useCallback(async () => {
    try {
      await fetch(`/api/conversations/${id}/read`, { method: "POST" });
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } catch { /* read receipts are best-effort */ }
  }, [id]);

  /* ── poll for new messages ──────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || !lastRealTs.current) return;
      fetch(`/api/conversations/${id}/messages?after=${encodeURIComponent(lastRealTs.current)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const fresh: Message[] = d?.messages ?? [];
          if (fresh.length === 0) return;
          lastRealTs.current = fresh[fresh.length - 1].createdAt;
          let added = false;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const add = fresh.filter((m) => !seen.has(m.id));
            if (!add.length) return prev;
            added = true;
            return [...prev, ...add];
          });
          if (added && document.visibilityState === "visible") void markRead();
        })
        .catch(() => { /* next tick retries */ });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [id, markRead]);

  /* ── scroll handling ────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, callOpen, loadedOnce]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const loadOlder = async () => {
    const oldest = messages.find((m) => !m.pending);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await fetch(`/api/conversations/${id}/messages?before=${oldest.id}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        const older: Message[] = d.messages ?? [];
        const el = scrollRef.current;
        const prevHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !seen.has(m.id)), ...prev];
        });
        setHasMore(Boolean(d.hasMore));
        // Keep the viewport anchored on the message the user was reading.
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } finally { setLoadingOlder(false); }
  };

  /* ── sending ────────────────────────────────────────────────── */
  const deliver = useCallback(async (tempId: string, text: string, callCard: boolean) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(callCard ? { body: text, metadata: { kind: "call" } } : { body: text }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.message) throw new Error("send failed");
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...d.message } : m)));
      lastRealTs.current = d.message.createdAt;
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
    }
  }, [id]);

  const send = useCallback((text: string, callCard = false) => {
    const trimmed = text.trim();
    if (!trimmed || !meId) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const me = meta?.members.find((m) => m.userId === meId)?.user
      ?? { id: meId, firstName: myName?.split(" ")[0] ?? "Me", lastName: myName?.split(" ").slice(1).join(" ") ?? "", avatar: null };
    setMessages((prev) => [...prev, {
      id: tempId,
      body: trimmed,
      authorId: meId,
      createdAt: new Date().toISOString(),
      metadata: callCard ? { kind: "call" } : null,
      author: me,
      pending: true,
    }]);
    stickToBottom.current = true;
    void deliver(tempId, trimmed, callCard);
  }, [meId, meta, myName, deliver]);

  const retry = (m: Message) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, pending: true, failed: false } : x)));
    void deliver(m.id, m.body, (m.metadata as { kind?: string } | null)?.kind === "call");
  };

  const submit = () => {
    if (!input.trim()) return;
    send(input);
    setInput("");
    inputRef.current?.focus();
  };

  /* ── calls ──────────────────────────────────────────────────── */
  const startCall = (audioOnly: boolean) => {
    setCallAudioOnly(audioOnly);
    if (!callOpen) {
      setCallOpen(true);
      // Post a join-able card unless a call card already landed recently —
      // clicking "Join" on someone's card shouldn't spam another one.
      const recentCall = [...messages].reverse().find((m) => (m.metadata as { kind?: string } | null)?.kind === "call");
      const recentMs = recentCall ? Date.now() - new Date(recentCall.createdAt).getTime() : Infinity;
      if (recentMs > 10 * 60 * 1000) send(audioOnly ? "Started an audio call" : "Started a call", true);
    }
  };

  /* ── conversation actions ───────────────────────────────────── */
  const myNotify = meta?.members.find((m) => m.userId === meId)?.notifyLevel ?? "all";
  const toggleMute = async () => {
    setMenuOpen(false);
    const next = myNotify === "mute" ? "all" : "mute";
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifyLevel: next }),
    }).catch(() => null);
    if (res?.ok) {
      setMeta((prev) => prev ? { ...prev, members: prev.members.map((m) => (m.userId === meId ? { ...m, notifyLevel: next } : m)) } : prev);
      toast(next === "mute" ? "Conversation muted" : "Notifications on");
    } else toast("Couldn't update notifications");
  };

  const rename = async () => {
    setMenuOpen(false);
    const name = window.prompt("Group name", meta?.name ?? "");
    if (name === null) return;
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      setMeta((prev) => (prev ? { ...prev, name: name.trim() } : prev));
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } else toast("Couldn't rename");
  };

  const leave = async () => {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    setConfirmLeave(false);
    if (res?.ok) {
      window.dispatchEvent(new Event("workwrk:chat-changed"));
      router.push("/chat");
    } else toast("Couldn't leave the conversation");
  };

  /* ── render ─────────────────────────────────────────────────── */
  if (metaError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-[14px] text-zinc-500">This conversation isn&apos;t available. It may have been left or removed.</p>
      </div>
    );
  }

  const title = meta ? conversationTitle(meta, meId) : "…";
  const others = meta?.members.filter((m) => m.userId !== meId) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-14 border-b border-zinc-100 shrink-0">
        <div className="flex items-center -space-x-2 shrink-0">
          {others.slice(0, 3).map((m) => (
            <TeamAvatar key={m.userId} name={`${m.user.firstName} ${m.user.lastName}`} avatar={m.user.avatar} size={28} />
          ))}
          {others.length === 0 && <span className="w-7 h-7 rounded-full bg-zinc-100 inline-flex items-center justify-center"><Users className="w-4 h-4 text-zinc-400" /></span>}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-zinc-900">{title}</h1>
          {meta && meta.type !== "DM" && (
            <p className="text-[12px] text-zinc-400">{meta.members.length} members</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => startCall(true)}
          title="Start an audio call"
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
        >
          <Phone className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => startCall(false)}
          title="Start a video call"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#0073EA] text-white text-[13px] font-medium hover:bg-[#0060c2]"
        >
          <Video className="w-4 h-4" /> {callOpen ? "In call" : "Call"}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-zinc-200 bg-white shadow-lg py-1">
                <button type="button" onClick={() => void toggleMute()} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  {myNotify === "mute" ? <Bell className="w-4 h-4 text-zinc-400" /> : <BellOff className="w-4 h-4 text-zinc-400" />}
                  {myNotify === "mute" ? "Unmute notifications" : "Mute notifications"}
                </button>
                {meta?.type === "GROUP" && (
                  <>
                    <button type="button" onClick={() => void rename()} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                      <Pencil className="w-4 h-4 text-zinc-400" /> Rename group
                    </button>
                    <button type="button" onClick={() => { setMenuOpen(false); setConfirmLeave(true); }} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-red-600 hover:bg-red-50">
                      <LogOut className="w-4 h-4" /> Leave group
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Call panel */}
      {callOpen && meta?.call?.room && (
        <div className="px-4 pt-3 shrink-0" style={{ height: "48vh" }}>
          <MeetingCall
            room={meta.call.room}
            subject={title}
            displayName={myName}
            audioOnly={callAudioOnly}
            onLeave={() => setCallOpen(false)}
          />
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="text-[13px] text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1.5">
              {loadingOlder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Show earlier messages
            </button>
          </div>
        )}
        {!loadedOnce ? (
          <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-[15px] font-medium text-zinc-700">Say hello 👋</p>
            <p className="text-[13px] text-zinc-400 mt-1">This is the start of your conversation with {title}.</p>
          </div>
        ) : (
          <MessageFeed messages={messages} meId={meId} onRetry={retry} onJoinCall={() => startCall(false)} />
        )}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 pt-1 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 focus-within:border-zinc-300">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={`Message ${title}`}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            className="flex-1 resize-none bg-transparent outline-none text-[14px] text-zinc-800 placeholder:text-zinc-400 leading-6 max-h-40"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!input.trim()}
            aria-label="Send"
            className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#0073EA] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0060c2]"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {confirmLeave && (
        <ConfirmDialog
          open
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => void leave()}
          title="Leave this group?"
          description="You'll stop receiving messages. The conversation and its history stay for everyone else."
          confirmLabel="Leave group"
          destructive
        />
      )}
    </div>
  );
}

/* ── message feed: day dividers + author grouping ─────────────── */

function MessageFeed({ messages, meId, onRetry, onJoinCall }: {
  messages: Message[];
  meId: string | null;
  onRetry: (m: Message) => void;
  onJoinCall: () => void;
}) {
  const items = useMemo(() => {
    const out: Array<{ kind: "day"; key: string; label: string } | { kind: "msg"; key: string; msg: Message; head: boolean }> = [];
    let prevDay = "";
    let prevAuthor = "";
    let prevTime = 0;
    for (const m of messages) {
      const d = new Date(m.createdAt);
      const day = d.toDateString();
      if (day !== prevDay) {
        out.push({ kind: "day", key: `day-${day}`, label: dayLabel(d) });
        prevDay = day;
        prevAuthor = "";
      }
      const t = d.getTime();
      const head = m.authorId !== prevAuthor || t - prevTime > 5 * 60 * 1000;
      out.push({ kind: "msg", key: m.id, msg: m, head });
      prevAuthor = m.authorId;
      prevTime = t;
    }
    return out;
  }, [messages]);

  return (
    <div className="flex flex-col">
      {items.map((it) => it.kind === "day" ? (
        <div key={it.key} className="flex items-center gap-3 py-3">
          <span className="h-px flex-1 bg-zinc-100" />
          <span className="text-[12px] font-medium text-zinc-400">{it.label}</span>
          <span className="h-px flex-1 bg-zinc-100" />
        </div>
      ) : (
        <MessageRow key={it.key} msg={it.msg} head={it.head} mine={it.msg.authorId === meId} onRetry={onRetry} onJoinCall={onJoinCall} />
      ))}
    </div>
  );
}

function MessageRow({ msg, head, mine, onRetry, onJoinCall }: {
  msg: Message;
  head: boolean;
  mine: boolean;
  onRetry: (m: Message) => void;
  onJoinCall: () => void;
}) {
  const time = new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isCall = (msg.metadata as { kind?: string } | null)?.kind === "call";

  return (
    <div className={`group flex gap-2.5 px-1 rounded-md hover:bg-zinc-50/60 ${head ? "mt-2.5" : "mt-0.5"}`}>
      <div className="w-8 shrink-0 pt-0.5">
        {head ? (
          <TeamAvatar name={`${msg.author.firstName} ${msg.author.lastName}`} avatar={msg.author.avatar} size={30} />
        ) : (
          <span className="hidden group-hover:block text-[10px] text-zinc-300 tabular-nums pt-1.5 text-right pr-0.5">{time}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {head && (
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-zinc-900">
              {mine ? "You" : `${msg.author.firstName} ${msg.author.lastName}`}
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums">{time}</span>
          </div>
        )}
        {isCall ? (
          <div className="mt-1 inline-flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#0073EA]/10 text-[#0073EA]"><Video className="w-4 h-4" /></span>
            <span className="text-[14px] text-zinc-800">{msg.body}</span>
            <button type="button" onClick={onJoinCall} className="h-7 px-3 rounded-md bg-[#0073EA] text-white text-[13px] font-medium hover:bg-[#0060c2]">
              Join
            </button>
          </div>
        ) : (
          <p className={`text-[14px] leading-6 whitespace-pre-wrap break-words ${msg.deletedAt ? "italic text-zinc-400" : "text-zinc-800"} ${msg.pending ? "opacity-60" : ""}`}>
            {msg.deletedAt ? "Message removed" : linkify(msg.body)}
          </p>
        )}
        {msg.failed && (
          <button type="button" onClick={() => onRetry(msg)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-red-600 hover:text-red-700">
            <RefreshCw className="w-3 h-3" /> Failed to send — retry
          </button>
        )}
      </div>
    </div>
  );
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** Turn bare URLs into links; everything else stays plain text. */
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#0073EA] underline underline-offset-2 break-all">
        {part}
      </a>
    ) : part,
  );
}
