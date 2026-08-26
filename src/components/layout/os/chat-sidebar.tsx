"use client";

// ChatSidebar — the Comms Hub's middle column (docs/plans/comms-hub.md).
// Slack-style conversation list: DMs and group chats ordered by latest
// activity, unread badges, and a New-chat flow. Light by design: one
// list fetch on mount, refreshed every 20s while the tab is visible,
// plus focus/visibility refetch and the "workwrk:chat-changed" event.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bell, BellOff, BookUser, ChevronDown, ChevronRight, ExternalLink, Hash,
  LogOut, MessageCircle, Phone, Plus, Search, Star, Users, Video, X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TeamAvatar } from "@/components/team/ui";
import { useSidebarSearch } from "./sidebar-search-context";
import { stripMarkup } from "@/lib/chat-markup";
import { useOsToast } from "./toast";
import {
  conversationTitle, conversationAvatarUser, type ConversationListRow,
} from "@/components/chat/conversation-utils";

const LIST_POLL_MS = 20_000;

type ChannelRow = { id: string; name: string | null; memberCount: number; isMember: boolean };

type ActiveCall = { participants: { identity: string; name: string }[]; startedAt: string } | null;

type MessageHit = {
  messageId: string;
  conversationId: string;
  conversationType: string;
  conversationName: string | null;
  members: { userId: string; user: { id: string; firstName: string; lastName: string; avatar: string | null } }[];
  author: { id: string; firstName: string; lastName: string };
  snippet: string;
  createdAt: string;
  inThread: boolean;
};

export function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { query } = useSidebarSearch();
  const [localFind, setLocalFind] = useState("");
  const { data: session } = useSession();
  const { toast } = useOsToast();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [rows, setRows] = useState<(ConversationListRow & { activeCall?: ActiveCall })[] | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [msgResults, setMsgResults] = useState<MessageHit[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Slack's collapsible sections; persisted so the layout is stable.
  const [collapsed, setCollapsed] = useState<{ channels: boolean; dms: boolean }>({ channels: false, dms: false });
  useEffect(() => {
    try {
      const raw = localStorage.getItem("workwrk:room:sections");
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* corrupt/absent — defaults */ }
  }, []);
  const toggleSection = (key: "channels" | "dms") =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("workwrk:room:sections", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  // Right-click context menu on rows (channels + DMs), Slack-style.
  const [rowMenu, setRowMenu] = useState<{
    id: string; type: string; name: string; starred: boolean; muted: boolean;
    isGeneral: boolean; x: number; y: number;
  } | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<{ id: string; name: string } | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setRows((d.conversations ?? []) as (ConversationListRow & { activeCall?: ActiveCall })[]);
      setChannels((d.channels ?? []) as ChannelRow[]);
    } catch { /* keep the last good list — a blip must not blank the sidebar */ }
  }, []);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void load(); }, LIST_POLL_MS);
    const onWake = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("workwrk:chat-changed", onWake);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("workwrk:chat-changed", onWake);
    };
  }, [load]);

  // Sidebar-header "+" fires these (apps-catalog createActions).
  useEffect(() => {
    const onNew = () => setModalOpen(true);
    const onNewChannel = () => setChannelModalOpen(true);
    window.addEventListener("workwrk:os:new:chat-new", onNew);
    window.addEventListener("workwrk:os:new:chat-new-channel", onNewChannel);
    return () => {
      window.removeEventListener("workwrk:os:new:chat-new", onNew);
      window.removeEventListener("workwrk:os:new:chat-new-channel", onNewChannel);
    };
  }, []);

  const q = (localFind || query).trim().toLowerCase();

  // Message search rides the same sidebar search box: 2+ chars kicks
  // off a debounced lookup across my conversations.
  useEffect(() => {
    if (q.length < 2) { setMsgResults(null); return; }
    let active = true;
    const t = setTimeout(() => {
      fetch(`/api/conversations/search-messages?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (active) setMsgResults((d?.results ?? []) as MessageHit[]); })
        .catch(() => { if (active) setMsgResults([]); });
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [q]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const direct = rows.filter((r) => r.type !== "CHANNEL");
    if (!q) return direct;
    return direct.filter((r) => conversationTitle(r, meId).toLowerCase().includes(q));
  }, [rows, q, meId]);

  // Unread + live-call badges for channels come from the conversation
  // list (member rows) — the channel directory itself carries neither.
  const channelUnread = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) if (r.type === "CHANNEL") map.set(r.id, r.unreadCount);
    return map;
  }, [rows]);
  const channelCalls = useMemo(() => {
    const map = new Map<string, NonNullable<ActiveCall>>();
    for (const r of rows ?? []) {
      if (r.type === "CHANNEL" && r.activeCall && r.activeCall.participants.length > 0) map.set(r.id, r.activeCall);
    }
    return map;
  }, [rows]);

  const visibleChannels = useMemo(
    () => (q ? channels.filter((c) => (c.name ?? "").toLowerCase().includes(q)) : channels),
    [channels, q],
  );

  /** Zoom's "New meeting" gesture: mint an instant call, copy its guest
   *  link, and jump straight into the call. */
  const newCallLink = async () => {
    try {
      const r = await fetch("/api/meetings/instant", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.id) { toast("Couldn't create the call link"); return; }
      try { await navigator.clipboard.writeText(d.guestUrl); } catch { /* clipboard denied */ }
      toast("Call link copied — share it with anyone, then join");
      router.push(d.url);
    } catch { toast("Couldn't create the call link — check your connection"); }
  };

  /* ── row context-menu actions (all optimistic + toast on failure) ── */
  const patchConversation = async (id: string, body: Record<string, unknown>, okMsg: string, failMsg: string) => {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) { toast(okMsg); void load(); }
    else toast(failMsg);
  };

  /** Slack's close: hides the row, keeps every message. Any new message
   *  (or starting the DM again) brings it back. DMs only — groups have
   *  Leave (closing a group would have no reopen path). The PATCH is
   *  AWAITED before any redirect so the /room landing can't race the
   *  still-visible row and bounce back in; failure restores the row. */
  const closeConversation = async (id: string) => {
    const snapshot = rows;
    setRows((prev) => prev ? prev.filter((r) => r.id !== id) : prev);
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    }).catch(() => null);
    if (res?.ok) {
      toast("Conversation closed — history is kept");
      if (pathname === `/tlk/${id}`) router.push("/tlk");
    } else {
      setRows(snapshot);
      toast("Couldn't close it");
    }
  };

  const leaveChannel = async () => {
    const target = confirmLeaveId;
    setConfirmLeaveId(null);
    if (!target) return;
    const res = await fetch(`/api/conversations/${target.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      try { sessionStorage.setItem(`workwrk:chat-left:${target.id}`, "1"); } catch { /* private mode */ }
      if (pathname === `/tlk/${target.id}`) router.push("/tlk");
      void load();
    } else toast("Couldn't leave the channel");
  };

  const openRowMenu = (e: React.MouseEvent, opts: { id: string; type: string; name: string; starred: boolean; muted: boolean; isGeneral: boolean }) => {
    e.preventDefault();
    setRowMenu({ ...opts, x: e.clientX, y: e.clientY });
  };

  const openChannel = async (c: ChannelRow) => {
    // An explicit open is consent — clear any "just left" marker so the
    // page's auto-join guard doesn't block this deliberate rejoin.
    try { sessionStorage.removeItem(`workwrk:chat-left:${c.id}`); } catch { /* private mode */ }
    if (c.isMember) { router.push(`/tlk/${c.id}`); return; }
    setJoining(c.id);
    try {
      const r = await fetch(`/api/conversations/${c.id}/join`, { method: "POST" });
      if (r.ok) {
        window.dispatchEvent(new Event("workwrk:chat-changed"));
        router.push(`/tlk/${c.id}`);
      } else {
        toast("Couldn't join the channel — try again");
      }
    } catch {
      toast("Couldn't join the channel — check your connection");
    } finally { setJoining(null); }
  };

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 h-8 focus-within:border-zinc-300 focus-within:bg-white">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <input
          type="text"
          value={localFind}
          onChange={(e) => setLocalFind(e.target.value)}
          placeholder="Find a conversation…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400"
        />
        {localFind && (
          <button type="button" onClick={() => setLocalFind("")} aria-label="Clear" className="text-zinc-400 hover:text-zinc-700">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <Link
        href="/people"
        className="mb-2 flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-zinc-700 hover:bg-zinc-50"
      >
        <BookUser className="h-4 w-4 text-zinc-500" /> Directory
      </Link>
      <div className="flex items-center gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex flex-1 items-center gap-2 h-8 px-2 rounded-md text-[14px] text-zinc-700 hover:bg-zinc-50 border border-dashed border-zinc-200"
        >
          <Plus className="w-4 h-4 text-zinc-500" />
          New message
        </button>
        <button
          type="button"
          onClick={() => void newCallLink()}
          title="New call link — an instant call with a shareable guest link (Zoom-style)"
          className="flex items-center justify-center h-8 w-9 rounded-md text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 border border-dashed border-zinc-200"
        >
          <Video className="w-4 h-4" />
        </button>
      </div>

      {rows !== null && !q && rows.some((r) => r.myStarred) && (
        <>
          <div className="px-1 pt-1 pb-1">
            <span className="inline-flex items-center gap-1 px-1 text-[13px] font-semibold text-zinc-600">
              <Star className="h-3.5 w-3.5 text-zinc-400" /> Starred
            </span>
          </div>
          <ul className="mb-2 flex flex-col gap-0.5">
            {(rows ?? []).filter((r) => r.myStarred).map((row) => (
              <li key={`star-${row.id}`}>
                <Link
                  href={`/tlk/${row.id}`}
                  className={`flex h-8 items-center gap-2 rounded-md px-2 ${pathname === `/tlk/${row.id}` ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                >
                  {row.type === "CHANNEL"
                    ? <Hash className="h-4 w-4 shrink-0 text-zinc-400" />
                    : <MessageCircle className="h-4 w-4 shrink-0 text-zinc-400" />}
                  <span className={`flex-1 truncate text-[14px] ${row.unreadCount > 0 ? "font-semibold text-zinc-900" : "text-zinc-800"}`}>
                    {row.type === "CHANNEL" ? `#${row.name ?? "channel"}` : conversationTitle(row, meId)}
                  </span>
                  {row.unreadCount > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#0073EA] px-1.5 text-[11px] font-semibold text-white tabular-nums">
                      {row.unreadCount > 99 ? "99+" : row.unreadCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {filtered !== null && (visibleChannels.length > 0 || q === "") && (
        <>
          <div className="flex items-center justify-between px-1 pt-1 pb-1">
            <button
              type="button"
              onClick={() => toggleSection("channels")}
              className="inline-flex items-center gap-1 rounded px-1 text-[13px] font-semibold text-zinc-600 hover:bg-zinc-50"
              aria-expanded={!collapsed.channels}
            >
              {collapsed.channels ? <ChevronRight className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
              Channels
            </button>
            <button type="button" onClick={() => setChannelModalOpen(true)} aria-label="New channel" className="mr-1 text-zinc-400 hover:text-zinc-700">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className={`flex flex-col gap-0.5 mb-2 ${collapsed.channels ? "hidden" : ""}`}>
            {visibleChannels.map((c) => {
              const active = pathname === `/tlk/${c.id}`;
              const unread = channelUnread.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openChannel(c)}
                    onContextMenu={(e) => c.isMember && openRowMenu(e, {
                      id: c.id, type: "CHANNEL", name: `#${c.name ?? "channel"}`,
                      starred: Boolean((rows ?? []).find((r) => r.id === c.id)?.myStarred),
                      muted: (rows ?? []).find((r) => r.id === c.id)?.myNotifyLevel === "mute",
                      isGeneral: (c.name ?? "").toLowerCase() === "general",
                    })}
                    disabled={joining === c.id}
                    className={`w-full flex items-center gap-2 h-8 px-2 rounded-md text-left ${
                      active ? "bg-zinc-100" : "hover:bg-zinc-50"
                    } ${c.isMember ? "" : "opacity-70"}`}
                  >
                    <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className={`flex-1 truncate text-[14px] ${unread > 0 ? "font-semibold text-zinc-900" : "text-zinc-800"}`}>
                      {c.name}
                    </span>
                    {channelCalls.has(c.id) && (
                      <span
                        className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold tabular-nums"
                        title={`In call: ${channelCalls.get(c.id)!.participants.map((p) => p.name).join(", ")}`}
                      >
                        <Phone className="w-3 h-3" /> {channelCalls.get(c.id)!.participants.length}
                      </span>
                    )}
                    {unread > 0 ? (
                      <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#0073EA] text-white text-[11px] font-semibold inline-flex items-center justify-center tabular-nums">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : !c.isMember ? (
                      <span className="shrink-0 text-[11px] text-zinc-400">{joining === c.id ? "Joining…" : "Join"}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between px-1 pt-1 pb-1">
            <button
              type="button"
              onClick={() => toggleSection("dms")}
              className="inline-flex items-center gap-1 rounded px-1 text-[13px] font-semibold text-zinc-600 hover:bg-zinc-50"
              aria-expanded={!collapsed.dms}
            >
              {collapsed.dms ? <ChevronRight className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
              Direct messages
            </button>
            <button type="button" onClick={() => setModalOpen(true)} aria-label="New conversation" className="mr-1 text-zinc-400 hover:text-zinc-700">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      {filtered === null ? (
        <div className="px-2 py-4 text-[13px] text-zinc-400">Loading conversations…</div>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <MessageCircle className="w-5 h-5 text-zinc-300 mx-auto mb-2" />
          <p className="text-[13px] text-zinc-500">
            {q ? "No conversations match" : "No conversations yet. Start one with New message."}
          </p>
        </div>
      ) : collapsed.dms && !q ? null : (
        <ul className="flex flex-col gap-0.5">
          {filtered.map((row) => {
            const active = pathname === `/tlk/${row.id}`;
            const title = conversationTitle(row, meId);
            const avatarUser = conversationAvatarUser(row, meId);
            const lastMeta = row.lastMessage?.metadata as { kind?: string; attachments?: unknown[] } | null;
            const lastBody = row.lastMessage
              ? lastMeta?.kind === "call" ? "📞 Call"
                : row.lastMessage.body ? stripMarkup(row.lastMessage.body.slice(0, 200)) : (lastMeta?.attachments?.length ? "📎 Attachment" : "")
              : "";
            const preview = row.lastMessage
              ? `${row.lastMessage.authorId === meId ? "You: " : ""}${lastBody}`
              : "No messages yet";
            return (
              <li key={row.id} className="group/dm relative">
                <Link
                  href={`/tlk/${row.id}`}
                  onContextMenu={(e) => openRowMenu(e, {
                    id: row.id, type: row.type, name: conversationTitle(row, meId),
                    starred: Boolean(row.myStarred), muted: row.myNotifyLevel === "mute",
                    isGeneral: row.type === "CHANNEL" && (row.name ?? "").toLowerCase() === "general",
                  })}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md ${
                    active ? "bg-zinc-100" : "hover:bg-zinc-50"
                  }`}
                >
                  {row.type === "DM" && avatarUser ? (
                    <TeamAvatar name={`${avatarUser.firstName} ${avatarUser.lastName}`} avatar={avatarUser.avatar} size={30} />
                  ) : (
                    <span className="w-[30px] h-[30px] rounded-full bg-zinc-100 text-zinc-500 inline-flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4" />
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate text-[14px] ${row.unreadCount > 0 ? "font-semibold text-zinc-900" : "text-zinc-800"}`}>
                      {title}
                    </span>
                    <span className={`block truncate text-[12px] ${row.unreadCount > 0 ? "text-zinc-600" : "text-zinc-400"}`}>
                      {preview}
                    </span>
                  </span>
                  {row.activeCall && row.activeCall.participants.length > 0 && (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold tabular-nums"
                      title={`In call: ${row.activeCall.participants.map((p) => p.name).join(", ")}`}
                    >
                      <Phone className="w-3 h-3" /> {row.activeCall.participants.length}
                    </span>
                  )}
                  {row.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#0073EA] text-white text-[11px] font-semibold inline-flex items-center justify-center tabular-nums">
                      {row.unreadCount > 99 ? "99+" : row.unreadCount}
                    </span>
                  )}
                </Link>
                {row.type === "DM" && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); void closeConversation(row.id); }}
                    title="Close conversation — history is kept"
                    aria-label="Close conversation"
                    className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 group-hover/dm:block"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {q.length >= 2 && msgResults !== null && (
        <>
          <div className="px-2 pt-3 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Messages</span>
          </div>
          {msgResults.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-zinc-400">No messages match</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {msgResults.map((hit) => {
                const convTitle = hit.conversationType === "CHANNEL"
                  ? `#${hit.conversationName ?? "channel"}`
                  : conversationTitle(
                      { type: hit.conversationType, name: hit.conversationName, members: hit.members },
                      meId,
                    );
                return (
                  <li key={hit.messageId}>
                    <Link href={`/tlk/${hit.conversationId}`} className="block px-2 py-1.5 rounded-md hover:bg-zinc-50">
                      <span className="block truncate text-[13px] font-medium text-zinc-800">
                        {convTitle}
                        {hit.inThread && <span className="ml-1 text-[11px] font-normal text-zinc-400">in thread</span>}
                      </span>
                      <span className="block truncate text-[12px] text-zinc-500">
                        {hit.author.firstName}: {hit.snippet}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {rowMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRowMenu(null); }} />
          <div
            className="fixed z-50 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl"
            style={{ left: Math.min(rowMenu.x, typeof window !== "undefined" ? window.innerWidth - 240 : rowMenu.x), top: Math.min(rowMenu.y, typeof window !== "undefined" ? window.innerHeight - 260 : rowMenu.y) }}
          >
            <button type="button" onClick={() => { setRowMenu(null); router.push(`/tlk/${rowMenu.id}`); }} className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ExternalLink className="h-4 w-4 text-zinc-400" /> Open
            </button>
            <button
              type="button"
              onClick={() => {
                const m = rowMenu; setRowMenu(null);
                if (pathname === `/tlk/${m.id}`) window.dispatchEvent(new CustomEvent("workwrk:room:start-talktok", { detail: { id: m.id } }));
                else router.push(`/tlk/${m.id}?call=1`);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50"
            >
              <Video className="h-4 w-4 text-zinc-400" /> Start call
            </button>
            {(() => {
              // Live state at ACTION time — the snapshot in rowMenu can go
              // stale if the 20s poll lands while the menu is open.
              const liveRow = (rows ?? []).find((r) => r.id === rowMenu.id);
              const starred = liveRow ? Boolean(liveRow.myStarred) : rowMenu.starred;
              const muted = liveRow ? liveRow.myNotifyLevel === "mute" : rowMenu.muted;
              // Channels un-mute back to their quiet "mentions" default,
              // never to per-message bells.
              const unmuteLevel = rowMenu.type === "CHANNEL" ? "mentions" : "all";
              return (
                <>
                  <button
                    type="button"
                    onClick={() => { const m = rowMenu; setRowMenu(null); void patchConversation(m.id, { starred: !starred }, starred ? "Removed from Starred" : "Added to Starred", "Couldn't update the star"); }}
                    className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50"
                  >
                    <Star className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-400" : "text-zinc-400"}`} />
                    {starred ? "Remove from Starred" : "Star"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { const m = rowMenu; setRowMenu(null); void patchConversation(m.id, { notifyLevel: muted ? unmuteLevel : "mute" }, muted ? "Notifications on" : "Muted", "Couldn't update notifications"); }}
                    className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50"
                  >
                    {muted ? <Bell className="h-4 w-4 text-zinc-400" /> : <BellOff className="h-4 w-4 text-zinc-400" />}
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <div className="my-1 h-px bg-zinc-100" />
                  {rowMenu.type === "CHANNEL" ? (
                    !rowMenu.isGeneral && (
                      <button type="button" onClick={() => { const m = rowMenu; setRowMenu(null); setConfirmLeaveId({ id: m.id, name: m.name }); }} className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-red-600 hover:bg-red-50">
                        <LogOut className="h-4 w-4" /> Leave channel
                      </button>
                    )
                  ) : rowMenu.type === "DM" ? (
                    <button type="button" onClick={() => { const m = rowMenu; setRowMenu(null); void closeConversation(m.id); }} className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">
                      <X className="h-4 w-4 text-zinc-400" /> Close conversation
                    </button>
                  ) : null}
                </>
              );
            })()}
          </div>
        </>
      )}

      {confirmLeaveId && (
        <ConfirmDialog
          open
          onClose={() => setConfirmLeaveId(null)}
          onConfirm={() => void leaveChannel()}
          title={`Leave ${confirmLeaveId.name}?`}
          description="You'll stop receiving its messages. The channel and its history stay for everyone else."
          confirmLabel="Leave channel"
          destructive
        />
      )}

      {channelModalOpen && (
        <NewChannelDialog
          onClose={() => setChannelModalOpen(false)}
          onCreated={(id) => {
            setChannelModalOpen(false);
            window.dispatchEvent(new Event("workwrk:chat-changed"));
            router.push(`/tlk/${id}`);
          }}
        />
      )}

      {modalOpen && (
        <NewChatModal
          meId={meId}
          onClose={() => setModalOpen(false)}
          onCreated={(id) => {
            setModalOpen(false);
            window.dispatchEvent(new Event("workwrk:chat-changed"));
            router.push(`/tlk/${id}`);
          }}
        />
      )}
    </div>
  );
}

/* ── New chat — pick one person (DM) or several (group) ────────── */

type PersonRow = { id: string; firstName: string; lastName: string; avatar?: string | null; role?: { title: string } | null };

function NewChatModal({ meId, onClose, onCreated }: {
  meId: string | null;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [picked, setPicked] = useState<PersonRow[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ scope: "all", limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => { if (active) setPeople(Array.isArray(d?.data) ? d.data : []); })
        .catch(() => { if (active) setPeople([]); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [search]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const candidates = people.filter((p) => p.id !== meId && !pickedIds.has(p.id));

  const toggle = (p: PersonRow) => {
    setError(null);
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]));
  };

  const create = async () => {
    if (picked.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          picked.length === 1
            ? { type: "DM", memberIds: [picked[0].id] }
            : { type: "GROUP", memberIds: picked.map((p) => p.id), name: groupName.trim() || undefined },
        ),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.id) {
        setError(d?.error || "Couldn't start the chat. Try again.");
        setCreating(false);
        return;
      }
      onCreated(d.id);
    } catch {
      setError("Couldn't start the chat. Check your connection and try again.");
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-full bg-zinc-100 text-[13px] text-zinc-700">
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={18} />
                {p.firstName} {p.lastName}
                <button type="button" onClick={() => toggle(p)} className="text-zinc-400 hover:text-zinc-700" aria-label={`Remove ${p.firstName}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-zinc-200 bg-white">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-800 placeholder:text-zinc-400"
          />
        </div>

        <ul className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-0.5">
          {candidates.length === 0 ? (
            <li className="px-2 py-4 text-center text-[13px] text-zinc-400">No people found</li>
          ) : candidates.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-left"
              >
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={28} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] text-zinc-800">{p.firstName} {p.lastName}</span>
                  {p.role?.title && <span className="block truncate text-[12px] text-zinc-400">{p.role.title}</span>}
                </span>
                <Plus className="w-4 h-4 text-zinc-300" />
              </button>
            </li>
          ))}
        </ul>

        {picked.length > 1 && (
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            className="mt-2 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-300"
          />
        )}

        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[14px] text-zinc-600 hover:bg-zinc-50 border border-zinc-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={picked.length === 0 || creating}
            className="h-8 px-3 rounded-md text-[14px] font-medium text-white bg-[#0073EA] hover:bg-[#0060c2] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Starting…" : picked.length > 1 ? "Start group chat" : "Start chat"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── New channel — org-open, name required ─────────────────────── */

function NewChannelDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const create = async () => {
    const trimmed = name.trim().replace(/^#/, "");
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CHANNEL", name: trimmed }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.id) {
        setError(d?.error || "Couldn't create the channel. Try again.");
        setCreating(false);
        return;
      }
      onCreated(d.id);
    } catch {
      setError("Couldn't create the channel. Check your connection and try again.");
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-zinc-500 mb-2">
          Channels are open to everyone in the company — anyone can find and join them.
        </p>
        <div className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-zinc-200 bg-white">
          <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            placeholder="e.g. sales, product, random"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-800 placeholder:text-zinc-400"
          />
        </div>
        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[14px] text-zinc-600 hover:bg-zinc-50 border border-zinc-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || creating}
            className="h-8 px-3 rounded-md text-[14px] font-medium text-white bg-[#0073EA] hover:bg-[#0060c2] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating…" : "Create channel"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
