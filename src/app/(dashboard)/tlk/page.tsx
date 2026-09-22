"use client";

/**
 * /tlk, Talk home (spec-talk section 2.1).
 *
 * WHAT CHANGED AND WHY. This route used to fetch the conversation list and
 * `router.replace` into whichever conversation was newest, so Talk had no
 * landing at all: there was nowhere to see what was unread, no list of the
 * threads you are in, and no list of the places you were mentioned. The jump
 * also meant the Talk hub's first three sidebar rows had no destination. The
 * auto-redirect is gone; this is the home it jumped over.
 *
 * THE PANE ALWAYS HAS A URL. Selecting anything writes it into the query
 * string with `router.replace`, so copy link, refresh and browser back all
 * work on the right half:
 *
 *   /tlk                                  Unread (the default view, never written)
 *   /tlk?view=threads | ?view=mentions    the other two views
 *   /tlk?c=<id>                           a conversation open in the pane
 *   /tlk?c=<id>&thread=<parentId>         a thread open in the pane
 *   /tlk?c=<id>&m=<messageId>             a message highlighted in context
 *
 * Closing the pane strips c, thread and m and keeps view. "Open full page"
 * goes to /tlk/[id], which is still the page that owns a conversation.
 *
 * ONE BLUE BUTTON. The toolbar's New message is the page's only primary; the
 * pane's composer sends through a ghost Send, and the hero card with its
 * second blue button that used to sit here is gone.
 *
 * DATA. GET /api/conversations (already polled by the sidebar),
 * GET /api/conversations/threads, GET /api/conversations/mentions,
 * POST /api/conversations/read-all, POST /api/conversations/[id]/read. The
 * three lists tolerate their endpoint answering 404 for one release: the view
 * renders its empty state rather than an error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCheck, Hash, Link2, Lock, Maximize2, Users, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { SkeletonRows } from "@/components/ui/skeleton";
import { TeamAvatar } from "@/components/team/ui";
import { MessageFeed, type FeedMessage } from "@/components/talk/message-feed";
import { ChatComposer, type ComposerPayload } from "@/components/talk/chat-composer";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetch } from "@/lib/api-fetch";
import { conversationTitle, type ChatUserLite } from "@/components/talk/conversation-utils";

/** A person's display name, the one shape TeamAvatar and the rows both want. */
function personName(u: ChatUserLite): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone";
}

type View = "unread" | "threads" | "mentions";
const VIEWS: View[] = ["unread", "threads", "mentions"];
const VIEW_LABEL: Record<View, string> = { unread: "Unread", threads: "Threads", mentions: "Mentions" };

type ConvoLite = {
  id: string;
  type: string;
  name: string | null;
  restricted?: boolean;
  lastMessageAt: string;
  unreadCount: number;
  memberCount?: number;
  members?: { userId: string; user: ChatUserLite }[];
  lastMessage?: { body: string; authorId: string; createdAt: string } | null;
};

type ThreadRow = {
  parent: { id: string; body: string; authorId: string; createdAt: string; deleted?: boolean; author: ChatUserLite };
  conversation: { id: string; type: string; name: string | null };
  replyCount: number;
  unreadReplies: number;
  lastReplyAt: string | null;
};

type MentionRow = {
  message: { id: string; body: string; authorId: string; createdAt: string; unread: boolean; author: ChatUserLite };
  conversation: { id: string; type: string; name: string | null };
};

/**
 * The name a conversation shows in a list row, from the viewer's side. It is
 * `conversationTitle` (the one helper the sidebar and /tlk/[id] already share,
 * so three surfaces cannot name the same channel three ways) plus the "#" a
 * channel wears in Talk's naming canon.
 */
function convoLabel(c: { type: string; name: string | null; members?: { userId: string; user: ChatUserLite }[] }, meId: string | null): string {
  const base = conversationTitle({ type: c.type, name: c.name, members: c.members ?? [] }, meId);
  return c.type === "CHANNEL" && c.name ? `#${base}` : base;
}

function ConvoGlyph({ type, restricted }: { type: string; restricted?: boolean }) {
  const Icon = type === "CHANNEL" ? (restricted ? Lock : Hash) : Users;
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

/** "1 thread", "3 threads": the footer counted "1 threads". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function TalkHomePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useOsToast();
  const fmt = useFormat();
  const { prefs } = useOsShell();
  void prefs;

  const rawView = params.get("view");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "unread";
  const openConvo = params.get("c");
  const openThread = params.get("thread");
  const openMessage = params.get("m");

  const [meId, setMeId] = useState<string | null>(null);
  const [convos, setConvos] = useState<ConvoLite[] | null>(null);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [mentions, setMentions] = useState<MentionRow[] | null>(null);
  const [listError, setListError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  /** Rows read in this sitting stay in place, restyled, until the next load. */
  const [readNow, setReadNow] = useState<Set<string>>(() => new Set());

  /* ── the URL is the only selection state ─────────────────────── */
  const setParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `/tlk?${qs}` : "/tlk", { scroll: false });
  }, [params, router]);

  const chooseView = (v: View) => setParams((p) => {
    if (v === "unread") p.delete("view"); else p.set("view", v);
    p.delete("c"); p.delete("thread"); p.delete("m");
  });

  const closePane = () => setParams((p) => { p.delete("c"); p.delete("thread"); p.delete("m"); });

  /* ── data ────────────────────────────────────────────────────── */
  // Every state write here happens in the promise callback, never in the
  // synchronous body, so an effect can call this without the cascading
  // render the react-hooks rules warn about.
  const loadConvos = useCallback(() => {
    return apiFetch<{ conversations?: ConvoLite[] }>("/api/conversations").then((r) => {
      if (!r.ok) { setConvos([]); setListError(true); return; }
      setConvos(r.data?.conversations ?? []);
      setListError(false);
      setReadNow(new Set());
    });
  }, []);

  useEffect(() => { void loadConvos(); }, [loadConvos]);

  // The viewer's own id, for "is this row mine" and the composer.
  useEffect(() => {
    let alive = true;
    void apiFetch<{ user?: { id?: string } }>("/api/me").then((r) => {
      if (!alive || !r.ok) return;
      setMeId(r.data?.user?.id ?? null);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (view !== "threads" || threads !== null) return;
    let alive = true;
    void apiFetch<{ threads?: ThreadRow[] }>("/api/conversations/threads").then((r) => {
      if (!alive) return;
      // A 404 here is the one-release tolerance: the view shows its empty
      // state rather than an error the person cannot act on.
      setThreads(r.ok ? (r.data?.threads ?? []) : []);
    });
    return () => { alive = false; };
  }, [view, threads]);

  useEffect(() => {
    if (view !== "mentions" || mentions !== null) return;
    let alive = true;
    void apiFetch<{ mentions?: MentionRow[] }>("/api/conversations/mentions").then((r) => {
      if (!alive) return;
      setMentions(r.ok ? (r.data?.mentions ?? []) : []);
    });
    return () => { alive = false; };
  }, [view, mentions]);

  // Realtime: the shell fans SSE out as this event, and the sidebar poll
  // raises it too, so the two never disagree about what is unread.
  useEffect(() => {
    const onChanged = () => { void loadConvos(); setThreads(null); setMentions(null); };
    window.addEventListener("workwrk:chat-changed", onChanged);
    return () => window.removeEventListener("workwrk:chat-changed", onChanged);
  }, [loadConvos]);

  const unreadRows = useMemo(
    () => (convos ?? []).filter((c) => c.unreadCount > 0 || readNow.has(c.id)),
    [convos, readNow],
  );
  const unreadTotal = useMemo(
    () => (convos ?? []).reduce((n, c) => n + (readNow.has(c.id) ? 0 : c.unreadCount), 0),
    [convos, readNow],
  );

  const markRead = useCallback(async (id: string) => {
    setReadNow((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    const r = await apiFetch(`/api/conversations/${id}/read`, { method: "POST", keepalive: true });
    if (!r.ok) return;
    window.dispatchEvent(new Event("workwrk:chat-changed"));
  }, []);

  const openRow = useCallback((conversationId: string, extra?: { thread?: string; m?: string }) => {
    setParams((p) => {
      p.set("c", conversationId);
      if (extra?.thread) p.set("thread", extra.thread); else p.delete("thread");
      if (extra?.m) p.set("m", extra.m); else p.delete("m");
    });
    void markRead(conversationId);
  }, [setParams, markRead]);

  const markAll = async () => {
    setMarkingAll(true);
    const r = await apiFetch("/api/conversations/read-all", { method: "POST", keepalive: true });
    setMarkingAll(false);
    if (!r.ok) { toast("Couldn't mark everything as read. Try again"); return; }
    setReadNow(new Set((convos ?? []).map((c) => c.id)));
    window.dispatchEvent(new Event("workwrk:chat-changed"));
  };

  const copyPaneLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch { toast("Couldn't copy the link"); }
  };

  const counts: Record<View, number> = {
    unread: unreadTotal,
    threads: (threads ?? []).reduce((n, t) => n + (t.unreadReplies > 0 ? 1 : 0), 0),
    mentions: (mentions ?? []).filter((m) => m.message.unread).length,
  };

  /* ── list bodies ─────────────────────────────────────────────── */
  function renderUnreadList() {
    if (convos === null) return <div className="p-3"><SkeletonRows rows={6} /></div>;
    if (listError) {
      return <OsEmptyView title="Couldn't load Talk" action={{ label: "Retry", onClick: () => { setConvos(null); void loadConvos(); } }} />;
    }
    if (unreadRows.length === 0) return <OsEmptyView title="You're all caught up" />;
    return (
      <ul className="py-1">
        {unreadRows.map((c) => {
          const read = readNow.has(c.id) || c.unreadCount === 0;
          const selected = openConvo === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openRow(c.id)}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${selected ? "bg-selected" : "hover:bg-hover"}`}
              >
                <span className="flex items-center gap-2">
                  <ConvoGlyph type={c.type} restricted={c.restricted} />
                  <span className={`flex-1 truncate text-base ${read ? "font-normal text-ink" : "font-medium text-ink-strong"}`}>
                    {convoLabel(c, meId)}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{fmt.date(c.lastMessageAt, "smart")}</span>
                </span>
                <span className="flex items-center gap-2 ps-8">
                  <span className="flex-1 truncate text-sm text-ink-2">{c.lastMessage?.body || "No messages yet"}</span>
                  {read ? null : <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{c.unreadCount}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderThreadsList() {
    if (threads === null) return <div className="p-3"><SkeletonRows rows={6} /></div>;
    if (threads.length === 0) return <OsEmptyView title="No threads yet" hint="Reply in a thread and it shows up here." />;
    return (
      <ul className="py-1">
        {threads.map((t) => {
          const selected = openThread === t.parent.id;
          return (
            <li key={t.parent.id}>
              <button
                type="button"
                onClick={() => openRow(t.conversation.id, { thread: t.parent.id })}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${selected ? "bg-selected" : "hover:bg-hover"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium text-ink-2">{convoLabel(t.conversation, meId)}</span>
                  <span className="shrink-0 text-xs text-ink-3">{t.lastReplyAt ? fmt.date(t.lastReplyAt, "smart") : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-base text-ink">
                    {t.parent.deleted ? "Message removed" : t.parent.body}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                  </span>
                  {t.unreadReplies > 0 ? (
                    <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{t.unreadReplies}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderMentionsList() {
    if (mentions === null) return <div className="p-3"><SkeletonRows rows={6} /></div>;
    if (mentions.length === 0) return <OsEmptyView title="Nobody has mentioned you yet" />;
    return (
      <ul className="py-1">
        {mentions.map((row) => {
          const selected = openMessage === row.message.id;
          return (
            <li key={row.message.id}>
              <button
                type="button"
                onClick={() => openRow(row.conversation.id, { m: row.message.id })}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${selected ? "bg-selected" : "hover:bg-hover"}`}
              >
                <span className="flex items-center gap-2">
                  <TeamAvatar name={personName(row.message.author)} avatar={row.message.author.avatar} size={20} />
                  <span className="truncate text-base font-medium text-ink-strong">{personName(row.message.author)}</span>
                  <span className="flex-1 truncate text-sm text-ink-2">in {convoLabel(row.conversation, meId)}</span>
                  <span className="shrink-0 text-xs text-ink-3">{fmt.date(row.message.createdAt, "smart")}</span>
                </span>
                <span className="block truncate ps-7 text-base text-ink">{row.message.body}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OsPageHeader
        title="Talk"
        views={(
          <ViewTabStrip aria-label="Talk views">
            {VIEWS.map((v) => (
              <ViewTab
                key={v}
                label={VIEW_LABEL[v]}
                active={view === v}
                onClick={() => chooseView(v)}
                trailing={counts[v] > 0 ? <span className="tabular-nums text-xs text-ink-3">{counts[v]}</span> : undefined}
              />
            ))}
          </ViewTabStrip>
        )}
        toolbar={{
          left: view === "unread" ? (
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={markingAll || unreadTotal === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
            >
              <CheckCheck className="h-4 w-4" strokeWidth={1.5} /> Mark all as read
            </button>
          ) : undefined,
          primary: {
            label: "New message",
            onClick: () => window.dispatchEvent(new Event("workwrk:os:new:chat-new")),
            split: { label: "New channel", onClick: () => window.dispatchEvent(new Event("workwrk:os:new:chat-new-channel")) },
          },
        }}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-e border-line bg-surface-1">
          <div className="min-h-0 flex-1">
            {view === "unread" ? renderUnreadList() : view === "threads" ? renderThreadsList() : renderMentionsList()}
          </div>
          <div className="flex h-11 shrink-0 items-center border-t border-line px-3 text-sm font-medium text-ink-2">
            {view === "unread"
              ? `${unreadTotal} unread`
              : view === "threads"
                ? plural((threads ?? []).length, "thread")
                : plural((mentions ?? []).length, "mention")}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {openConvo ? (
            <TalkPane
              key={openConvo}
              conversationId={openConvo}
              threadId={openThread}
              highlightId={openMessage}
              meId={meId}
              onClose={closePane}
              onCopyLink={() => void copyPaneLink()}
              onCloseThread={() => setParams((p) => p.delete("thread"))}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <span className="mx-auto mb-3 flex items-center justify-center gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-line-strong" />)}
                </span>
                <p className="text-base text-ink-2">Pick a conversation to read it here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ the detail pane ══════════════════════════ */

/**
 * A conversation read (and written) inside Talk home. It is deliberately the
 * quiet half of /tlk/[id]: the same feed, the same composer and the same send
 * endpoint, without the page's header cluster, call controls or right panel.
 * "Open full page" is how you get those, and it keeps the same conversation.
 */
function TalkPane({ conversationId, threadId, highlightId, meId, onClose, onCopyLink, onCloseThread }: {
  conversationId: string;
  threadId: string | null;
  highlightId: string | null;
  meId: string | null;
  onClose: () => void;
  onCopyLink: () => void;
  onCloseThread: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [meta, setMeta] = useState<{ id: string; type: string; name: string | null; members: { userId: string; user: ChatUserLite }[] } | null>(null);
  const [messages, setMessages] = useState<FeedMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Every state write lands in the promise callback, never in the synchronous
  // body, so the effect below does not cascade a render.
  const load = useCallback(() => {
    return Promise.all([
      // GET /api/conversations/[id] answers with the conversation at the top
      // level (id, type, name, members, call), not wrapped in a key.
      apiFetch<{ id: string; type: string; name: string | null; members: { userId: string; user: ChatUserLite }[] }>(`/api/conversations/${conversationId}`),
      apiFetch<{ messages?: FeedMessage[] }>(`/api/conversations/${conversationId}/messages`),
    ]).then(([m, list]) => {
      if (!m.ok || !list.ok) { setFailed(true); setMessages([]); return; }
      setFailed(false);
      setMeta(m.data ?? null);
      setMessages(list.data?.messages ?? []);
    });
  }, [conversationId]);

  // The pane is keyed on the conversation id, so a new conversation is a
  // fresh mount with `messages` already null: the effect only loads.
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages === null) return;
    if (highlightId) {
      const target = el.querySelector(`[data-message-id="${CSS.escape(highlightId)}"]`);
      if (target) { target.scrollIntoView({ block: "center" }); return; }
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, highlightId]);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of meta?.members ?? []) map.set(m.userId, personName(m.user));
    return map;
  }, [meta]);

  const title = meta ? convoLabel(meta, meId) : "";

  const send = async (payload: ComposerPayload) => {
    if (!payload.body && payload.attachments.length === 0) return;
    const temp: FeedMessage = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      body: payload.body,
      authorId: meId ?? "me",
      createdAt: new Date().toISOString(),
      parentId: threadId ?? null,
      metadata: {
        ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
        ...(payload.mentions.length > 0 ? { mentions: payload.mentions } : {}),
      },
      author: (meta?.members ?? []).find((m) => m.userId === meId)?.user ?? { id: meId ?? "me", firstName: "Me", lastName: "", avatar: null },
      pending: true,
    };
    setMessages((prev) => [...(prev ?? []), temp]);
    const metadata: Record<string, unknown> = {};
    if (payload.attachments.length > 0) metadata.attachments = payload.attachments;
    if (payload.mentions.length > 0) metadata.mentions = payload.mentions;
    // keepalive so a send fired as the tab closes still leaves; a failure
    // never disappears, it becomes the Retry row in the feed.
    const r = await apiFetch<{ message?: FeedMessage }>(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: payload.body,
        ...(threadId ? { parentId: threadId } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      }),
      keepalive: true,
    });
    if (!r.ok || !r.data?.message) {
      setMessages((prev) => (prev ?? []).map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      return;
    }
    const server = r.data.message;
    setMessages((prev) => (prev ?? []).map((m) => (m.id === temp.id ? server : m)));
    window.dispatchEvent(new Event("workwrk:chat-changed"));
  };

  const thread = threadId ? (messages ?? []).find((m) => m.id === threadId) ?? null : null;
  const replies = threadId ? (messages ?? []).filter((m) => m.parentId === threadId) : [];
  const topLevel = (messages ?? []).filter((m) => !m.parentId);
  const shown = threadId && thread ? [thread, ...replies] : topLevel;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 truncate text-base font-semibold text-ink-strong">
          {threadId ? `Thread in ${title}` : title}
        </h2>
        {threadId ? (
          <button type="button" onClick={onCloseThread} className="h-7 rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">
            Back to conversation
          </button>
        ) : null}
        <button type="button" onClick={onCopyLink} aria-label="Copy link" title="Copy link" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <Link2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <Link href={`/tlk/${conversationId}`} aria-label="Open full page" title="Open full page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
        </Link>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {messages === null ? (
          <SkeletonRows rows={6} />
        ) : failed ? (
          <OsEmptyView title="Couldn't open this conversation" action={{ label: "Retry", onClick: () => { setMessages(null); void load(); } }} />
        ) : (
          <MessageFeed
            messages={shown}
            meId={meId}
            memberNames={memberNames}
            onRetry={() => toast("Open the full page to retry this message")}
            onJoinCall={() => { router.push(`/tlk/${conversationId}?call=video`); }}
            onReact={() => toast("Open the full page to react")}
            onEdit={() => toast("Open the full page to edit")}
            onDelete={() => toast("Open the full page to delete")}
            onOpenThread={undefined}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        <ChatComposer
          members={meta?.members ?? []}
          meId={meId}
          placeholder={threadId ? "Reply…" : `Message ${title}`}
          onSend={(p) => void send(p)}
          onError={(msg) => toast(msg)}
        />
      </div>
    </div>
  );
}
