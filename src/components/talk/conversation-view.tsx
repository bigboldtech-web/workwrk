"use client";

// ConversationView (spec-talk.md section 2.2 and section 3): one channel,
// group or direct message. It renders at /tlk/[id] as a page and can render in
// the Talk home's detail pane, which is why the Send button's colour is a prop
// rather than a constant: one blue thing per page, and in the pane the page's
// blue belongs to New message.
//
// WHAT THIS REBUILD FIXED, each one a real failure rather than a restyle:
//
//   * A FAILED FETCH RENDERED AS "This is the very beginning of…". The catch
//     set loadedOnce and left messages empty, which is indistinguishable from
//     an empty conversation, so a dropped network read told people their
//     history was gone. There is now an explicit `feedFailed` state with a
//     wired Retry, and the start-of-history block renders only when a read
//     actually SUCCEEDED and reached the beginning.
//   * A 404 SELF-JOIN CALLED window.location.reload(). Inside a single-page
//     shell that tears down the call dock: deep-linking into a channel while
//     on a call dropped the call. It refetches instead.
//   * RENAME WAS window.prompt. It is a dialog now, and rename is Full access
//     only, where before any member could rename any channel.
//   * THE RIGHT PANEL HAS A URL. ?thread= and ?m= are links, so copy link,
//     refresh and browser back all work on a thread.
//   * #general CANNOT BE LEFT, RENAMED, RESTRICTED OR ARCHIVED, and the
//     controls are absent rather than disabled, because a disabled control
//     that can never be enabled is a lie about what the product does.
//
// POLLING IS A BACKSTOP. The SSE stream's per-conversation event triggers an
// instant keyset refetch; the interval only runs while the stream is down,
// which `workwrk:realtime-state` reports.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bell, Check, ChevronDown, ChevronRight, Info, Link2, LogOut, MoreHorizontal, Pencil, Phone,
  RefreshCw, Search as SearchIcon, Share2, Star, Tag, UserPlus, Video, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { BackButton } from "@/components/ui/back-button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell, useLayer } from "@/components/layout/os/shell-context";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { AddPeopleDialog } from "@/components/talk/add-people-dialog";
import { conversationTitle, type ChatUserLite } from "@/components/talk/conversation-utils";
import { MessageFeed, type FeedMessage } from "@/components/talk/message-feed";
import { MessageBox, type MessagePayload } from "@/components/talk/message-box";
import {
  ConversationGlyph, DetailsPanel, RightPanel, SearchPanel, ThreadView,
  type PanelConversation, type PanelKind,
} from "@/components/talk/right-panel";
import {
  TALK_START_CALL_EVENT, forgetFailedSend, readTalkLeft, readTalkOutbox,
  rememberFailedSend, talkLeftKey, type OutboxEntry,
} from "@/components/talk/talk-keys";
import { WINDOW_EVENTS, convoEventName } from "@/lib/realtime-events";
import { useFormat } from "@/lib/format/use-date-prefs";
import { useShortcut } from "@/lib/shortcuts";
import {
  canAddPeople, canArchive, canCall, canCopyGuestLink, canEditTopic, canLeave, canPost,
  canReact, canRename, canResetGuestLink, isArchived, readOnlyReason,
  type TalkRole,
} from "@/lib/talk-access";

/** The one three-state notification vocabulary (naming-canon.md section 1),
 *  used by this menu and by the Details panel's SegmentedControl so the two
 *  surfaces cannot word the same setting differently. */
const NOTIFY_LEVELS: ReadonlyArray<{ value: "all" | "mentions" | "mute"; label: string }> = [
  { value: "all", label: "All messages" },
  { value: "mentions", label: "Mentions only" },
  { value: "mute", label: "Muted" },
];

/** Backstop only: SSE (workwrk:convo:<id>) triggers an instant refetch. */
const POLL_MS = 20_000;
/** The roster poll, while the stream is down. Tighter while a call is live. */
const ROSTER_MS = 30_000;
const ROSTER_IN_CALL_MS = 10_000;
/** A roster older than this is a ghost from a missed webhook, not a live call. */
const LIVE_CALL_MAX_MS = 4 * 3600_000;

type ConversationMeta = PanelConversation & {
  role: TalkRole;
  joinable?: boolean;
  memberCount?: number;
  owner?: { id: string; name: string } | null;
  activeCall?: { participants: { identity: string; name: string }[]; startedAt: string } | null;
};

/** `parent` is NULL while a thread opened from a URL is still loading.
 *
 *  It used to be a stub `{ id } as FeedMessage`, which is how ?m= on a reply
 *  crashed the page: the feed read `msg.author.firstName` off an object that
 *  had only an id. A thread whose parent is not in the loaded window is a
 *  thread that is still loading, and saying so is both true and safe. */
type Thread = { parentId: string; parent: FeedMessage | null; replies: FeedMessage[]; loading: boolean };

/**
 * Does the server already hold the message this "Not sent" row is offering
 * to send again?
 *
 * A POST's response can be lost AFTER the row was committed, and then this
 * device holds a failed copy of a message the conversation already has. The
 * test is: my own row, the same words, in the same place, not pending and
 * not failed itself, created at or after the moment the failed copy was
 * written here. Words typed twice on purpose have an EARLIER twin, never a
 * later one, so looking forward in time cannot swallow a deliberate repeat.
 *
 * Exported for its unit test; the view uses it to drop the ghost row rather
 * than leave a Retry that would write the message a second time.
 */
export function hasLandedCopy(rows: FeedMessage[], failed: FeedMessage): boolean {
  return rows.some((s) =>
    s.id !== failed.id && !s.pending && !s.failed && !s.deletedAt &&
    s.authorId === failed.authorId && s.body === failed.body &&
    (s.parentId ?? null) === (failed.parentId ?? null) &&
    s.createdAt >= failed.createdAt);
}

export function ConversationView({
  id,
  primarySend = true,
  initialThread = null,
  initialMessage = null,
  initialCall = null,
  embedded = false,
  onNotFound,
  onUrlPatch,
}: {
  id: string;
  /** False in the Talk home pane: the page's one blue is elsewhere. */
  primarySend?: boolean;
  initialThread?: string | null;
  initialMessage?: string | null;
  initialCall?: "video" | "audio" | null;
  /** In the Talk home pane: no BackButton, no breadcrumb of its own. */
  embedded?: boolean;
  /** The page wants to render its own 404 or Join screen. */
  onNotFound?: (meta: { joinable: boolean; name: string | null; owner: { id: string; name: string } | null }) => void;
  /** Embedded hosts own the query string: Talk home keeps ?c= alongside
   *  ?thread= and ?m=, so it writes the URL rather than this component. */
  onUrlPatch?: (patch: { thread?: string | null; m?: string | null }) => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const myName = session?.user?.name ?? null;
  const { activeCall, startCall: startGlobalCall } = useOsShell();
  const { isAdmin } = useViewerRole();
  const fmt = useFormat();
  const callOpen = activeCall?.conversationId === id;

  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [feedFailed, setFeedFailed] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [panel, setPanel] = useState<PanelKind>(initialThread ? "thread" : null);
  const [panelFiles, setPanelFiles] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(initialMessage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifySubOpen, setNotifySubOpen] = useState(false);
  const [topicOpen, setTopicOpen] = useState(false);
  const [callMenuOpen, setCallMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<null | boolean>(null);
  const [removeTarget, setRemoveTarget] = useState<null | { userId: string; name: string }>(null);
  const [transferTarget, setTransferTarget] = useState<null | { userId: string; name: string }>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FeedMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Keyset poll cursor (updatedAt, id), advanced ONLY by the initial load and
  // by poll responses. A send or a thread-open bumping it could skip other
  // people's concurrent edits.
  const cursor = useRef<{ ts: string; id: string } | null>(null);
  const polling = useRef(false);
  const threadRef = useRef<Thread | null>(null);
  threadRef.current = thread;

  useLayer(panel !== null, { kind: "panel", close: () => closePanel() });

  const role: TalkRole = meta?.role ?? "none";
  const archived = meta ? isArchived(meta) : false;
  const writable = meta ? canPost(meta, role) : false;
  const reactable = meta ? canReact(meta, role) : false;

  const memberNames = useMemo(
    () => new Map((meta?.members ?? []).map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`.trim()])),
    [meta],
  );

  const title = meta
    ? meta.type === "CHANNEL" ? `#${meta.name ?? "channel"}` : conversationTitle(meta, meId)
    : "Talk";

  const seedCursor = (rows: FeedMessage[]) => {
    // Pair-wise max over the page; an empty conversation starts at the epoch
    // so the poll still runs and catches the first message.
    let best = cursor.current ?? { ts: new Date(0).toISOString(), id: "" };
    for (const r of rows) {
      const u = r.updatedAt ?? r.createdAt;
      if (u > best.ts || (u === best.ts && r.id > best.id)) best = { ts: u, id: r.id };
    }
    cursor.current = best;
  };

  /* ── URL is the panel's state ───────────────────────────────── */

  const writeUrl = useCallback((patch: { thread?: string | null; m?: string | null }) => {
    if (embedded) { onUrlPatch?.(patch); return; }
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) params.delete(k); else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(`/tlk/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [embedded, id, router, onUrlPatch]);

  const closePanel = useCallback(() => {
    setPanel(null);
    setThread(null);
    setPanelFiles(false);
    writeUrl({ thread: null });
  }, [writeUrl]);

  /* ── data: meta ─────────────────────────────────────────────── */

  const loadMeta = useCallback(async (silent = false) => {
    if (!silent) { setMeta(null); setMetaError(false); }
    try {
      const r = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (r.status === 404) {
        // A deep link into a channel I have not joined. Channels are open, so
        // try a self-join ONCE and refetch. Never when the person has just
        // LEFT (the back button would silently re-join them), and never on a
        // transient 500, which would reload-loop.
        if (!readTalkLeft(id)) {
          const j = await fetch(`/api/conversations/${id}/join`, { method: "POST" });
          if (j.ok) {
            // A state refetch, never window.location.reload(): a reload here
            // tore down the shell and with it any call in progress.
            const again = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
            if (again.ok) { setMeta(await again.json()); return; }
          }
        }
        setMetaError(true);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (d?.id !== id) return; // a response for a conversation we left behind
      setMeta(d);
      setMetaError(false);
      if (d.role === "none" && d.joinable && onNotFound) {
        onNotFound({ joinable: true, name: d.name ?? null, owner: d.owner ?? null });
      }
    } catch {
      if (!silent) setMetaError(true);
    }
  }, [id, onNotFound]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  /* ── data: the feed ─────────────────────────────────────────── */

  /** Me, as the feed's author shape. Declared here rather than beside the
   *  send helpers because the outbox restore below needs it too. */
  const meLite: ChatUserLite = useMemo(() => {
    const mine = meta?.members.find((m) => m.userId === meId)?.user;
    if (mine) return mine;
    return {
      id: meId ?? "me",
      firstName: myName?.split(" ")[0] ?? "Me",
      lastName: myName?.split(" ").slice(1).join(" ") ?? "",
      avatar: null,
    };
  }, [meta, meId, myName]);

  /** One stored failure as the "Not sent · Retry · Delete" row it was before
   *  the navigation. */
  const outboxRow = useCallback((e: OutboxEntry): FeedMessage => ({
    id: e.id,
    body: e.body,
    authorId: meId ?? "me",
    createdAt: e.createdAt,
    parentId: e.parentId ?? null,
    metadata: (e.metadata ?? null) as FeedMessage["metadata"],
    author: meLite,
    failed: true,
    replyCount: 0,
  }), [meId, meLite]);

  /** Top-level messages written here that never reached the server.
   *
   *  Thread replies are held back for `openThreadById`, which is the only
   *  place they can be shown in context, and unsaved edits belong on the
   *  message they edit rather than in the feed as a new message: both are
   *  read back below. Nothing stored here is left without a reader, because
   *  an entry no screen can render is somebody's words in a drawer nobody
   *  opens. */
  const restoreOutbox = useCallback((): FeedMessage[] =>
    readTalkOutbox(id).filter((e) => !e.parentId && !e.editOf).map(outboxRow),
  [id, outboxRow]);

  /** The failed replies stored for one thread, rebuilt as its rows. */
  const restoreOutboxReplies = useCallback((parentId: string): FeedMessage[] =>
    readTalkOutbox(id).filter((e) => e.parentId === parentId && !e.editOf).map(outboxRow),
  [id, outboxRow]);

  /* ── edits that were typed and never saved ──────────────────── */

  /** `next` is the rewrite, `saved` the words the server last gave us, which
   *  is what Delete puts back. `saved` is null only before the server row has
   *  been seen at all (a stored edit adopted on a fresh page, whose message
   *  has not loaded yet). `saving` is true while the PATCH is in flight, so
   *  a poll answering mid-request neither puts the old words back nor labels
   *  a save that is still running as one that failed. */
  type PendingEdit = { next: string; saved: string | null; savedEditedAt: string | null; saving: boolean };
  const pendingEdits = useRef<Map<string, PendingEdit>>(new Map());

  /** A server row with any unsaved edit of it still on top.
   *
   *  The poll must not paint the saved words back over a rewrite that is
   *  still waiting to be retried: the row would look reverted and the typed
   *  text would be off the screen with no way back to it. Every path that
   *  takes rows from the server runs them through this. */
  const keepUnsavedEdit = useCallback((m: FeedMessage): FeedMessage => {
    const edit = pendingEdits.current.get(m.id);
    if (!edit) return m;
    // Whatever the server last said is what Delete restores, so it is
    // refreshed here rather than frozen at the moment the edit failed.
    pendingEdits.current.set(m.id, { ...edit, saved: m.body, savedEditedAt: m.editedAt ?? null });
    return { ...m, body: edit.next, failed: !edit.saving };
  }, []);

  /** Unsaved edits this device stored before the page was reloaded. */
  const adoptStoredEdits = useCallback(() => {
    for (const e of readTalkOutbox(id)) {
      if (e.editOf && !pendingEdits.current.has(e.editOf)) {
        pendingEdits.current.set(e.editOf, { next: e.body, saved: null, savedEditedAt: null, saving: false });
      }
    }
  }, [id]);

  const loadFeed = useCallback(async () => {
    setFeedFailed(false);
    setLoadedOnce(false);
    setMessages([]);
    cursor.current = null;
    // The unsaved edits belong to the conversation being left, not to this
    // one. They are on disk, and `adoptStoredEdits` reads this
    // conversation's back in below.
    pendingEdits.current = new Map();
    try {
      const url = initialMessage
        ? `/api/conversations/${id}/messages?around=${encodeURIComponent(initialMessage)}`
        : `/api/conversations/${id}/messages`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      adoptStoredEdits();
      const rows: FeedMessage[] = (d.messages ?? []).map(keepUnsavedEdit);
      setMessages([...rows, ...restoreOutbox()]);
      setHasMore(Boolean(d.hasMore));
      seedCursor(rows);
      setLoadedOnce(true);
      if (d.anchorId) setHighlightId(d.anchorId);
      if (d.threadParentId) {
        // The link pointed at a REPLY. Open its thread, and let the fetch
        // supply the parent: there is no parent object to hand over here.
        setPanel("thread");
        void openThreadById(d.threadParentId, true);
      }
      void markRead();
    } catch {
      // THE ONE THING THIS MUST NOT DO is fall through to an empty feed: an
      // empty feed renders "This is the start of #sales", which tells somebody
      // their history is gone when the truth is that one request failed.
      setFeedFailed(true);
      setLoadedOnce(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, initialMessage]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const markRead = useCallback(async () => {
    try {
      await fetch(`/api/conversations/${id}/read`, { method: "POST" });
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    } catch { /* read receipts are best effort */ }
  }, [id]);

  /* ── merge machinery ────────────────────────────────────────── */

  const mergeTopLevel = (rows: FeedMessage[]) => {
    if (rows.length === 0) return false;
    // Before the updater, never inside it: React may run an updater twice.
    const incoming = rows.map(keepUnsavedEdit);
    let changed = false;
    setMessages((prev) => {
      let next = prev;
      const oldest = prev.find((m) => !m.pending);
      for (const m of incoming) {
        const idx = next.findIndex((x) => x.id === m.id);
        if (idx >= 0) {
          next = next === prev ? [...prev] : next;
          next[idx] = { ...m };
          changed = true;
        } else if (!oldest || m.createdAt >= oldest.createdAt) {
          next = next === prev ? [...prev] : next;
          const at = next.findIndex((x) => !x.pending && x.createdAt > m.createdAt);
          if (at === -1) next.push({ ...m }); else next.splice(at, 0, { ...m });
          changed = true;
        }
      }
      return next;
    });
    return changed;
  };

  const mergeThread = (rows: FeedMessage[]) => {
    const open = threadRef.current;
    if (!open) return;
    const incoming = rows.map(keepUnsavedEdit);
    const forThread = incoming.filter((m) => m.parentId === open.parentId);
    const parentUpdate = incoming.find((m) => m.id === open.parentId);
    if (forThread.length === 0 && !parentUpdate) return;
    setThread((prev) => {
      if (!prev) return prev;
      let replies = prev.replies;
      for (const m of forThread) {
        const idx = replies.findIndex((x) => x.id === m.id);
        if (idx >= 0) { replies = [...replies]; replies[idx] = { ...m }; }
        else {
          replies = [...replies];
          const at = replies.findIndex((x) => !x.pending && x.createdAt > m.createdAt);
          if (at === -1) replies.push({ ...m }); else replies.splice(at, 0, { ...m });
        }
      }
      return { ...prev, parent: parentUpdate ? { ...parentUpdate } : prev.parent, replies };
    });
  };

  /* ── the one message poll, SSE first ────────────────────────── */

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (document.hidden || !cursor.current || polling.current) return;
      polling.current = true;
      try {
        // A 200-row page means more changes are waiting: drain them now
        // rather than one page per tick.
        for (let round = 0; round < 5; round++) {
          const c: { ts: string; id: string } = cursor.current;
          const r: Response = await fetch(
            `/api/conversations/${id}/messages?after=${encodeURIComponent(c.ts)}&afterId=${encodeURIComponent(c.id)}`,
            { cache: "no-store" },
          );
          if (!r.ok) break;
          const d: { messages?: FeedMessage[]; more?: boolean; cursor?: { ts: string; id: string } | null } = await r.json();
          const fresh: FeedMessage[] = d?.messages ?? [];
          if (fresh.length === 0) break;
          if (d.cursor?.ts) cursor.current = { ts: d.cursor.ts, id: d.cursor.id ?? "" };
          const newTop = mergeTopLevel(fresh.filter((m) => !m.parentId));
          mergeThread(fresh);
          const fromOthers = fresh.some((m) => m.authorId !== meId && !m.deletedAt);
          if ((newTop || fromOthers) && document.visibilityState === "visible") void markRead();
          if (!d.more) break;
        }
      } catch { /* the next tick retries */ }
      finally { polling.current = false; }
    };

    const startPolling = () => { if (!timer) timer = setInterval(() => void tick(), POLL_MS); };
    const stopPolling = () => { if (timer) { clearInterval(timer); timer = null; } };
    startPolling();

    const onRealtime = () => void tick();
    const onState = (e: Event) => {
      const connected = Boolean((e as CustomEvent<{ connected?: boolean }>).detail?.connected);
      if (connected) stopPolling(); else startPolling();
    };
    window.addEventListener(convoEventName(id), onRealtime);
    window.addEventListener(WINDOW_EVENTS.realtimeState, onState);
    return () => {
      stopPolling();
      window.removeEventListener(convoEventName(id), onRealtime);
      window.removeEventListener(WINDOW_EVENTS.realtimeState, onState);
    };
     
  }, [id, meId, markRead]);

  /* ── a failed send whose message actually landed ────────────── */

  // THE RETRY THAT WRITES THE MESSAGE TWICE. The POST's response can be lost
  // AFTER the row was committed: a connection dropped, or a gateway giving up
  // during the notification work the route does once its transaction is
  // through. The client cannot tell that from a send that never arrived, so
  // it marks the row "Not sent" and offers a Retry that would post the same
  // words a second time, and the outbox makes that offer survive the night.
  //
  // The poll brings the real row back, and that is the answer. My own
  // message, the same words, in the same place, created at or after the
  // moment the failed copy left this device: that is the copy this device
  // sent. Words typed twice on purpose have an EARLIER twin, never a later
  // one, so matching forward in time cannot swallow a deliberate repeat, and
  // either way the words are on screen in the copy the server actually has.
  useEffect(() => {
    // Never an unsaved edit: that row's id is a real message and its body is
    // a rewrite nobody has accepted yet.
    const ghostsIn = (rows: FeedMessage[]) =>
      rows.filter((m) => m.failed && !pendingEdits.current.has(m.id) && hasLandedCopy(rows, m));
    const ghosts = [...ghostsIn(messages), ...(thread ? ghostsIn(thread.replies) : [])];
    if (ghosts.length === 0) return;
    const gone = new Set(ghosts.map((g) => g.id));
    for (const g of gone) forgetFailedSend(id, g);
    setMessages((prev) => (prev.some((m) => gone.has(m.id)) ? prev.filter((m) => !gone.has(m.id)) : prev));
    setThread((prev) => (prev && prev.replies.some((m) => gone.has(m.id))
      ? { ...prev, replies: prev.replies.filter((m) => !gone.has(m.id)) }
      : prev));
  }, [messages, thread, id]);

  /* ── the roster, for the live-call chip ─────────────────────── */

  useEffect(() => {
    let alive = true;
    const refresh = () => { if (!document.hidden && alive) void loadMeta(true); };
    const t = setInterval(refresh, callOpen || meta?.activeCall ? ROSTER_IN_CALL_MS : ROSTER_MS);
    // A roster change arrives on the wire as call.changed, so the poll above
    // is only a backstop for a dropped stream.
    window.addEventListener(WINDOW_EVENTS.callChanged, refresh);
    window.addEventListener(WINDOW_EVENTS.callIncoming, refresh);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(WINDOW_EVENTS.callChanged, refresh);
      window.removeEventListener(WINDOW_EVENTS.callIncoming, refresh);
    };
  }, [loadMeta, callOpen, meta?.activeCall]);

  /* ── scroll ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = scrollRef.current;
    // A deep link owns the scroll position: the highlighted row scrolls itself
    // into view, and jumping to the bottom would undo that.
    if (el && stickToBottom.current && !highlightId) el.scrollTop = el.scrollHeight;
  }, [messages, loadedOnce, highlightId]);

  // The highlight is a 1.6s paint, not a permanent state.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(t);
  }, [highlightId]);

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
        const older: FeedMessage[] = (d.messages ?? []).map(keepUnsavedEdit);
        const el = scrollRef.current;
        const prevHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !seen.has(m.id)), ...prev];
        });
        setHasMore(Boolean(d.hasMore));
        requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
      }
    } finally { setLoadingOlder(false); }
  };

  /* ── sending ────────────────────────────────────────────────── */

  const deliver = useCallback(async (tempId: string, payload: {
    body: string; parentId?: string; metadata?: Record<string, unknown>;
  }, place: "top" | "thread", writtenAt: string) => {
    const applyFail = () => {
      // The words survive the page. Without this the "Not sent" row lived
      // only in React state, so switching conversation and coming back threw
      // somebody's message away with no prompt and no trace.
      //
      // `writtenAt` is when the message was WRITTEN, not when the send gave
      // up: a restored row has to sort where the person put it, and the
      // landed-copy check above compares against this moment.
      rememberFailedSend(id, {
        id: tempId,
        body: payload.body,
        parentId: payload.parentId ?? null,
        createdAt: writtenAt,
        metadata: payload.metadata,
      });
      if (place === "top") setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      else {
        setThread((prev) => prev ? { ...prev, replies: prev.replies.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)) } : prev);
        // The optimistic +1 on the parent's reply chip must not survive a
        // failed reply.
        const parentId = threadRef.current?.parentId;
        if (parentId) setMessages((prev) => prev.map((m) => (m.id === parentId ? { ...m, replyCount: Math.max(0, (m.replyCount ?? 1) - 1) } : m)));
      }
      toast("Message not sent. It's still here with a Retry.", { tone: "danger" });
    };
    // Swap the temp for the server row, and drop any copy the poll delivered
    // first, so a slow POST cannot leave a duplicate.
    const applyOk = (server: FeedMessage) => {
      forgetFailedSend(id, tempId);
      const swap = (list: FeedMessage[]) =>
        list.filter((m) => m.id !== server.id || m.id === tempId).map((m) => (m.id === tempId ? { ...server } : m));
      if (place === "top") setMessages((prev) => swap(prev));
      else setThread((prev) => (prev ? { ...prev, replies: swap(prev.replies) } : prev));
    };
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        // keepalive so a send survives the tab being closed mid-flight: a
        // message typed and sent is never lost to a navigation.
        keepalive: true,
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.message) throw new Error("send failed");
      applyOk(d.message as FeedMessage);
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    } catch {
      applyFail();
    }
  }, [id, toast]);

  const buildOptimistic = (payload: MessagePayload, parentId?: string): FeedMessage => ({
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    body: payload.body,
    authorId: meId ?? "me",
    createdAt: new Date().toISOString(),
    parentId: parentId ?? null,
    metadata: {
      ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
      ...(payload.mentions.length > 0 ? { mentions: payload.mentions } : {}),
    },
    author: meLite,
    pending: true,
    replyCount: 0,
  });

  const wirePayload = (payload: MessagePayload, parentId?: string) => {
    const metadata: Record<string, unknown> = {};
    if (payload.attachments.length > 0) metadata.attachments = payload.attachments;
    if (payload.mentions.length > 0) metadata.mentions = payload.mentions;
    return {
      body: payload.body,
      ...(parentId ? { parentId } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  };

  const sendMain = (payload: MessagePayload) => {
    if (!payload.body && payload.attachments.length === 0) return;
    const temp = buildOptimistic(payload);
    setMessages((prev) => [...prev, temp]);
    stickToBottom.current = true;
    void deliver(temp.id, wirePayload(payload), "top", temp.createdAt);
  };

  const sendCallCard = (body: string) => {
    const temp: FeedMessage = { ...buildOptimistic({ body, mentions: [], attachments: [] }), metadata: { kind: "call" } };
    setMessages((prev) => [...prev, temp]);
    void deliver(temp.id, { body, metadata: { kind: "call" } }, "top", temp.createdAt);
  };

  const sendThreadReply = (payload: MessagePayload) => {
    const open = threadRef.current;
    if (!open || (!payload.body && payload.attachments.length === 0)) return;
    const temp = buildOptimistic(payload, open.parentId);
    setThread((prev) => (prev ? { ...prev, replies: [...prev.replies, temp] } : prev));
    setMessages((prev) => prev.map((m) => (m.id === open.parentId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m)));
    void deliver(temp.id, wirePayload(payload, open.parentId), "thread", temp.createdAt);
  };

  const retry = (m: FeedMessage) => {
    // An EDIT that would not save wears the same "Not sent · Retry · Delete"
    // row as a message that would not send, and on it Retry means "save my
    // rewrite". Posting it instead would push somebody's correction into the
    // conversation as a brand new message.
    const edit = pendingEdits.current.get(m.id);
    if (edit) { editMessage(m, edit.next); return; }
    const place = m.parentId ? "thread" : "top";
    const apply = (fn: (x: FeedMessage) => FeedMessage) => {
      if (place === "top") setMessages((prev) => prev.map((x) => (x.id === m.id ? fn(x) : x)));
      else setThread((prev) => prev ? { ...prev, replies: prev.replies.map((x) => (x.id === m.id ? fn(x) : x)) } : prev);
    };
    apply((x) => ({ ...x, pending: true, failed: false }));
    const payload: MessagePayload = {
      body: m.body,
      mentions: m.metadata?.mentions ?? [],
      attachments: m.metadata?.attachments ?? [],
    };
    if (m.metadata?.kind === "call") void deliver(m.id, { body: m.body, metadata: { kind: "call" } }, place, m.createdAt);
    else void deliver(m.id, wirePayload(payload, m.parentId ?? undefined), place, m.createdAt);
  };

  /** Throw away a message that will not send. Only ever a LOCAL temp row:
   *  nothing that reached the server is removed by this. */
  const discardFailed = (m: FeedMessage) => {
    if (!m.failed) return;
    forgetFailedSend(id, m.id);
    // An unsaved EDIT is thrown away by putting the saved words back, never
    // by dropping the row: the message itself is on the server, and removing
    // it here would take it off the screen until the next load and read as
    // "Delete threw my message away".
    const edit = pendingEdits.current.get(m.id);
    if (edit) {
      pendingEdits.current.delete(m.id);
      patchEverywhere(m.id, (x) => ({
        ...x,
        ...(edit.saved !== null ? { body: edit.saved, editedAt: edit.savedEditedAt } : {}),
        failed: false,
      }));
      return;
    }
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setThread((prev) => (prev ? { ...prev, replies: prev.replies.filter((x) => x.id !== m.id) } : prev));
  };

  /* ── reactions, edit, delete (optimistic with revert) ───────── */

  const patchEverywhere = (messageId: string, fn: (m: FeedMessage) => FeedMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? fn(m) : m)));
    setThread((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        parent: prev.parent && prev.parent.id === messageId ? fn(prev.parent) : prev.parent,
        replies: prev.replies.map((m) => (m.id === messageId ? fn(m) : m)),
      };
    });
  };

  const react = (m: FeedMessage, emoji: string) => {
    if (!meId || m.pending || m.failed || !reactable) return;
    const before = m.metadata?.reactions ?? {};
    const users = before[emoji] ?? [];
    const nextUsers = users.includes(meId) ? users.filter((u) => u !== meId) : [...users, meId];
    const next = { ...before };
    if (nextUsers.length > 0) next[emoji] = nextUsers; else delete next[emoji];
    patchEverywhere(m.id, (x) => ({ ...x, metadata: { ...x.metadata, reactions: next } }));
    fetch(`/api/conversations/${id}/messages/${m.id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        patchEverywhere(m.id, (x) => ({ ...x, metadata: { ...x.metadata, reactions: d.reactions ?? {} } }));
      })
      .catch(() => {
        // Revert ONLY my toggle: a wholesale snapshot restore would wipe
        // reactions other people added while the request was in flight.
        patchEverywhere(m.id, (x) => {
          const cur = { ...(x.metadata?.reactions ?? {}) };
          const list = cur[emoji] ?? [];
          const mine = list.includes(meId);
          const reverted = mine ? list.filter((u) => u !== meId) : [...list, meId];
          if (reverted.length > 0) cur[emoji] = reverted; else delete cur[emoji];
          return { ...x, metadata: { ...x.metadata, reactions: cur } };
        });
        toast("Couldn't add the reaction", { tone: "danger" });
      });
  };

  /** AN EDIT THAT WILL NOT SAVE KEEPS THE WORDS THAT WERE TYPED.
   *
   *  This used to put the old body back and toast, which threw the rewrite
   *  away: the message row closes its editor before the request is made, and
   *  re-opening it seeds the field from the body on screen, so the paragraph
   *  somebody had just written existed nowhere they could reach. The route
   *  refuses for ordinary reasons too (a body over the length limit, the
   *  conversation archived or access changed while the editor was open, the
   *  message removed elsewhere), so this is not only a dropped-packet case.
   *
   *  A failed edit is now held exactly the way a failed send is: the new
   *  words stay on screen, the row says they are not sent, Retry saves them
   *  again, Delete puts the saved words back, and the outbox carries the
   *  whole thing across a reload. */
  const editMessage = (m: FeedMessage, newBody: string) => {
    // What Delete restores is the SERVER's words, which on a retry are not
    // the ones currently on screen.
    const held = pendingEdits.current.get(m.id);
    const savedBody = held ? held.saved : m.body;
    const savedEditedAt = held ? held.savedEditedAt : (m.editedAt ?? null);
    // Held from the first keystroke of the request, not just from its
    // failure: a poll answering mid-PATCH would otherwise paint the saved
    // words back over the rewrite while it was still on its way.
    pendingEdits.current.set(m.id, { next: newBody, saved: savedBody, savedEditedAt, saving: true });
    patchEverywhere(m.id, (x) => ({ ...x, body: newBody, editedAt: new Date().toISOString(), failed: false }));
    fetch(`/api/conversations/${id}/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        pendingEdits.current.delete(m.id);
        // Only touch storage if there was something stored to forget: every
        // edit passes through here, and most of them never failed.
        if (held) forgetFailedSend(id, m.id);
      })
      .catch(() => {
        const latest = pendingEdits.current.get(m.id);
        pendingEdits.current.set(m.id, {
          next: newBody,
          // The poll may have refreshed what the server holds while the
          // PATCH was in flight; that, not the pre-request copy, is what
          // Delete should put back.
          saved: latest ? latest.saved : savedBody,
          savedEditedAt: latest ? latest.savedEditedAt : savedEditedAt,
          saving: false,
        });
        rememberFailedSend(id, {
          id: m.id,
          body: newBody,
          parentId: m.parentId ?? null,
          createdAt: new Date().toISOString(),
          editOf: m.id,
        });
        patchEverywhere(m.id, (x) => ({ ...x, body: newBody, failed: true }));
        toast("Edit not saved. It's still here with a Retry.", { tone: "danger" });
      });
  };

  const deleteMessage = (m: FeedMessage) => {
    setDeleteTarget(null);
    const oldDeletedAt = m.deletedAt;
    patchEverywhere(m.id, (x) => ({ ...x, deletedAt: new Date().toISOString() }));
    fetch(`/api/conversations/${id}/messages/${m.id}`, { method: "DELETE", keepalive: true })
      .then((r) => {
        if (!r.ok) throw new Error();
        // Removing the message is a decision about its words, the unsaved
        // rewrite of them included: kept, the edit would be a stored entry no
        // row can ever show again. Only once the delete has actually
        // happened, so a refused one leaves the rewrite where it was.
        if (pendingEdits.current.delete(m.id)) forgetFailedSend(id, m.id);
      })
      .catch(() => {
        patchEverywhere(m.id, (x) => ({ ...x, deletedAt: oldDeletedAt ?? null }));
        toast("Couldn't remove the message", { tone: "danger" });
      });
  };

  /* ── threads ────────────────────────────────────────────────── */

  /** Open a thread by id. `known` is the parent message when the caller has
   *  it (a click in the feed); a URL has only an id, and then the panel shows
   *  a loading state until the fetch answers rather than rendering a stub.
   *
   *  The stub is what crashed ?m= on a reply: `{ id } as FeedMessage` reached
   *  the feed, which read `msg.author.firstName` off it and took the page
   *  down. A parent that is not loaded yet is null, and null renders as
   *  "loading" rather than as a message. */
  const openThreadById = useCallback(async (parentId: string, fromUrl = false, known?: FeedMessage) => {
    setPanel("thread");
    setThread({ parentId, parent: known ?? null, replies: [], loading: true });
    if (!fromUrl) writeUrl({ thread: parentId });
    try {
      const r = await fetch(`/api/conversations/${id}/messages?parent=${parentId}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      adoptStoredEdits();
      const fetched: FeedMessage[] = (d.messages ?? []).map(keepUnsavedEdit);
      const parent: FeedMessage | null = d.parent ? keepUnsavedEdit({ ...d.parent }) : null;
      // A REPLY THAT FAILED TO SEND LIVES HERE OR NOWHERE. It is stored per
      // conversation with its parent on it, and this panel is the only place
      // it can be shown in context, so it is rebuilt from the outbox on every
      // open: closing the panel and reopening it used to be enough to take
      // the words off the screen for good, with the entry still on disk and
      // no screen left that could render it.
      const stranded = restoreOutboxReplies(parentId);
      setThread((prev) => {
        if (!prev || prev.parentId !== parentId) return prev;
        const seen = new Set(fetched.map((x: FeedMessage) => x.id));
        // A reply sent while this fetch was in flight lives only in local
        // state. Keep it.
        const inFlight = prev.replies.filter((x) => (x.pending || x.failed) && !seen.has(x.id));
        const restored = stranded.filter((x) => !seen.has(x.id) && !inFlight.some((y) => y.id === x.id));
        return {
          parentId,
          parent: parent ?? prev.parent,
          replies: [...fetched, ...inFlight, ...restored],
          loading: false,
        };
      });
    } catch {
      // Even a thread that will not load must not swallow the replies this
      // device is still holding for it.
      const stranded = restoreOutboxReplies(parentId);
      setThread((prev) => (prev && prev.parentId === parentId
        ? { ...prev, replies: [...prev.replies, ...stranded.filter((x) => !prev.replies.some((y) => y.id === x.id))], loading: false }
        : prev));
      toast("Couldn't load the thread", { tone: "danger" });
    }
  }, [id, writeUrl, toast, adoptStoredEdits, keepUnsavedEdit, restoreOutboxReplies]);

  const openThread = useCallback(
    (m: FeedMessage) => openThreadById(m.id, false, m),
    [openThreadById],
  );

  // ?thread=<id> on arrival.
  const urlThreadRef = useRef(false);
  useEffect(() => {
    if (!initialThread || urlThreadRef.current || !loadedOnce) return;
    urlThreadRef.current = true;
    void openThreadById(initialThread, true, messages.find((m) => m.id === initialThread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThread, loadedOnce]);

  /* ── calls ──────────────────────────────────────────────────── */

  // "Does this deployment have a media server at all." One cheap read (no
  // database, no media server) whose job is to keep the product from
  // promising a call it cannot place. `null` means "not answered yet", and
  // NOTHING to do with a call happens while it is null: not the dock, not
  // the card, not the dialog.
  //
  // THE RACE THIS CLOSED, which was writing permanent history. The guard
  // used to live inside a render-body closure that `startCall` captured in a
  // useCallback whose dependency array (eslint-disabled) omitted it, and the
  // ?call= effect fired the moment `meta && loadedOnce` were true. A stored
  // /tlk/<id>?call=video link, an incoming-call notification's Join or the
  // sidebar's Start call therefore beat the status fetch and posted a
  // "Started a call" card, with a live blue Join, into the channel's history
  // for ever, on a workspace where no call could connect. Waiting for the
  // answer costs one render; the card it wrote could not be taken back.
  const [callsConfigured, setCallsConfigured] = useState<boolean | null>(null);
  const [callsOffOpen, setCallsOffOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/calls/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setCallsConfigured(d && typeof d.configured === "boolean" ? d.configured : true); })
      .catch(() => { if (alive) setCallsConfigured(true); });
    return () => { alive = false; };
  }, []);

  const freshActiveCall = meta?.activeCall && Date.now() - new Date(meta.activeCall.startedAt).getTime() < LIVE_CALL_MAX_MS
    ? meta.activeCall
    : null;

  /** Post the call card unless one is already standing: a LIVE call needs no
   *  second card, and only an UN-ENDED recent card suppresses, so a call that
   *  finished five minutes ago does not swallow the next call's card. */
  const maybePostCard = useCallback((audioOnly: boolean) => {
    if (meta?.activeCall) return;
    const recentOpen = [...messages].reverse().find((m) => m.metadata?.kind === "call" && !m.metadata?.endedAt);
    const recentMs = recentOpen ? Date.now() - new Date(recentOpen.createdAt).getTime() : Infinity;
    if (recentMs > 10 * 60 * 1000) sendCallCard(audioOnly ? "Started an audio call" : "Started a call");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.activeCall, messages]);

  const startCall = useCallback((audioOnly: boolean) => {
    if (meta && !canCall(meta, role)) return;
    // Not answered yet: do nothing at all rather than guess. The ?call=
    // effect below re-runs as soon as the answer lands.
    if (callsConfigured === null) return;
    // spec-talk 2.6 States: with no media server the Call button opens a 400
    // dialog and "the dock never mounts". No global call is started, so no
    // card is posted either.
    if (callsConfigured === false) { setCallsOffOpen(true); return; }
    const already = activeCall?.conversationId === id;
    startGlobalCall({ conversationId: id, subject: title, displayName: myName, audioOnly, href: `/tlk/${id}` });
    if (!already) maybePostCard(audioOnly);
  }, [meta, role, callsConfigured, activeCall, id, title, myName, startGlobalCall, maybePostCard]);

  // ?call=video, ?call=audio, and ?call=1 for links minted before the rename.
  // It waits for callsConfigured as well as for the conversation: a stored
  // link must not be able to outrun the one question that decides whether a
  // call is possible.
  const urlCallRef = useRef(false);
  useEffect(() => {
    if (!initialCall || urlCallRef.current || !meta || !loadedOnce || callsConfigured === null) return;
    urlCallRef.current = true;
    startCall(initialCall === "audio");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCall, meta, loadedOnce, callsConfigured]);

  // The sidebar's Start call on the ALREADY-OPEN conversation: a query-only
  // push never remounts this component, so it arrives as an event.
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id === id) startCall(false);
    };
    window.addEventListener(TALK_START_CALL_EVENT, onStart);
    return () => window.removeEventListener(TALK_START_CALL_EVENT, onStart);
  }, [id, startCall]);

  const copyGuestLink = () => {
    setCallMenuOpen(false);
    const url = meta?.call?.guestUrl;
    if (!url) { toast("No guest link for this conversation", { tone: "danger" }); return; }
    void navigator.clipboard.writeText(url);
    toast("Guest link copied");
  };

  const resetGuestLink = async () => {
    setCallMenuOpen(false);
    const res = await fetch(`/api/conversations/${id}/rotate-call`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const d = await res.json().catch(() => null);
      if (d?.call) setMeta((prev) => (prev ? { ...prev, call: d.call } : prev));
      else void loadMeta(true);
      toast("Guest link reset. Every earlier link is dead.");
    } else toast("Couldn't reset the link", { tone: "danger" });
  };

  /* ── conversation actions ───────────────────────────────────── */

  const myMember = meta?.members.find((m) => m.userId === meId);
  const myNotify = (myMember?.notifyLevel ?? (meta?.type === "CHANNEL" ? "mentions" : "all")) as "all" | "mentions" | "mute";
  const myStarred = myMember?.starred ?? false;

  const patchConversation = useCallback(async (body: Record<string, unknown>, failMessage: string): Promise<boolean> => {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => null);
    if (res?.ok) return true;
    const d = res ? await res.json().catch(() => null) : null;
    toast(d?.error || failMessage, { tone: "danger" });
    return false;
  }, [id, toast]);

  const toggleStar = async () => {
    setMenuOpen(false);
    const next = !myStarred;
    setMeta((prev) => prev ? { ...prev, members: prev.members.map((m) => (m.userId === meId ? { ...m, starred: next } : m)) } : prev);
    const ok = await patchConversation({ starred: next }, "Couldn't update the star");
    if (ok) {
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      toast(next ? "Added to Starred" : "Removed from Starred");
    } else {
      setMeta((prev) => prev ? { ...prev, members: prev.members.map((m) => (m.userId === meId ? { ...m, starred: !next } : m)) } : prev);
    }
  };

  const setNotify = async (level: "all" | "mentions" | "mute") => {
    setMenuOpen(false);
    const before = myNotify;
    setMeta((prev) => prev ? { ...prev, members: prev.members.map((m) => (m.userId === meId ? { ...m, notifyLevel: level } : m)) } : prev);
    const ok = await patchConversation({ notifyLevel: level }, "Couldn't update notifications");
    if (!ok) {
      setMeta((prev) => prev ? { ...prev, members: prev.members.map((m) => (m.userId === meId ? { ...m, notifyLevel: before } : m)) } : prev);
    }
  };

  const doRename = async (name: string) => {
    setRenameOpen(false);
    const ok = await patchConversation({ name }, "Couldn't rename");
    if (ok) {
      setMeta((prev) => (prev ? { ...prev, name: name.trim().replace(/^#/, "") } : prev));
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    }
  };

  const saveTopic = async (topic: string): Promise<boolean> => {
    const ok = await patchConversation({ topic: topic || null }, "Couldn't save the topic");
    if (ok) setMeta((prev) => (prev ? { ...prev, topic: topic || null } : prev));
    return ok;
  };

  const setVisibility = async (patch: { restricted?: boolean; findable?: boolean }) => {
    const before = { restricted: meta?.restricted, findable: meta?.findable };
    setMeta((prev) => (prev ? { ...prev, ...patch } : prev));
    const ok = await patchConversation(patch, "Couldn't change who can reach this channel");
    if (ok) window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    else setMeta((prev) => (prev ? { ...prev, ...before } as ConversationMeta : prev));
  };

  const doArchive = async (next: boolean) => {
    setConfirmArchive(null);
    const ok = await patchConversation({ archived: next }, next ? "Couldn't archive the channel" : "Couldn't restore the channel");
    if (ok) {
      setMeta((prev) => (prev ? { ...prev, archivedAt: next ? new Date().toISOString() : null } : prev));
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      toast(next ? "Channel archived. Its history stays." : "Channel restored");
    }
  };

  const doRemoveMember = async () => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    const res = await fetch(`/api/conversations/${id}/members/${target.userId}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setMeta((prev) => (prev ? { ...prev, members: prev.members.filter((m) => m.userId !== target.userId) } : prev));
      toast(`${target.name} removed`);
    } else {
      const d = res ? await res.json().catch(() => null) : null;
      toast(d?.error || "Couldn't remove them", { tone: "danger" });
    }
  };

  const doTransfer = async () => {
    const target = transferTarget;
    setTransferTarget(null);
    if (!target) return;
    const res = await fetch(`/api/conversations/${id}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: target.userId }),
    }).catch(() => null);
    if (res?.ok) {
      setMeta((prev) => (prev ? { ...prev, createdById: target.userId } : prev));
      toast(`${target.name} owns this conversation now`);
      void loadMeta(true);
    } else {
      const d = res ? await res.json().catch(() => null) : null;
      toast(d?.error || "Couldn't transfer it", { tone: "danger" });
    }
  };

  /** Slack's Close on a DM: hide the row, keep every message. Reachable from
   *  this menu at every width, which is what the sidebar's hover-only X and
   *  right-click menu could not be (the sidebar is zero wide under 1024). */
  const closeDm = async () => {
    const ok = await patchConversation({ hidden: true }, "Couldn't close the conversation");
    if (ok) {
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      toast("Conversation closed, history is kept");
      router.push("/tlk");
    }
  };

  const leave = async () => {
    setConfirmLeave(false);
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      try { sessionStorage.setItem(talkLeftKey(id), "1"); } catch { /* private mode */ }
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      router.push("/tlk");
    } else {
      const d = res ? await res.json().catch(() => null) : null;
      toast(d?.error || "Couldn't leave the conversation", { tone: "danger" });
    }
  };

  const openMessage = (messageId: string) => {
    const known = messages.find((m) => m.id === messageId);
    if (known) { setHighlightId(messageId); return; }
    // Not in the window we are holding: reload the feed around it.
    router.push(`/tlk/${id}?m=${encodeURIComponent(messageId)}`);
  };

  const copyMessageLink = (m: FeedMessage) => {
    const url = `${window.location.origin}/tlk/${id}?m=${encodeURIComponent(m.id)}`;
    void navigator.clipboard.writeText(url);
    toast("Link copied");
  };

  /* ── keyboard: Cmd-F opens Search ───────────────────────────── */

  // Registered in the ONE registry (spec-talk section 1 Keyboard), so the ?
  // overlay and /account/shortcuts list exactly the chords that work. It was
  // a bare window listener with no focus check, which meant it swallowed the
  // browser's own Find on every ⌘F anywhere on the page, including while the
  // rail or the workspace switcher had focus. It also fired from inside the
  // /tlk detail pane, where the panel it opens is not this component's.
  //
  // `inInputs` is on because the message box is a textarea and searching the
  // conversation you are writing in is the obvious thing to want; the scope
  // is the page, so the pane (embedded) does not take it.
  useShortcut(
    {
      id: "talk.search-conversation",
      keys: "mod+f",
      label: "Search in this conversation",
      scope: "page",
      group: "On this page",
      inInputs: true,
      run: (e) => {
        e.preventDefault();
        setPanelFiles(false);
        setPanel("search");
      },
    },
    !embedded,
  );

  /* ── render ─────────────────────────────────────────────────── */

  if (metaError) {
    return (
      <OsEmptyView
        title="Couldn't open this conversation"
        hint="It may have been left, archived or removed."
        variant="error"
        action={{ label: "Retry", onClick: () => void loadMeta() }}
      />
    );
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col">
        <div className="h-14 shrink-0 border-b border-line-soft px-4 py-4">
          <span className="block h-4 w-32 animate-pulse rounded bg-hover" />
        </div>
        <div className="flex-1 p-4"><SkeletonRows rows={6} rowHeight="44px" /></div>
      </div>
    );
  }

  // Someone standing on a findable channel they have not joined: the page
  // renders the Join screen, so there is nothing for this view to draw.
  if (meta.role === "none") return null;

  const others = meta.members.filter((m) => m.userId !== meId);
  const banner = readOnlyReason(meta, role, meta.owner?.name ?? null);
  // The other person's title and department, for the DM start-of-history
  // block. Either half may be missing; the line is dropped when both are.
  const dmOther = meta.type === "DM" ? others[0]?.user : undefined;
  const dmSubtitle = [dmOther?.role?.title, dmOther?.department?.name].filter(Boolean).join(" · ");

  const menuItem = "flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-ink hover:bg-subtle";

  return (
    <div className="tlkc relative bg-raised">
      <header className="tlkc__hdr flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-4">
        {/* The label is CSS-hidden under 640 (os.css .tlkc__hdr-label), not
            dropped: the aria-label and the tooltip still say "Back to Talk". */}
        {!embedded ? <BackButton fallbackHref="/tlk" label="Talk" className="tlkc__hdr-back" /> : null}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover">
          {meta.type === "DM" && others[0] ? (
            <TeamAvatar name={`${others[0].user.firstName} ${others[0].user.lastName}`} avatar={others[0].user.avatar} size={28} />
          ) : (
            <ConversationGlyph type={meta.type} restricted={meta.restricted} size={16} />
          )}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink-strong">{title}</h1>

        {meta.type !== "DM" ? (
          <button
            type="button"
            onClick={() => { setPanel("details"); setPanelFiles(false); }}
            title={`${meta.members.length} members`}
            aria-label={`${meta.members.length} members, open details`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line ps-1.5 pe-2 hover:bg-subtle"
          >
            <span className="flex -space-x-1.5">
              {meta.members.slice(0, 3).map((m) => (
                <TeamAvatar key={m.userId} name={`${m.user.firstName} ${m.user.lastName}`} avatar={m.user.avatar} size={20} />
              ))}
            </span>
            <span className="text-xs font-medium tabular-nums text-ink-2">{meta.members.length}</span>
          </button>
        ) : null}

        {freshActiveCall && !callOpen && canCall(meta, role) ? (
          <button
            type="button"
            onClick={() => startCall(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium text-ink hover:bg-hover"
            title={freshActiveCall.participants.map((p) => p.name).join(", ")}
          >
            <Dots variant="live" />
            {freshActiveCall.participants.length} in call
            <span className="text-[var(--os-brand-deep)]">Join</span>
          </button>
        ) : null}

        {/* SHARE, channels only, to the left of Call (spec 2.2 item 6).
            Every control it names already existed, in the Details panel:
            Restricted, Findable, the member roles and Add people. What did
            not exist was the WORD. A person looking for "Share" on a channel
            found nothing anywhere in Talk, so this is the door, and it opens
            the panel that holds the controls rather than duplicating them.
            Flagged in the handover: the one share dialog
            (src/components/access/share-dialog.tsx) has no channel body yet,
            and building one is the access unit's step 5. */}
        {meta.type === "CHANNEL" && canAddPeople(meta, role) ? (
          <button
            type="button"
            onClick={() => { setPanel("details"); setPanelFiles(false); }}
            title="Share this channel"
            className="tlkc__hdr-share inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        ) : null}

        {canCall(meta, role) ? (
          <div className="relative flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => (callOpen ? startCall(false) : startCall(false))}
              title={callOpen ? "You're on this call" : "Start a video call"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-s-md border border-line-strong px-2.5 text-sm font-medium ${
                callOpen ? "text-ink-2" : "text-ink hover:bg-hover"
              }`}
            >
              {callOpen ? <Dots variant="live" /> : <Phone className="h-4 w-4" />}
              <span className="tlkc__hdr-label">{callOpen ? "In call" : "Call"}</span>
            </button>
            <button
              type="button"
              onClick={() => setCallMenuOpen((v) => !v)}
              aria-label="Call options"
              aria-expanded={callMenuOpen}
              className="inline-flex h-8 w-6 items-center justify-center rounded-e-md border border-s-0 border-line-strong text-ink-2 hover:bg-hover"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {callMenuOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCallMenuOpen(false)} />
                <div className="absolute end-0 top-9 z-20 w-56 rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
                  <button type="button" className={menuItem} onClick={() => { setCallMenuOpen(false); startCall(false); }}>
                    <Video className="h-4 w-4 text-ink-3" /> Video call
                  </button>
                  <button type="button" className={menuItem} onClick={() => { setCallMenuOpen(false); startCall(true); }}>
                    <Phone className="h-4 w-4 text-ink-3" /> Audio call
                  </button>
                  {canCopyGuestLink(meta, role) ? (
                    <>
                      <span className="my-1 block h-px bg-line-soft" />
                      <button type="button" className={menuItem} onClick={copyGuestLink}>
                        <Link2 className="h-4 w-4 text-ink-3" /> Copy guest link
                      </button>
                      {canResetGuestLink(meta, role) ? (
                        <button type="button" className={menuItem} onClick={() => void resetGuestLink()}>
                          <RefreshCw className="h-4 w-4 text-ink-3" /> Reset guest link
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Conversation options"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-subtle hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute end-0 top-9 z-20 w-56 rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
                <button type="button" onClick={() => void toggleStar()} className={menuItem}>
                  <Star className={`h-4 w-4 ${myStarred ? "fill-[var(--os-warning-solid)] text-[var(--os-warning-solid)]" : "text-ink-3"}`} />
                  {myStarred ? "Remove star" : "Star"}
                </button>
                {/* NOTIFICATIONS, THE THREE-STATE, not a Mute toggle.
                    naming-canon retires the word "Mute" as a control label in
                    favour of "Notifications: All messages / Mentions only /
                    Muted", and the Details panel already offered all three, so
                    the menu and the panel were naming the same setting two
                    different ways and offering two thirds of it. */}
                <div
                  className="relative"
                  onMouseEnter={() => setNotifySubOpen(true)}
                  onMouseLeave={() => setNotifySubOpen(false)}
                >
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={notifySubOpen}
                    onClick={() => setNotifySubOpen((v) => !v)}
                    className={menuItem}
                  >
                    <Bell className="h-4 w-4 text-ink-3" />
                    <span className="flex-1">Notifications</span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink-3 rtl:rotate-180" />
                  </button>
                  {notifySubOpen ? (
                    <div className="absolute end-full top-0 z-30 me-1 w-48 rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
                      {NOTIFY_LEVELS.map((lvl) => (
                        <button
                          key={lvl.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={myNotify === lvl.value}
                          onClick={() => { setNotifySubOpen(false); void setNotify(lvl.value); }}
                          className={menuItem}
                        >
                          <Check className={`h-4 w-4 ${myNotify === lvl.value ? "text-[var(--os-brand)]" : "text-transparent"}`} />
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button type="button" onClick={() => { setMenuOpen(false); setPanel("details"); setPanelFiles(false); }} className={menuItem}>
                  <Info className="h-4 w-4 text-ink-3" /> Details
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); setPanelFiles(false); setPanel("search"); }} className={menuItem}>
                  <SearchIcon className="h-4 w-4 text-ink-3" /> Search in conversation
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void navigator.clipboard.writeText(`${window.location.origin}/tlk/${id}`);
                    toast("Link copied");
                  }}
                  className={menuItem}
                >
                  <Link2 className="h-4 w-4 text-ink-3" /> Copy link
                </button>
                {/* The separator the spec puts before the management half, so
                    Copy link and Add people are not read as one group. */}
                {canAddPeople(meta, role) || canRename(meta, role) || canEditTopic(meta, role) || canArchive(meta, role) ? (
                  <span className="my-1 block h-px bg-line-soft" />
                ) : null}
                {canAddPeople(meta, role) ? (
                  <button type="button" onClick={() => { setMenuOpen(false); setAddPeopleOpen(true); }} className={menuItem}>
                    <UserPlus className="h-4 w-4 text-ink-3" /> Add people
                  </button>
                ) : null}
                {canRename(meta, role) ? (
                  <button type="button" onClick={() => { setMenuOpen(false); setRenameOpen(true); }} className={menuItem}>
                    <Pencil className="h-4 w-4 text-ink-3" /> {meta.type === "CHANNEL" ? "Rename channel" : "Rename group"}
                  </button>
                ) : null}
                {/* Edit topic was in the Details panel only, on a hover pencil
                    that a touch pointer never reveals. It is a named row in
                    spec 2.2's menu, so it is one here too. */}
                {canEditTopic(meta, role) ? (
                  <button type="button" onClick={() => { setMenuOpen(false); setTopicOpen(true); }} className={menuItem}>
                    <Tag className="h-4 w-4 text-ink-3" /> Edit topic
                  </button>
                ) : null}
                {canArchive(meta, role) ? (
                  <button type="button" onClick={() => { setMenuOpen(false); setConfirmArchive(!archived); }} className={menuItem}>
                    <X className="h-4 w-4 text-ink-3" /> {archived ? "Restore channel" : "Archive channel"}
                  </button>
                ) : null}
                {canLeave(meta, { userId: meId ?? "", orgRole: "MEMBER", isMember: Boolean(myMember) }) ? (
                  <>
                    <span className="my-1 block h-px bg-line-soft" />
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); setConfirmLeave(true); }}
                      className="flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-danger-text hover:bg-danger-bg"
                    >
                      <LogOut className="h-4 w-4" /> {meta.type === "CHANNEL" ? "Leave channel" : "Leave group"}
                    </button>
                  </>
                ) : null}
                {/* CLOSE, DMs only (spec 2.2). It existed only on the sidebar
                    row's right-click menu and on an X that is display:none at
                    rest, so under 1024, where the sidebar collapses to zero,
                    a person could not close a conversation at all. */}
                {meta.type === "DM" ? (
                  <>
                    <span className="my-1 block h-px bg-line-soft" />
                    <button type="button" onClick={() => { setMenuOpen(false); void closeDm(); }} className={menuItem}>
                      <X className="h-4 w-4 text-ink-3" /> Close
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="tlkc__body relative" data-panel={panel ?? "none"}>
        <div className="flex min-h-0 min-w-0 flex-col">
          {banner ? (
            <p role="status" className="m-0 border-b border-line-soft bg-subtle px-4 py-2 text-sm text-ink-2">{banner}</p>
          ) : null}

          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {hasMore && !feedFailed ? (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
                >
                  {loadingOlder ? <Dots variant="pending" label="Loading earlier messages" /> : "Show earlier messages"}
                </button>
              </div>
            ) : null}

            {!loadedOnce ? (
              <SkeletonRows rows={6} rowHeight="44px" />
            ) : feedFailed ? (
              // NEVER the start-of-history block. A failed read is an error,
              // not an empty conversation (comms #21).
              <OsEmptyView
                title="Couldn't load messages"
                hint="Your messages are safe. This was a problem reading them."
                variant="error"
                action={{ label: "Retry", onClick: () => void loadFeed() }}
              />
            ) : (
              <>
                {/* START OF HISTORY (spec 2.2). The CHANNEL is the subject of
                    a channel's block, so it wears the channel glyph, not four
                    member faces: a row of avatars above "This is the start of
                    #sales" read as though a person were. The creation line
                    was missing entirely, and on a DM so were the other
                    person's title, department and profile link. */}
                {!hasMore ? (
                  <div className="pb-3 pt-2">
                    {meta.type === "DM" && others[0] ? (
                      <>
                        <div className="flex items-center gap-1 pb-3">
                          <TeamAvatar
                            name={`${others[0].user.firstName} ${others[0].user.lastName}`}
                            avatar={others[0].user.avatar}
                            size={40}
                          />
                        </div>
                        <p className="m-0 text-base text-ink">
                          This is the start of your conversation with{" "}
                          <span className="font-semibold">{`${others[0].user.firstName} ${others[0].user.lastName}`.trim()}</span>.
                        </p>
                        {dmSubtitle ? <p className="m-0 mt-1 text-sm text-ink-2">{dmSubtitle}</p> : null}
                        <a href={`/people/${others[0].userId}`} className="mt-1 inline-block text-sm font-medium text-[var(--os-brand-deep)] hover:underline">
                          View profile
                        </a>
                      </>
                    ) : (
                      <>
                        <div className="pb-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-hover text-ink-2">
                            <ConversationGlyph type={meta.type} restricted={meta.restricted} size={20} />
                          </span>
                        </div>
                        <p className="m-0 text-base text-ink">
                          This is the start of <span className="font-semibold">{title}</span>.
                        </p>
                        {meta.topic ? <p className="m-0 mt-1 text-sm text-ink-2">{meta.topic}</p> : null}
                        {meta.owner?.name || meta.createdAt ? (
                          <p className="m-0 mt-1 text-xs text-ink-3">
                            {meta.owner?.name ? `Created by ${meta.owner.name}` : "Created"}
                            {meta.createdAt ? ` · ${fmt.date(meta.createdAt, "date")}` : ""}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {messages.length > 0 ? (
                  <MessageFeed
                    messages={messages}
                    meId={meId}
                    memberNames={memberNames}
                    onRetry={retry}
                    onJoinCall={() => startCall(false)}
                    onReact={react}
                    onEdit={editMessage}
                    onDelete={setDeleteTarget}
                    onOpenThread={(m) => void openThread(m)}
                    onCopyLink={copyMessageLink}
                    onDiscardFailed={discardFailed}
                    activeCall={freshActiveCall}
                    highlightId={highlightId}
                    readOnly={!writable}
                    canReact={reactable}
                  />
                ) : null}
              </>
            )}
          </div>

          {writable ? (
            <div className="shrink-0 px-4 pb-4 pt-1">
              <MessageBox
                members={meta.members}
                meId={meId}
                placeholder={`Message ${title}`}
                sendVariant={primarySend ? "primary" : "ghost"}
                onSend={sendMain}
                onError={(msg) => toast(msg, { tone: "danger" })}
                onJumpToLast={() => {
                  // ArrowUp in an empty box takes me back to the last thing I
                  // said: the row scrolls itself into view and paints for a
                  // moment. Editing it is the row's own "…" menu.
                  const mine = [...messages].reverse().find((m) => m.authorId === meId && !m.deletedAt && !m.pending);
                  if (mine) setHighlightId(mine.id);
                }}
              />
            </div>
          ) : null}
        </div>

        {panel === "thread" && thread ? (
          <RightPanel title="Thread" subtitle={`in ${title}`} onClose={closePanel}>
            <ThreadView
              parent={thread.parent}
              replies={thread.replies}
              meId={meId}
              memberNames={memberNames}
              members={meta.members}
              canWrite={reactable}
              loading={thread.loading}
              onSend={sendThreadReply}
              onReact={react}
              onEdit={editMessage}
              onDelete={setDeleteTarget}
              onRetry={retry}
              onDiscardFailed={discardFailed}
              onError={(msg) => toast(msg, { tone: "danger" })}
            />
          </RightPanel>
        ) : null}

        {panel === "details" ? (
          <RightPanel title={title} subtitle="Details" onClose={closePanel}>
            <DetailsPanel
              conversation={meta}
              role={role}
              meId={meId}
              myNotify={myNotify}
              onChangeNotify={(v) => void setNotify(v)}
              onSaveTopic={saveTopic}
              onSetVisibility={(p) => void setVisibility(p)}
              onRemoveMember={(userId, name) => setRemoveTarget({ userId, name })}
              onTransfer={(userId, name) => setTransferTarget({ userId, name })}
              onArchive={(next) => setConfirmArchive(next)}
              onAddPeople={() => setAddPeopleOpen(true)}
              onCopyGuestLink={copyGuestLink}
              onResetGuestLink={() => void resetGuestLink()}
              onOpenSearch={() => { setPanelFiles(true); setPanel("search"); }}
            />
          </RightPanel>
        ) : null}

        {panel === "search" ? (
          <RightPanel title={`Search in ${title}`} onClose={closePanel}>
            <SearchPanel
              conversationId={id}
              members={meta.members}
              initialFiles={panelFiles}
              onOpenMessage={(mid) => { openMessage(mid); }}
            />
          </RightPanel>
        ) : null}
      </div>

      {addPeopleOpen ? (
        <AddPeopleDialog
          conversationId={id}
          existingMemberIds={meta.members.map((m) => m.userId)}
          onClose={() => setAddPeopleOpen(false)}
          onAdded={(count) => {
            setAddPeopleOpen(false);
            toast(count === 1 ? "1 person added" : `${count} people added`);
            window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
            void loadMeta(true);
          }}
        />
      ) : null}

      <PromptDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        onSubmit={(v) => void doRename(v)}
        title={meta.type === "CHANNEL" ? "Rename channel" : "Rename group"}
        defaultValue={meta.name ?? ""}
        placeholder={meta.type === "CHANNEL" ? "sales" : "Launch group"}
        submitLabel="Rename"
      />

      <PromptDialog
        open={topicOpen}
        onClose={() => setTopicOpen(false)}
        onSubmit={(v) => { setTopicOpen(false); void saveTopic(v.trim()); }}
        title="Edit topic"
        defaultValue={meta.topic ?? ""}
        placeholder="What this channel is for"
        submitLabel="Save topic"
      />

      {/* spec-talk 2.6 States: with no media server the Call button opens a
          400 dialog and the dock never mounts. Owners and Admins are told
          what to do about it and where; everybody else is told who to ask,
          and neither is told a call is connecting. */}
      <ConfirmDialog
        open={callsOffOpen}
        onClose={() => setCallsOffOpen(false)}
        onConfirm={() => {
          setCallsOffOpen(false);
          if (isAdmin) router.push("/settings/apps");
        }}
        title="Calls aren't set up for this workspace"
        description={isAdmin
          ? "Calls run on your own server. Add the LIVEKIT settings on the server and this turns on. Nothing is sent to an outside service in the meantime."
          : "Ask an admin to turn calling on. You can keep using this conversation for messages."}
        confirmLabel={isAdmin ? "Open Apps & modules" : "Got it"}
        // Not destructive: nothing is being deleted, and the warning triangle
        // read as though something had gone wrong rather than as a setting
        // that is simply not on yet.
        destructive={false}
        // A Member's only action is to close it, so one button, not two that
        // do the same thing.
        cancelLabel={isAdmin ? "Cancel" : ""}
      />

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void leave()}
        title={meta.type === "CHANNEL" ? "Leave this channel?" : "Leave this group?"}
        description="You stop receiving messages. The conversation and its history stay for everyone else."
        confirmLabel={meta.type === "CHANNEL" ? "Leave channel" : "Leave group"}
        destructive
      />

      <ConfirmDialog
        open={confirmArchive !== null}
        onClose={() => setConfirmArchive(null)}
        onConfirm={() => void doArchive(confirmArchive === true)}
        title={confirmArchive ? "Archive this channel?" : "Restore this channel?"}
        description={confirmArchive
          ? "It becomes read-only for everyone. Nothing is deleted, and you can restore it."
          : "People can post in it again. Everything that was said is still there."}
        confirmLabel={confirmArchive ? "Archive" : "Restore"}
        destructive={Boolean(confirmArchive)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void doRemoveMember()}
        title={`Remove ${removeTarget?.name ?? "them"}?`}
        description="They lose access to this conversation. Everything they wrote stays."
        confirmLabel="Remove"
        destructive
      />

      <ConfirmDialog
        open={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
        onConfirm={() => void doTransfer()}
        title={`Make ${transferTarget?.name ?? "them"} the owner?`}
        description="They get Full access to this conversation, and you keep yours as a member."
        confirmLabel="Make owner"
        destructive={false}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMessage(deleteTarget)}
        title="Remove this message?"
        description="It shows as removed for everyone. This can't be undone."
        confirmLabel="Remove message"
        destructive
      />
    </div>
  );
}
