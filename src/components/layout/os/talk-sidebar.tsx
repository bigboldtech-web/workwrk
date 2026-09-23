"use client";

// TalkSidebar: the Talk hub's secondary sidebar (sidebar-map.md section 4).
//
// Slack-style conversation list: DMs, groups and channels ordered by latest
// activity, unread badges, starred first, and a New message flow. Light by
// design: one list fetch on mount, a 45s backstop poll while the tab is
// visible, plus focus and visibility refetch and the "workwrk:chat-changed"
// event, which SSE drives.
//
// PHASE 4 (spec-talk.md section 4 steps 1 and 2) renamed this file from
// chat-sidebar.tsx and its export from ChatSidebar, moved components/chat to
// components/talk, and removed two rows:
//
//   Directory (-> /people)  navigated OUT of the hub into the Teams hub,
//     where the Directory actually lives. Still reachable there, and New
//     message's people picker covers the need from inside Talk.
//   New call link           minted a permanent "Instant call" Meeting row
//     on every click and jumped to /meetings/<id>?call=1, out of the hub.
//     A shareable link for outsiders is every conversation's Copy guest
//     link (tlk/[id] header), which mints nothing.
//
// Every zinc utility and hard hex in here is now an --os-* token alias
// (bg-raised, border-line, text-ink-2 and so on), so the sidebar follows
// the theme instead of pinning itself to one grey ramp.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  AtSign, Check, ChevronDown, ChevronRight, Compass, ExternalLink, Hash, Inbox,
  Lock, LogOut, Megaphone, MessageCircle, MessagesSquare, MoreHorizontal, Phone, Plus,
  Star, Users, Video, X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dots } from "@/components/ui/dots";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamAvatar } from "@/components/team/ui";
import { BrowseChannelsDialog } from "@/components/talk/browse-channels-dialog";
import { NewChannelDialog } from "@/components/talk/new-channel-dialog";
import { NewMessageDialog } from "@/components/talk/new-message-dialog";
import { useSidebarSearch } from "./sidebar-search-context";
import { useOsToast } from "./toast";
import { useViewerRole } from "./boot-context";
import { useOsShell } from "./shell-context";
import {
  conversationTitle, conversationAvatarUser, type ConversationListRow,
} from "@/components/talk/conversation-utils";
import { TALK_SECTIONS_KEY, TALK_START_CALL_EVENT, legacyTalkLeftKey, readTalkKey, talkLeftKey } from "@/components/talk/talk-keys";

const LIST_POLL_MS = 45_000; // backstop; SSE (workwrk:chat-changed) drives instant updates

/** sidebar-map section 4 rows 1 to 3: the three views of Talk home (/tlk). */
const TALK_HOME_ROWS = [
  { label: "Unread", Icon: Inbox, href: "/tlk", view: null as string | null },
  { label: "Threads", Icon: MessagesSquare, href: "/tlk?view=threads", view: "threads" },
  { label: "Mentions", Icon: AtSign, href: "/tlk?view=mentions", view: "mentions" },
] as const;

type ChannelRow = {
  id: string;
  name: string | null;
  memberCount: number;
  isMember: boolean;
  /** Phase 4: a private channel wears a Lock instead of a Hash, and an
   *  archived one says so. Both default safely on a database that predates
   *  the columns, so a row from an older release renders as it always did. */
  restricted?: boolean;
  archived?: boolean;
};

type ActiveCall = { participants: { identity: string; name: string }[]; startedAt: string } | null;

/** THE ROW BADGE VOCABULARY (spec-talk section 1, the sidebar table).
 *
 *  Unread is a 6px `Dots unread`, not a filled blue count pill: the count is
 *  reserved for unread MENTIONS, which is the difference between "there is
 *  something here" and "three of them are addressed to you". A live call is a
 *  16px Phone in --os-ink-2 with `Dots live` and the participant count, not a
 *  green success pill: green in this design system means a state that
 *  succeeded, and a call in progress is neither success nor failure. */
function RowBadges({ unread, mentions, call }: {
  unread: number;
  mentions: number;
  call?: { participants: { identity: string; name: string }[] } | null;
}) {
  return (
    <>
      {call && call.participants.length > 0 ? (
        <span
          className="flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-ink-2"
          title={`In call: ${call.participants.map((p) => p.name).join(", ")}`}
        >
          <Phone className="h-4 w-4" aria-hidden />
          <Dots variant="live" />
          {call.participants.length}
        </span>
      ) : null}
      {mentions > 0 ? (
        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-strong" aria-label={`${mentions} unread mentions`}>
          {mentions > 99 ? "99+" : mentions}
        </span>
      ) : unread > 0 ? (
        <span className="shrink-0" aria-label="Unread messages">
          <Dots variant="unread" />
        </span>
      ) : null}
    </>
  );
}

/** The row's "…" (spec-talk section 1 Mobile / narrow, critic #10).
 *
 *  Right-click was the ONLY way into this menu, so Open, Start call, Star,
 *  Notifications, Close and Leave had no touch path and no keyboard path at
 *  all, and under 1024, where this sidebar collapses to zero, they had no
 *  path whatsoever. `.os-touch-visible` renders it at rest on a coarse
 *  pointer, and it sits in the tab order on every pointer. The menu opens at
 *  the ROW's corner so it lands in the same place however it is summoned. */
function RowMenuButton({ label, onOpen }: { label: string; onOpen: (x: number, y: number) => void }) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        // Anchor on the ROW, not on this button. The button is display:none
        // at rest on a fine pointer (it appears on the row's hover), so its
        // own rect reads 0,0 whenever the menu is opened by anything other
        // than a mouse sitting on it: a keyboard Enter, a touch tap, or a
        // script. The row is always laid out, so the menu always lands under
        // the row it belongs to.
        const el = e.currentTarget as HTMLElement;
        const row = (el.closest("li") ?? el).getBoundingClientRect();
        onOpen(Math.max(0, row.right - 224), row.bottom + 4);
      }}
      className="os-touch-visible absolute end-1.5 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-ink-3 hover:bg-active hover:text-ink group-hover/row:flex group-focus-within/row:flex focus-visible:flex"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}

export function TalkSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  // /announcements and /announcements/<id> are both "the Announcements row".
  const announcementsActive = pathname === "/announcements" || pathname.startsWith("/announcements/");
  // Talk home's active view, read off the URL (never stored nav state).
  const homeView = useSearchParams().get("view");
  const { query } = useSidebarSearch();
  const { data: session } = useSession();
  const { isGuest } = useViewerRole();
  const { launcherApps } = useOsShell();
  const { toast } = useOsToast();
  // The folded `announcements` app, as the rail resolver sees it. An Admin
  // who hides or floors it removes this row with the page.
  const announcementsVisible = launcherApps.some((a) => a.key === "announcements");
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  // No accessLevel read here any more. The one row that asked for a tier was
  // Directory, which is gone; everything left is either "every Member" or
  // "not a Guest", and that is useViewerRole()'s question, not the eight
  // level ladder's (the access engine owns that, and the lint rule that
  // refuses `accessLevel` in a component is the reminder).

  const [rows, setRows] = useState<(ConversationListRow & { activeCall?: ActiveCall })[] | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // Slack's collapsible sections; persisted so the layout is stable.
  const [collapsed, setCollapsed] = useState<{ channels: boolean; dms: boolean }>({ channels: false, dms: false });
  useEffect(() => {
    try {
      const raw = readTalkKey(TALK_SECTIONS_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* corrupt/absent, defaults */ }
  }, []);
  const toggleSection = (key: "channels" | "dms") =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(TALK_SECTIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  // Right-click context menu on rows (channels + DMs), Slack-style.
  const [rowMenu, setRowMenu] = useState<{
    id: string; type: string; name: string; starred: boolean; muted: boolean;
    isGeneral: boolean; x: number; y: number;
  } | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<{ id: string; name: string } | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  /** The Unread row's badge: conversations with something unread in them,
   *  the same number Talk home's Unread tab shows, from the same payload. */
  const unreadConversations = (rows ?? []).filter((r) => (r.unreadCount ?? 0) > 0).length;

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setRows((d.conversations ?? []) as (ConversationListRow & { activeCall?: ActiveCall })[]);
      setChannels((d.channels ?? []) as ChannelRow[]);
    } catch { /* keep the last good list, a blip must not blank the sidebar */ }
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

  // MESSAGE SEARCH IS NOT HERE ANY MORE. spec-talk section 1 says the hub
  // search "never searches messages", and 2.1 moves cross-conversation
  // message search into the ⌘K palette (a MESSAGES group, added in
  // command-palette.tsx) and into the conversation's own Search panel. The
  // capability is not lost, it moved: the palette hit carries ?m=, which
  // this sidebar's hits never did, so a search result now lands ON the
  // message instead of at the bottom of the conversation (comms #30).

  const filtered = useMemo(() => {
    if (!rows) return null;
    const direct = rows.filter((r) => r.type !== "CHANNEL");
    if (!q) return direct;
    return direct.filter((r) => conversationTitle(r, meId).toLowerCase().includes(q));
  }, [rows, q, meId]);

  // Unread + live-call badges for channels come from the conversation
  // list (member rows), the channel directory itself carries neither.
  const channelUnread = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) if (r.type === "CHANNEL") map.set(r.id, r.unreadCount);
    return map;
  }, [rows]);
  const channelMentions = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) if (r.type === "CHANNEL") map.set(r.id, r.unreadMentions ?? 0);
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

  /* ── row context-menu actions (all optimistic + toast on failure) ── */
  const patchConversation = async (id: string, body: Record<string, unknown>, okMsg: string, failMsg: string) => {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) { toast(okMsg); void load(); }
    else toast(failMsg);
  };

  /** Slack's close: hides the row, keeps every message. Any new message
   *  (or starting the DM again) brings it back. DMs only, groups have
   *  Leave (closing a group would have no reopen path). The PATCH is
   *  AWAITED before any redirect so the Talk landing can't race the
   *  still-visible row and bounce back in; failure restores the row. */
  const closeConversation = async (id: string) => {
    const snapshot = rows;
    setRows((prev) => prev ? prev.filter((r) => r.id !== id) : prev);
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    }).catch(() => null);
    if (res?.ok) {
      toast("Conversation closed, history is kept");
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
      try { sessionStorage.setItem(talkLeftKey(target.id), "1"); } catch { /* private mode */ }
      if (pathname === `/tlk/${target.id}`) router.push("/tlk");
      void load();
    } else toast("Couldn't leave the channel");
  };

  const openRowMenu = (e: React.MouseEvent, opts: { id: string; type: string; name: string; starred: boolean; muted: boolean; isGeneral: boolean }) => {
    e.preventDefault();
    setRowMenu({ ...opts, x: e.clientX, y: e.clientY });
  };

  const openChannel = async (c: ChannelRow) => {
    // An explicit open is consent, clear any "just left" marker so the
    // page's auto-join guard doesn't block this deliberate rejoin.
    // Both spellings: the legacy key may have been written before the
    // rename and would otherwise keep suppressing the self-join.
    try {
      sessionStorage.removeItem(talkLeftKey(c.id));
      sessionStorage.removeItem(legacyTalkLeftKey(c.id));
    } catch { /* private mode */ }
    if (c.isMember) { router.push(`/tlk/${c.id}`); return; }
    setJoining(c.id);
    try {
      const r = await fetch(`/api/conversations/${c.id}/join`, { method: "POST" });
      if (r.ok) {
        window.dispatchEvent(new Event("workwrk:chat-changed"));
        router.push(`/tlk/${c.id}`);
      } else {
        toast("Couldn't join the channel, try again");
      }
    } catch {
      toast("Couldn't join the channel, check your connection");
    } finally { setJoining(null); }
  };

  return (
    <div className="flex flex-col">
      {/* ONE SEARCH INPUT, and it is the shell's (spec-talk section 1 Hub
          sidebar contents: placeholder "Search Talk…", shown once the tree
          passes 12 rows, filters CHANNELS and DIRECT MESSAGES in place).
          This file used to render a SECOND box, "Find a conversation…",
          directly under it, so the Talk hub was the one sidebar in the
          product with two identical-looking search fields stacked on each
          other. The filter below reads `query` from the shell's box, which
          is the same value the removed one produced. */}
      {/* sidebar-map section 4 rows 1 to 3: the three views of Talk home.
          They exist now that /tlk IS a home rather than a jump into the
          newest conversation, and each carries the count of the thing it
          holds. The active row is derived from the URL on every render, so
          landing on a copied /tlk?view=mentions link highlights the right
          one without any stored nav state. */}
      <ul className="mb-1 flex flex-col gap-0.5">
        {TALK_HOME_ROWS.map((row) => {
          const active = pathname === "/tlk" && (row.view === null ? !homeView : homeView === row.view);
          const count = row.view === null ? unreadConversations : 0;
          return (
            <li key={row.label}>
              <Link
                href={row.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-9 items-center gap-3 rounded-lg px-3 ${active ? "bg-side-pill font-medium text-ink-strong" : "text-ink hover:bg-hover"}`}
              >
                <row.Icon className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                <span className="flex-1 truncate">{row.label}</span>
                {count > 0 ? <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The Directory row is gone (spec-talk section 0). It navigated out
          of the Talk hub into the Teams hub, which is where the Directory
          lives and is still one rail click away. Inside Talk, New message's
          people picker is the way to reach a person. */}
      {/* sidebar-map section 4 row 4: every Member, never a Guest, AND only
          while the folded `announcements` app is visible. An Admin who hides
          or floors it in Workspace settings > Apps & modules > Rail apps
          removes this row, the page and the palette entries together, which
          is the one rule read in three places rather than three rules.

          This is also the row that keeps the Talk hub reachable when the
          Talk module is off: rail-apps.ts MODULE_HUB_SURVIVES_ON keeps the
          `chat` hub alive for it, shell-context's hubSidebarApp renders the
          Announcements app's sidebar in its place, and hubDefaultHref sends
          the pill to /announcements. */}
      {!isGuest && announcementsVisible ? (
        /* AND IT HIGHLIGHTS. Every row above derives an active class from the
           URL; this one hard-coded the resting state, so standing on
           /announcements or /announcements/[id] left the whole sidebar
           unselected. It is also the row that must highlight in the
           module-off state, because it is then the only row there is. */
        <Link
          href="/announcements"
          aria-current={announcementsActive ? "page" : undefined}
          className={`flex h-9 items-center gap-3 rounded-lg px-3 ${
            announcementsActive ? "bg-side-pill font-medium text-ink-strong" : "text-ink hover:bg-hover"
          }`}
        >
          <Megaphone className="h-5 w-5 text-ink-2" strokeWidth={1.5} /> Announcements
        </Link>
      ) : null}
      {/* A plain row, not a dashed button. The design system retires dashed
          affordances in the sidebar (spec-talk section 1, Empty sidebar: "No
          dashed buttons, no hero card"), and this reads as one of the rows
          around it because that is what it is. */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="mb-1 flex h-9 w-full items-center gap-3 rounded-lg px-3 text-ink hover:bg-hover"
      >
        <Plus className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        New message
      </button>

      {rows !== null && !q && rows.some((r) => r.myStarred) && (
        <>
          <div className="px-1 pt-1 pb-1">
            <span className="inline-flex items-center gap-1 px-1 text-sm font-semibold text-ink-2">
              <Star className="h-3.5 w-3.5 text-ink-3" /> Starred
            </span>
          </div>
          <ul className="mb-2 flex flex-col gap-0.5">
            {(rows ?? []).filter((r) => r.myStarred).map((row) => (
              <li key={`star-${row.id}`}>
                <Link
                  href={`/tlk/${row.id}`}
                  className={`flex h-9 items-center gap-3 rounded-lg px-3 ${pathname === `/tlk/${row.id}` ? "bg-side-pill" : "hover:bg-hover"}`}
                >
                  {row.type === "CHANNEL"
                    ? <Hash className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} />
                    : <MessageCircle className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} />}
                  <span className={`min-w-0 flex-1 truncate text-base ${row.unreadCount > 0 ? "font-medium text-ink-strong" : "text-ink"}`}>
                    {row.type === "CHANNEL" ? `#${row.name ?? "channel"}` : conversationTitle(row, meId)}
                  </span>
                  <RowBadges unread={row.unreadCount} mentions={row.unreadMentions ?? 0} call={row.activeCall} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {filtered !== null && (visibleChannels.length > 0 || q === "") && (
        <>
          {/* NO "+" ON THE SECTION LABEL. spec-talk section 1 forbids it
              twice, in the same words for CHANNELS and for DIRECT MESSAGES,
              because create lives in the sidebar header "+" (design 4.2) and
              that is meant to be the only "+" in this sidebar. Both rows
              still exist there: New message and New channel. */}
          <div className="flex items-center px-1 pt-1 pb-1">
            <button
              type="button"
              onClick={() => toggleSection("channels")}
              className="inline-flex items-center gap-1 rounded px-1 text-sm font-semibold text-ink-2 hover:bg-subtle"
              aria-expanded={!collapsed.channels}
            >
              {collapsed.channels ? <ChevronRight className="w-3.5 h-3.5 text-ink-3 rtl:rotate-180" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-3" />}
              Channels
            </button>
          </div>
          <ul className={`flex flex-col gap-0.5 mb-2 ${collapsed.channels ? "hidden" : ""}`}>
            {visibleChannels.map((c) => {
              const active = pathname === `/tlk/${c.id}`;
              const unread = channelUnread.get(c.id) ?? 0;
              return (
                <li key={c.id} className="group/row relative">
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
                    className={`w-full flex items-center gap-3 h-9 px-3 rounded-lg text-start ${
                      active ? "bg-side-pill" : "hover:bg-hover"
                    } ${c.isMember ? "" : "opacity-70"}`}
                  >
                    {c.restricted
                      ? <Lock className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-label="Private channel" />
                      : <Hash className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />}
                    <span className={`min-w-0 flex-1 truncate text-base ${unread > 0 ? "font-medium text-ink-strong" : "text-ink"}`}>
                      {c.name}
                      {c.archived ? <span className="ms-1.5 text-xs font-normal text-ink-3">Archived</span> : null}
                    </span>
                    <RowBadges unread={unread} mentions={channelMentions.get(c.id) ?? 0} call={channelCalls.get(c.id) ?? null} />
                    {unread === 0 && !c.isMember ? (
                      <span className="shrink-0 text-xs text-ink-3">{joining === c.id ? "Joining…" : "Join"}</span>
                    ) : null}
                  </button>
                  {c.isMember ? (
                    <RowMenuButton
                      label={`#${c.name ?? "channel"} options`}
                      onOpen={(x, y) => setRowMenu({
                        id: c.id, type: "CHANNEL", name: `#${c.name ?? "channel"}`,
                        starred: Boolean((rows ?? []).find((r) => r.id === c.id)?.myStarred),
                        muted: (rows ?? []).find((r) => r.id === c.id)?.myNotifyLevel === "mute",
                        isGeneral: (c.name ?? "").toLowerCase() === "general",
                        x, y,
                      })}
                    />
                  ) : null}
                </li>
              );
            })}
            {/* Browse channels: the last row of the section, and the only way
                into a channel nobody has sent you a link to. Guests never
                browse; they hold exactly the channels they were handed. */}
            {!isGuest && !collapsed.channels ? (
              <li>
                <button
                  type="button"
                  onClick={() => setBrowseOpen(true)}
                  className="flex h-8 w-full items-center gap-3 rounded-lg px-3 text-start text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <Compass className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  Browse channels
                </button>
              </li>
            ) : null}
          </ul>
          <div className="flex items-center px-1 pt-1 pb-1">
            <button
              type="button"
              onClick={() => toggleSection("dms")}
              className="inline-flex items-center gap-1 rounded px-1 text-sm font-semibold text-ink-2 hover:bg-subtle"
              aria-expanded={!collapsed.dms}
            >
              {collapsed.dms ? <ChevronRight className="w-3.5 h-3.5 text-ink-3 rtl:rotate-180" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-3" />}
              Direct messages
            </button>
          </div>
        </>
      )}

      {filtered === null ? (
        /* The shape that is coming, not the word "Loading" (spec-shell 1.6
           bans the bare string and the spinner both).
           SkeletonRows is NOT used here on purpose: it draws a bordered
           table body, and this is a sidebar list of pill rows with no
           dividers, so its borders would land six lines across the rail.
           Six bars at the rail's own h-7 row height, 60/40/80 percent wide
           the way the primitive does, so nothing jumps when the real rows
           arrive. */
        <ul aria-busy="true" aria-label="Loading conversations" className="space-y-0.5 px-1 py-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="flex h-7 items-center">
              <Skeleton className="h-3.5" />
              <span className="shrink-0" style={{ width: ["40%", "60%", "20%"][i % 3] }} />
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <MessageCircle className="w-5 h-5 text-ink-4 mx-auto mb-2" />
          <p className="text-sm text-ink-2">
            {q ? "No conversations match" : "No conversations yet. Start one with New message."}
          </p>
        </div>
      ) : collapsed.dms && !q ? null : (
        <ul className="flex flex-col gap-0.5">
          {filtered.map((row) => {
            const active = pathname === `/tlk/${row.id}`;
            const title = conversationTitle(row, meId);
            const avatarUser = conversationAvatarUser(row, meId);
            return (
              // ONE LINE, 36px. spec-talk section 1: "single line only (the
              // message preview goes; the row is 36)". The two-line row made
              // the DM section taller than every other row in the tree and
              // the sidebar lost its rhythm.
              <li key={row.id} className="group/row relative">
                <Link
                  href={`/tlk/${row.id}`}
                  onContextMenu={(e) => openRowMenu(e, {
                    id: row.id, type: row.type, name: conversationTitle(row, meId),
                    starred: Boolean(row.myStarred), muted: row.myNotifyLevel === "mute",
                    isGeneral: row.type === "CHANNEL" && (row.name ?? "").toLowerCase() === "general",
                  })}
                  className={`flex items-center gap-3 h-9 px-3 rounded-lg ${
                    active ? "bg-side-pill" : "hover:bg-hover"
                  }`}
                >
                  {row.type === "DM" && avatarUser ? (
                    <TeamAvatar name={`${avatarUser.firstName} ${avatarUser.lastName}`} avatar={avatarUser.avatar} size={20} />
                  ) : (
                    <span className="h-5 w-5 rounded-full bg-hover text-ink-2 inline-flex items-center justify-center shrink-0">
                      <Users className="w-3 h-3" />
                    </span>
                  )}
                  <span className={`min-w-0 flex-1 truncate text-base ${row.unreadCount > 0 ? "font-medium text-ink-strong" : "text-ink"}`}>
                    {title}
                  </span>
                  <RowBadges unread={row.unreadCount} mentions={row.unreadMentions ?? 0} call={row.activeCall} />
                </Link>
                <RowMenuButton
                  label={`${title} options`}
                  onOpen={(x, y) => setRowMenu({
                    id: row.id, type: row.type, name: conversationTitle(row, meId),
                    starred: Boolean(row.myStarred), muted: row.myNotifyLevel === "mute",
                    isGeneral: row.type === "CHANNEL" && (row.name ?? "").toLowerCase() === "general",
                    x, y,
                  })}
                />
              </li>
            );
          })}
        </ul>
      )}

      {rowMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRowMenu(null); }} />
          <div
            className="fixed z-50 w-56 rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]"
            // Clamped at BOTH ends: a viewport smaller than the menu made the
            // old max-only clamp produce a negative coordinate and pushed the
            // menu off the top-left corner.
            style={{
              left: typeof window === "undefined" ? rowMenu.x : Math.max(8, Math.min(rowMenu.x, window.innerWidth - 240)),
              top: typeof window === "undefined" ? rowMenu.y : Math.max(8, Math.min(rowMenu.y, window.innerHeight - 260)),
            }}
          >
            <button type="button" onClick={() => { setRowMenu(null); router.push(`/tlk/${rowMenu.id}`); }} className="flex h-8 w-full items-center gap-2 px-3 text-sm text-ink hover:bg-subtle">
              <ExternalLink className="h-4 w-4 text-ink-3" /> Open
            </button>
            <button
              type="button"
              onClick={() => {
                const m = rowMenu; setRowMenu(null);
                if (pathname === `/tlk/${m.id}`) window.dispatchEvent(new CustomEvent(TALK_START_CALL_EVENT, { detail: { id: m.id } }));
                else router.push(`/tlk/${m.id}?call=1`);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-sm text-ink hover:bg-subtle"
            >
              <Video className="h-4 w-4 text-ink-3" /> Start call
            </button>
            {(() => {
              // Live state at ACTION time, the snapshot in rowMenu can go
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
                    className="flex h-8 w-full items-center gap-2 px-3 text-sm text-ink hover:bg-subtle"
                  >
                    <Star className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-400" : "text-ink-3"}`} />
                    {starred ? "Remove from Starred" : "Star"}
                  </button>
                  {/* NOTIFICATIONS, the three-state (naming-canon: "All
                      messages / Mentions only / Muted" replaces mute). The
                      toggle could only reach two of the three, so a channel
                      unmuted from here landed on the default rather than on
                      whatever the person had chosen. */}
                  <span className="mt-1 block px-3 pb-0.5 text-micro font-semibold uppercase tracking-wide text-ink-3">
                    Notifications
                  </span>
                  {([
                    { value: "all", label: "All messages" },
                    { value: "mentions", label: "Mentions only" },
                    { value: "mute", label: "Muted" },
                  ] as const).map((lvl) => {
                    const current = muted ? "mute" : (liveRow?.myNotifyLevel ?? unmuteLevel);
                    return (
                      <button
                        key={lvl.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={current === lvl.value}
                        onClick={() => { const m = rowMenu; setRowMenu(null); void patchConversation(m.id, { notifyLevel: lvl.value }, lvl.value === "mute" ? "Muted" : "Notifications updated", "Couldn't update notifications"); }}
                        className="flex h-8 w-full items-center gap-2 px-3 text-sm text-ink hover:bg-subtle"
                      >
                        <Check className={`h-4 w-4 ${current === lvl.value ? "text-[var(--os-brand)]" : "text-transparent"}`} />
                        {lvl.label}
                      </button>
                    );
                  })}
                  <div className="my-1 h-px bg-hover" />
                  {rowMenu.type === "CHANNEL" ? (
                    !rowMenu.isGeneral && (
                      <button type="button" onClick={() => { const m = rowMenu; setRowMenu(null); setConfirmLeaveId({ id: m.id, name: m.name }); }} className="flex h-8 w-full items-center gap-2 px-3 text-sm text-danger-text hover:bg-danger-bg">
                        <LogOut className="h-4 w-4" /> Leave channel
                      </button>
                    )
                  ) : rowMenu.type === "DM" ? (
                    <button type="button" onClick={() => { const m = rowMenu; setRowMenu(null); void closeConversation(m.id); }} className="flex h-8 w-full items-center gap-2 px-3 text-sm text-ink hover:bg-subtle">
                      <X className="h-4 w-4 text-ink-3" /> Close conversation
                    </button>
                  ) : (
                    <button type="button" onClick={() => { const m = rowMenu; setRowMenu(null); setConfirmLeaveId({ id: m.id, name: m.name }); }} className="flex h-8 w-full items-center gap-2 px-3 text-sm text-danger-text hover:bg-danger-bg">
                      <LogOut className="h-4 w-4" /> Leave group
                    </button>
                  )}
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

      {/* The two dialogs used to live INSIDE this file, 220 lines of it, each
          with its own copy of the people search. They are shared components
          now (src/components/talk/), so Talk home and the empty states open
          the same New message everybody else does. */}
      <NewChannelDialog open={channelModalOpen} onClose={() => setChannelModalOpen(false)} />
      <NewMessageDialog open={modalOpen} onClose={() => setModalOpen(false)} />
      <BrowseChannelsDialog
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onCreateChannel={() => setChannelModalOpen(true)}
      />
    </div>
  );
}
