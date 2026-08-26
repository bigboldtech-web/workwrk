"use client";

/* Conversation view — Slack-style thread + composer, with Zoom-grade
 * calls one click away (docs/plans/comms-hub.md Phases 3+5).
 *
 *  - ONE poll drives everything: every 4s (hidden tabs pause) it asks
 *    for messages whose updatedAt moved past the cursor, so new sends,
 *    reactions, edits, deletes and thread replies all arrive on the
 *    same cheap indexed query. Results merge by id.
 *  - Sends are optimistic with a visible Retry on failure — never
 *    silent loss. Reactions/edits/deletes are optimistic with revert.
 *  - Threads: replies live under a parent (parentId); the panel is a
 *    side sheet fed by the same poll.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bell, BellOff, Hash, Link2, Loader2, LogOut, MoreHorizontal, Pencil, Phone,
  RefreshCw, UserPlus, Users, Video,
} from "lucide-react";
import { CallPanel } from "@/components/calls/call-panel";
import { TeamAvatar } from "@/components/team/ui";
import { useOsToast } from "@/components/layout/os/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AddPeopleDialog } from "@/components/chat/add-people-dialog";
import { conversationTitle, type ChatUserLite } from "@/components/chat/conversation-utils";
import { MessageFeed, type FeedMessage } from "@/components/chat/message-feed";
import { ChatComposer, type ComposerPayload } from "@/components/chat/chat-composer";
import { ThreadPanel } from "@/components/chat/thread-panel";

const POLL_MS = 4_000;

type ConversationMeta = {
  id: string;
  type: "DM" | "GROUP" | "CHANNEL";
  name: string | null;
  members: { userId: string; notifyLevel?: string; user: ChatUserLite & { email?: string } }[];
  call: { room: string; guestUrl?: string };
  activeCall?: { participants: { identity: string; name: string }[]; startedAt: string } | null;
};

type Thread = { parent: FeedMessage; replies: FeedMessage[] };

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const myName = session?.user?.name ?? null;

  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [callOpen, setCallOpen] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("call") === "1");
  // Snapshot of the room taken when the panel OPENED: the 10s meta poll
  // may re-derive a rotated room name mid-call, and swapping the live
  // conference's room prop would disconnect everyone (Jitsi fallback
  // recreates on room change). The latch holds until the panel closes.
  const [callRoom, setCallRoom] = useState<string | null>(null);
  const [callAudioOnly, setCallAudioOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FeedMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Keyset poll cursor (updatedAt, id) — advanced ONLY by the initial
  // load and by poll responses, never by out-of-band fetches (a send or
  // thread-open bumping it could skip other people's concurrent edits).
  const cursor = useRef<{ ts: string; id: string } | null>(null);
  const polling = useRef(false);
  const threadRef = useRef<Thread | null>(null);
  threadRef.current = thread;

  const memberNames = useMemo(
    () => new Map((meta?.members ?? []).map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`.trim()])),
    [meta],
  );

  const seedCursor = (rows: FeedMessage[]) => {
    // Pair-wise max over the initial page; an empty conversation starts
    // at the epoch so the poll still runs and catches the first message.
    let best = cursor.current ?? { ts: new Date(0).toISOString(), id: "" };
    for (const r of rows) {
      const u = r.updatedAt ?? r.createdAt;
      if (u > best.ts || (u === best.ts && r.id > best.id)) best = { ts: u, id: r.id };
    }
    cursor.current = best;
  };

  /* ── data: meta ─────────────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    setMeta(null);
    setMetaError(false);
    fetch(`/api/conversations/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (active) setMeta(d); })
      .catch(async (e) => {
        // Deep link into a channel I haven't joined? Channels are org-open,
        // so try a self-join once (only succeeds for channels) and reload.
        // Only on a definite 404 — a transient 500 must not reload-loop —
        // and never when the user just LEFT this channel (back button
        // would silently rejoin them otherwise).
        const justLeft = sessionStorage.getItem(`workwrk:chat-left:${id}`) === "1";
        if (e instanceof Error && e.message === "404" && !justLeft) {
          try {
            const j = await fetch(`/api/conversations/${id}/join`, { method: "POST" });
            if (j.ok && active) { window.location.reload(); return; }
          } catch { /* fall through to the honest error state */ }
        }
        if (active) setMetaError(true);
      });
    return () => { active = false; };
  }, [id]);

  // Huddle roster refresh: ALWAYS on while the page is visible — a user
  // already sitting in the conversation must see the chip appear when
  // someone else starts a huddle (gating on activeCall was a chicken-and-
  // egg: it could never turn on). 20s idle, 10s while in/near a call.
  // Stale guards: responses for another conversation (fast switch) or
  // from an unmounted tick never land.
  useEffect(() => {
    let alive = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      fetch(`/api/conversations/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d && d.id === id) setMeta(d); })
        .catch(() => { /* next tick */ });
    }, callOpen || meta?.activeCall ? 10_000 : 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [id, callOpen, meta?.activeCall]);

  const markRead = useCallback(async () => {
    try {
      await fetch(`/api/conversations/${id}/read`, { method: "POST" });
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } catch { /* read receipts are best-effort */ }
  }, [id]);

  /* ── data: initial page ─────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    setMessages([]);
    setThread(null);
    setLoadedOnce(false);
    cursor.current = null;
    fetch(`/api/conversations/${id}/messages`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!active) return;
        const rows: FeedMessage[] = d.messages ?? [];
        setMessages(rows);
        setHasMore(Boolean(d.hasMore));
        seedCursor(rows);
        setLoadedOnce(true);
        void markRead();
      })
      .catch(() => { if (active) setLoadedOnce(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ── merge machinery ────────────────────────────────────────── */
  const mergeTopLevel = (incoming: FeedMessage[]) => {
    if (incoming.length === 0) return false;
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
          // Insert by createdAt (usually a plain append). Older-than-window
          // rows are left to the load-older pager.
          next = next === prev ? [...prev] : next;
          const at = next.findIndex((x) => !x.pending && x.createdAt > m.createdAt);
          if (at === -1) next.push({ ...m });
          else next.splice(at, 0, { ...m });
          changed = true;
        }
      }
      return next;
    });
    return changed;
  };

  const mergeThread = (incoming: FeedMessage[]) => {
    const open = threadRef.current;
    if (!open) return;
    const forThread = incoming.filter((m) => m.parentId === open.parent.id);
    const parentUpdate = incoming.find((m) => m.id === open.parent.id);
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
      return { parent: parentUpdate ? { ...parentUpdate } : prev.parent, replies };
    });
  };

  /* ── the single poll ────────────────────────────────────────── */
  useEffect(() => {
    const tick = async () => {
      if (document.hidden || !cursor.current || polling.current) return;
      polling.current = true;
      try {
        // A 200-row page means more changes are waiting — drain them now
        // instead of one page per 4s tick.
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
          const hasNewFromOthers = fresh.some((m) => m.authorId !== meId && !m.deletedAt);
          if ((newTop || hasNewFromOthers) && document.visibilityState === "visible") void markRead();
          if (!d.more) break;
        }
      } catch { /* next tick retries */ }
      finally { polling.current = false; }
    };
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, meId, markRead]);

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
        const older: FeedMessage[] = d.messages ?? [];
        const el = scrollRef.current;
        const prevHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !seen.has(m.id)), ...prev];
        });
        setHasMore(Boolean(d.hasMore));
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } finally { setLoadingOlder(false); }
  };

  /* ── sending ────────────────────────────────────────────────── */
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

  const deliver = useCallback(async (tempId: string, payload: {
    body: string; parentId?: string; metadata?: Record<string, unknown>;
  }, place: "top" | "thread") => {
    const applyFail = () => {
      if (place === "top") setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      else {
        setThread((prev) => prev ? { ...prev, replies: prev.replies.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)) } : prev);
        // The optimistic +1 on the parent's reply chip must not survive
        // a failed reply.
        const parentId = threadRef.current?.parent.id;
        if (parentId) setMessages((prev) => prev.map((m) => (m.id === parentId ? { ...m, replyCount: Math.max(0, (m.replyCount ?? 1) - 1) } : m)));
        toast("Reply didn't send — it stays in the thread with a Retry button");
      }
    };
    // Swap the temp for the server row — and drop any copy of that row
    // the poll may have delivered first, so a slow POST response can't
    // leave a duplicate.
    const applyOk = (server: FeedMessage) => {
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
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.message) throw new Error("send failed");
      applyOk(d.message as FeedMessage);
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } catch {
      applyFail();
    }
  }, [id]);

  const buildOptimistic = (payload: ComposerPayload, parentId?: string): FeedMessage => ({
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

  const wirePayload = (payload: ComposerPayload, parentId?: string) => {
    const metadata: Record<string, unknown> = {};
    if (payload.attachments.length > 0) metadata.attachments = payload.attachments;
    if (payload.mentions.length > 0) metadata.mentions = payload.mentions;
    return {
      body: payload.body,
      ...(parentId ? { parentId } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  };

  const sendMain = (payload: ComposerPayload) => {
    if (!payload.body && payload.attachments.length === 0) return;
    const temp = buildOptimistic(payload);
    setMessages((prev) => [...prev, temp]);
    stickToBottom.current = true;
    void deliver(temp.id, wirePayload(payload), "top");
  };

  const sendCallCard = (body: string) => {
    const temp: FeedMessage = { ...buildOptimistic({ body, mentions: [], attachments: [] }), metadata: { kind: "call" } };
    setMessages((prev) => [...prev, temp]);
    void deliver(temp.id, { body, metadata: { kind: "call" } }, "top");
  };

  const sendThreadReply = (payload: ComposerPayload) => {
    const open = threadRef.current;
    if (!open || (!payload.body && payload.attachments.length === 0)) return;
    const temp = buildOptimistic(payload, open.parent.id);
    setThread((prev) => (prev ? { ...prev, replies: [...prev.replies, temp] } : prev));
    setMessages((prev) => prev.map((m) => (m.id === open.parent.id ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m)));
    void deliver(temp.id, wirePayload(payload, open.parent.id), "thread");
  };

  const retry = (m: FeedMessage) => {
    const place = m.parentId ? "thread" : "top";
    const apply = (fn: (x: FeedMessage) => FeedMessage) => {
      if (place === "top") setMessages((prev) => prev.map((x) => (x.id === m.id ? fn(x) : x)));
      else setThread((prev) => prev ? { ...prev, replies: prev.replies.map((x) => (x.id === m.id ? fn(x) : x)) } : prev);
    };
    apply((x) => ({ ...x, pending: true, failed: false }));
    const payload: ComposerPayload = {
      body: m.body,
      mentions: m.metadata?.mentions ?? [],
      attachments: m.metadata?.attachments ?? [],
    };
    if (m.metadata?.kind === "call") void deliver(m.id, { body: m.body, metadata: { kind: "call" } }, place);
    else void deliver(m.id, wirePayload(payload, m.parentId ?? undefined), place);
  };

  /* ── reactions / edit / delete (optimistic + revert) ────────── */
  const patchEverywhere = (messageId: string, fn: (m: FeedMessage) => FeedMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? fn(m) : m)));
    setThread((prev) => {
      if (!prev) return prev;
      return {
        parent: prev.parent.id === messageId ? fn(prev.parent) : prev.parent,
        replies: prev.replies.map((m) => (m.id === messageId ? fn(m) : m)),
      };
    });
  };

  const react = (m: FeedMessage, emoji: string) => {
    if (!meId || m.pending || m.failed) return;
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
        // Revert ONLY my toggle — a wholesale snapshot restore would wipe
        // reactions other people added while the request was in flight.
        patchEverywhere(m.id, (x) => {
          const cur = { ...(x.metadata?.reactions ?? {}) };
          const list = cur[emoji] ?? [];
          const mine = list.includes(meId);
          const reverted = mine ? list.filter((u) => u !== meId) : [...list, meId];
          if (reverted.length > 0) cur[emoji] = reverted; else delete cur[emoji];
          return { ...x, metadata: { ...x.metadata, reactions: cur } };
        });
        toast("Couldn't add the reaction");
      });
  };

  const editMessage = (m: FeedMessage, newBody: string) => {
    const oldBody = m.body;
    const oldEditedAt = m.editedAt;
    patchEverywhere(m.id, (x) => ({ ...x, body: newBody, editedAt: new Date().toISOString() }));
    fetch(`/api/conversations/${id}/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        patchEverywhere(m.id, (x) => ({ ...x, body: oldBody, editedAt: oldEditedAt }));
        toast("Couldn't save the edit");
      });
  };

  const deleteMessage = (m: FeedMessage) => {
    setDeleteTarget(null);
    const oldDeletedAt = m.deletedAt;
    patchEverywhere(m.id, (x) => ({ ...x, deletedAt: new Date().toISOString() }));
    fetch(`/api/conversations/${id}/messages/${m.id}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        patchEverywhere(m.id, (x) => ({ ...x, deletedAt: oldDeletedAt ?? null }));
        toast("Couldn't remove the message");
      });
  };

  /* ── threads ────────────────────────────────────────────────── */
  const openThread = async (m: FeedMessage) => {
    setThread({ parent: m, replies: [] });
    try {
      const r = await fetch(`/api/conversations/${id}/messages?parent=${m.id}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setThread((prev) => {
          if (!prev || prev.parent.id !== m.id) return prev;
          const fetched: FeedMessage[] = d.messages ?? [];
          const seen = new Set(fetched.map((x) => x.id));
          // A reply sent while this fetch was in flight lives only in
          // local state — keep it.
          const inFlight = prev.replies.filter((x) => (x.pending || x.failed) && !seen.has(x.id));
          return { parent: { ...d.parent }, replies: [...fetched, ...inFlight] };
        });
      }
    } catch { /* panel shows what it has; the poll fills in */ }
  };

  /* ── calls ──────────────────────────────────────────────────── */
  const startCall = (audioOnly: boolean) => {
    setCallAudioOnly(audioOnly);
    if (!callOpen) {
      setCallRoom(meta?.call?.room ?? null);
      setCallOpen(true);
      // Joining a huddle that's already LIVE is not starting one — no card.
      if (meta?.activeCall) return;
      const recentCall = [...messages].reverse().find((m) => m.metadata?.kind === "call");
      const recentMs = recentCall ? Date.now() - new Date(recentCall.createdAt).getTime() : Infinity;
      if (recentMs > 10 * 60 * 1000) sendCallCard(audioOnly ? "Started an audio call" : "Started a call");
    }
  };

  /** Revoke every previously shared guest link for this room's calls —
   *  the only revocation DMs and #general have (they can't be left, so
   *  the epoch never rotates on its own). */
  const resetGuestLink = async () => {
    setMenuOpen(false);
    const res = await fetch(`/api/conversations/${id}/rotate-call`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const d = await res.json().catch(() => null);
      if (d) setMeta((prev) => (prev ? { ...prev, call: d.call } : prev));
      toast("Guest link reset — old links are dead");
    } else toast("Couldn't reset the link");
  };

  const copyGuestLink = () => {
    setMenuOpen(false);
    const url = meta?.call?.guestUrl;
    if (!url) { toast("Guest link unavailable"); return; }
    void navigator.clipboard.writeText(url);
    toast("Guest link copied — outsiders join this room's calls with it");
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
    const name = window.prompt(meta?.type === "CHANNEL" ? "Channel name" : "Group name", meta?.name ?? "");
    if (name === null) return;
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      setMeta((prev) => (prev ? { ...prev, name: name.trim() } : prev));
      window.dispatchEvent(new Event("workwrk:chat-changed"));
    } else {
      const d = res ? await res.json().catch(() => null) : null;
      toast(d?.error || "Couldn't rename");
    }
  };

  const leave = async () => {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    setConfirmLeave(false);
    if (res?.ok) {
      try { sessionStorage.setItem(`workwrk:chat-left:${id}`, "1"); } catch { /* private mode */ }
      window.dispatchEvent(new Event("workwrk:chat-changed"));
      router.push("/room");
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

  const title = meta
    ? meta.type === "CHANNEL" ? `#${meta.name ?? "channel"}` : conversationTitle(meta, meId)
    : "…";
  const others = meta?.members.filter((m) => m.userId !== meId) ?? [];
  const isGeneral = meta?.type === "CHANNEL" && (meta.name ?? "").toLowerCase() === "general";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-14 border-b border-zinc-100 shrink-0">
        <div className="flex items-center -space-x-2 shrink-0">
          {meta?.type === "CHANNEL" ? (
            <span className="w-7 h-7 rounded-md bg-zinc-100 inline-flex items-center justify-center"><Hash className="w-4 h-4 text-zinc-500" /></span>
          ) : (
            <>
              {others.slice(0, 3).map((m) => (
                <TeamAvatar key={m.userId} name={`${m.user.firstName} ${m.user.lastName}`} avatar={m.user.avatar} size={28} />
              ))}
              {others.length === 0 && <span className="w-7 h-7 rounded-full bg-zinc-100 inline-flex items-center justify-center"><Users className="w-4 h-4 text-zinc-400" /></span>}
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-zinc-900">{title}</h1>
        </div>
        {meta && meta.type !== "DM" && (
          <button
            type="button"
            onClick={() => setAddPeopleOpen(true)}
            title={`${meta.members.length} members — add people`}
            className="hidden sm:inline-flex items-center gap-1 h-8 rounded-md border border-zinc-200 pl-1.5 pr-2 hover:bg-zinc-50"
          >
            <span className="flex -space-x-1.5">
              {meta.members.slice(0, 3).map((m) => (
                <TeamAvatar key={m.userId} name={`${m.user.firstName} ${m.user.lastName}`} avatar={m.user.avatar} size={22} />
              ))}
            </span>
            <span className="text-[12px] font-medium text-zinc-600 tabular-nums">{meta.members.length}</span>
          </button>
        )}
        {meta?.activeCall && !callOpen && (
          <button
            type="button"
            onClick={() => startCall(false)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] font-medium hover:bg-emerald-100"
            title={meta.activeCall.participants.map((p) => p.name).join(", ")}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {meta.activeCall.participants.length} in call · Join
          </button>
        )}
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
                <button type="button" onClick={copyGuestLink} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  <Link2 className="w-4 h-4 text-zinc-400" /> Copy guest call link
                </button>
                <button type="button" onClick={() => void resetGuestLink()} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  <RefreshCw className="w-4 h-4 text-zinc-400" /> Reset guest call link
                </button>
                {(meta?.type === "GROUP" || meta?.type === "CHANNEL") && (
                  <button type="button" onClick={() => { setMenuOpen(false); setAddPeopleOpen(true); }} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                    <UserPlus className="w-4 h-4 text-zinc-400" /> Add people
                  </button>
                )}
                {(meta?.type === "GROUP" || (meta?.type === "CHANNEL" && !isGeneral)) && (
                  <>
                    <button type="button" onClick={() => void rename()} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-zinc-700 hover:bg-zinc-50">
                      <Pencil className="w-4 h-4 text-zinc-400" /> {meta.type === "CHANNEL" ? "Rename channel" : "Rename group"}
                    </button>
                    <button type="button" onClick={() => { setMenuOpen(false); setConfirmLeave(true); }} className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-red-600 hover:bg-red-50">
                      <LogOut className="w-4 h-4" /> {meta.type === "CHANNEL" ? "Leave channel" : "Leave group"}
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
          <CallPanel
            conversationId={id}
            room={callRoom ?? meta.call.room}
            subject={title}
            displayName={myName}
            audioOnly={callAudioOnly}
            onLeave={() => { setCallOpen(false); setCallRoom(null); }}
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
        ) : (
          <>
            {!hasMore && meta && (
              /* Slack's history intro: shown at the TRUE beginning of the
                 conversation (empty or fully paged back). */
              <div className="pb-3 pt-2">
                <div className="flex items-center gap-1 pb-3">
                  {(meta.type === "DM" ? others : others.slice(0, 4)).map((m) => (
                    <TeamAvatar key={m.userId} name={`${m.user.firstName} ${m.user.lastName}`} avatar={m.user.avatar} size={44} />
                  ))}
                </div>
                <p className="text-[15px] text-zinc-800">
                  {meta.type === "CHANNEL" ? (
                    <>This is the very beginning of <span className="font-semibold">{title}</span>.</>
                  ) : (
                    <>
                      This is the very beginning of your direct message history with{" "}
                      {others.map((m, i) => (
                        <span key={m.userId}>
                          <span className="rounded bg-[#0073EA]/10 px-1 py-0.5 font-medium text-[#0073EA]">@{m.user.firstName} {m.user.lastName}</span>
                          {i < others.length - 2 ? ", " : i === others.length - 2 ? " and " : ""}
                        </span>
                      ))}.
                    </>
                  )}
                </p>
              </div>
            )}
            {messages.length === 0 && !(!hasMore && meta) && (
              <div className="py-14 text-center">
                <p className="text-[15px] font-medium text-zinc-700">Say hello 👋</p>
              </div>
            )}
            {messages.length > 0 && (
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
          />
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 pt-1 shrink-0">
        <ChatComposer
          members={meta?.members ?? []}
          meId={meId}
          placeholder={`Message ${title}`}
          onSend={sendMain}
          onError={(msg) => toast(msg)}
          onStartCall={startCall}
        />
      </div>

      {/* Thread side sheet */}
      {thread && (
        <ThreadPanel
          parent={thread.parent}
          replies={thread.replies}
          meId={meId}
          members={meta?.members ?? []}
          memberNames={memberNames}
          onClose={() => setThread(null)}
          onSend={sendThreadReply}
          onReact={react}
          onEdit={editMessage}
          onDelete={setDeleteTarget}
          onRetry={retry}
          onError={(msg) => toast(msg)}
        />
      )}

      {addPeopleOpen && meta && (
        <AddPeopleDialog
          conversationId={id}
          existingMemberIds={meta.members.map((m) => m.userId)}
          onClose={() => setAddPeopleOpen(false)}
          onAdded={(count) => {
            setAddPeopleOpen(false);
            toast(count === 1 ? "1 person added" : `${count} people added`);
            window.dispatchEvent(new Event("workwrk:chat-changed"));
            fetch(`/api/conversations/${id}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => { if (d) setMeta(d); })
              .catch(() => { /* header refresh is cosmetic */ });
          }}
        />
      )}

      {confirmLeave && (
        <ConfirmDialog
          open
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => void leave()}
          title={meta?.type === "CHANNEL" ? "Leave this channel?" : "Leave this group?"}
          description="You'll stop receiving messages. The conversation and its history stay for everyone else."
          confirmLabel={meta?.type === "CHANNEL" ? "Leave channel" : "Leave group"}
          destructive
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMessage(deleteTarget)}
          title="Remove this message?"
          description="It will show as removed for everyone. This can't be undone."
          confirmLabel="Remove message"
          destructive
        />
      )}
    </div>
  );
}
