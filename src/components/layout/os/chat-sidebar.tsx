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
import { Hash, MessageCircle, Phone, Plus, Search, Users, Video, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TeamAvatar } from "@/components/team/ui";
import { useSidebarSearch } from "./sidebar-search-context";
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
  const { data: session } = useSession();
  const { toast } = useOsToast();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [rows, setRows] = useState<(ConversationListRow & { activeCall?: ActiveCall })[] | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [msgResults, setMsgResults] = useState<MessageHit[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
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

  const q = query.trim().toLowerCase();

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

  const openChannel = async (c: ChannelRow) => {
    // An explicit open is consent — clear any "just left" marker so the
    // page's auto-join guard doesn't block this deliberate rejoin.
    try { sessionStorage.removeItem(`workwrk:chat-left:${c.id}`); } catch { /* private mode */ }
    if (c.isMember) { router.push(`/room/${c.id}`); return; }
    setJoining(c.id);
    try {
      const r = await fetch(`/api/conversations/${c.id}/join`, { method: "POST" });
      if (r.ok) {
        window.dispatchEvent(new Event("workwrk:chat-changed"));
        router.push(`/room/${c.id}`);
      } else {
        toast("Couldn't join the channel — try again");
      }
    } catch {
      toast("Couldn't join the channel — check your connection");
    } finally { setJoining(null); }
  };

  return (
    <div className="flex flex-col">
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

      {filtered !== null && (visibleChannels.length > 0 || q === "") && (
        <>
          <div className="flex items-center justify-between px-2 pt-1 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Channels</span>
            <button type="button" onClick={() => setChannelModalOpen(true)} aria-label="New channel" className="text-zinc-400 hover:text-zinc-700">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="flex flex-col gap-0.5 mb-2">
            {visibleChannels.map((c) => {
              const active = pathname === `/room/${c.id}`;
              const unread = channelUnread.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openChannel(c)}
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
          <div className="px-2 pt-1 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Direct messages</span>
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
      ) : (
        <ul className="flex flex-col gap-0.5">
          {filtered.map((row) => {
            const active = pathname === `/room/${row.id}`;
            const title = conversationTitle(row, meId);
            const avatarUser = conversationAvatarUser(row, meId);
            const lastMeta = row.lastMessage?.metadata as { kind?: string; attachments?: unknown[] } | null;
            const lastBody = row.lastMessage
              ? lastMeta?.kind === "call" ? "📞 Call"
                : row.lastMessage.body || (lastMeta?.attachments?.length ? "📎 Attachment" : "")
              : "";
            const preview = row.lastMessage
              ? `${row.lastMessage.authorId === meId ? "You: " : ""}${lastBody}`
              : "No messages yet";
            return (
              <li key={row.id}>
                <Link
                  href={`/room/${row.id}`}
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
                    <Link href={`/room/${hit.conversationId}`} className="block px-2 py-1.5 rounded-md hover:bg-zinc-50">
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

      {channelModalOpen && (
        <NewChannelDialog
          onClose={() => setChannelModalOpen(false)}
          onCreated={(id) => {
            setChannelModalOpen(false);
            window.dispatchEvent(new Event("workwrk:chat-changed"));
            router.push(`/room/${id}`);
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
            router.push(`/room/${id}`);
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
