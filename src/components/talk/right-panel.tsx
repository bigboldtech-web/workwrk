"use client";

// The conversation's right panel (spec-talk.md section 2.2 Body layout): one
// 360px column that holds EXACTLY ONE of Thread, Details or Search at a time.
//
// Three surfaces, one container, for a reason that is not tidiness: before
// this, Thread was a 420px absolutely-positioned sheet that registered no
// layer (so Escape did not close it), Details did not exist at all, and
// search results lived in the sidebar and could not scroll the feed to the
// message they found. Making them one panel with one header, one close and
// one URL parameter each is what lets `?thread=` and `?m=` be links.
//
// The panel is presentational. Every mutation is handed up to ConversationView,
// which owns the optimistic state and the failure toasts, so nothing here has
// two sources of truth about a message.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft, Check, FileText, Hash, Link2, Lock, Pencil, Plus, Search as SearchIcon,
  Trash2, UserMinus, Users, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { Dots } from "@/components/ui/dots";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { MessageFeed, type FeedMessage } from "@/components/talk/message-feed";
import { MessageBox, type MessagePayload } from "@/components/talk/message-box";
import type { ChatUserLite } from "@/components/talk/conversation-utils";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetch } from "@/lib/api-fetch";
import {
  canAddPeople,
  canArchive,
  canEditTopic,
  canManageMembers,
  canResetGuestLink,
  canSetVisibility,
  isArchived,
  isGeneralChannel,
  type TalkConversationFacts,
  type TalkRole,
} from "@/lib/talk-access";

export type PanelKind = "thread" | "details" | "search" | null;

export interface PanelConversation extends TalkConversationFacts {
  id: string;
  findable: boolean;
  topic: string | null;
  createdAt?: string | null;
  members: {
    userId: string;
    notifyLevel?: string;
    starred?: boolean;
    joinedAt?: string;
    user: ChatUserLite & { email?: string; role?: { title: string } | null; department?: { name: string } | null };
  }[];
  call?: { room: string; guestUrl?: string; guestExpiresAt?: string } | null;
}

/** The panel frame: 48px header with a 16/600 title and one 32px ghost close. */
export function RightPanel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="tlkc__panel" aria-label={title}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-base font-semibold text-ink-strong">{title}</h2>
          {subtitle ? <p className="m-0 truncate text-xs text-ink-2">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

/* ───────────────────────────── Thread ───────────────────────────── */

export function ThreadView({
  parent,
  replies,
  meId,
  memberNames,
  members,
  canWrite,
  loading,
  onSend,
  onReact,
  onEdit,
  onDelete,
  onRetry,
  onDiscardFailed,
  onError,
}: {
  /** Null while a thread opened from a URL is still fetching its parent. */
  parent: FeedMessage | null;
  replies: FeedMessage[];
  meId: string | null;
  memberNames: Map<string, string>;
  members: { userId: string; user: ChatUserLite }[];
  canWrite: boolean;
  loading: boolean;
  onSend: (payload: MessagePayload) => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, body: string) => void;
  onDelete: (m: FeedMessage) => void;
  onRetry: (m: FeedMessage) => void;
  onDiscardFailed: (m: FeedMessage) => void;
  onError: (message: string) => void;
}) {
  const count = replies.filter((r) => !r.deletedAt).length;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {parent === null ? (
          <SkeletonRows rows={2} rowHeight="40px" />
        ) : (
        <MessageFeed
          messages={[parent]}
          meId={meId}
          memberNames={memberNames}
          onRetry={onRetry}
          onJoinCall={() => {}}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
          canReact={canWrite}
          readOnly={!canWrite}
          onDiscardFailed={onDiscardFailed}
          showDayDividers={false}
        />
        )}
        <div className="my-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-line" aria-hidden />
          <span className="text-xs font-medium text-ink-2">
            {loading ? "Loading replies" : count === 1 ? "1 reply" : `${count} replies`}
          </span>
          <span className="h-px flex-1 bg-line" aria-hidden />
        </div>
        {loading && replies.length === 0 ? (
          <SkeletonRows rows={3} rowHeight="40px" />
        ) : (
          <MessageFeed
            messages={replies}
            meId={meId}
            memberNames={memberNames}
            onRetry={onRetry}
            onJoinCall={() => {}}
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
            canReact={canWrite}
            readOnly={!canWrite}
            onDiscardFailed={onDiscardFailed}
          />
        )}
      </div>
      {canWrite ? (
        <div className="shrink-0 border-t border-line p-3">
          {/* Ghost Send: the main message box owns the page's one blue thing. */}
          <MessageBox
            members={members}
            meId={meId}
            placeholder="Reply…"
            autoFocus
            sendVariant="ghost"
            onSend={onSend}
            onError={onError}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Details ───────────────────────────── */

type FileRow = {
  messageId: string;
  name: string;
  url: string;
  type: string;
  size: number;
  createdAt: string;
  author: { id: string; name: string; avatar: string | null };
};

export function DetailsPanel({
  conversation,
  role,
  meId,
  myNotify,
  onChangeNotify,
  onSaveTopic,
  onSetVisibility,
  onRemoveMember,
  onTransfer,
  onArchive,
  onAddPeople,
  onCopyGuestLink,
  onResetGuestLink,
  onOpenSearch,
}: {
  conversation: PanelConversation;
  role: TalkRole;
  meId: string | null;
  myNotify: "all" | "mentions" | "mute";
  onChangeNotify: (level: "all" | "mentions" | "mute") => void;
  onSaveTopic: (topic: string) => Promise<boolean>;
  onSetVisibility: (patch: { restricted?: boolean; findable?: boolean }) => void;
  onRemoveMember: (userId: string, name: string) => void;
  onTransfer: (userId: string, name: string) => void;
  onArchive: (archived: boolean) => void;
  onAddPeople: () => void;
  onCopyGuestLink: () => void;
  onResetGuestLink: () => void;
  onOpenSearch: () => void;
}) {
  const { date: fmtDate, relative } = useFormat();
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(conversation.topic ?? "");
  const [savingTopic, setSavingTopic] = useState(false);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [filesError, setFilesError] = useState(false);

  const archived = isArchived(conversation);
  const general = isGeneralChannel(conversation);
  const isDM = conversation.type === "DM";
  const other = isDM ? conversation.members.find((m) => m.userId !== meId) : null;
  const owner = conversation.createdById
    ? conversation.members.find((m) => m.userId === conversation.createdById)
    : null;

  useEffect(() => { setTopicDraft(conversation.topic ?? ""); }, [conversation.topic]);

  const loadFiles = useCallback(async () => {
    setFilesError(false);
    try {
      const r = await apiFetch<{ files?: FileRow[] }>(`/api/conversations/${conversation.id}/files`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.error);
      setFiles(Array.isArray(r.data?.files) ? r.data.files : []);
    } catch {
      setFilesError(true);
    }
  }, [conversation.id]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const saveTopic = async () => {
    setSavingTopic(true);
    const ok = await onSaveTopic(topicDraft.trim());
    setSavingTopic(false);
    if (ok) setEditingTopic(false);
  };

  const sectionLabel = "px-3 pt-4 pb-1 text-micro font-semibold uppercase tracking-wide text-ink-3";

  return (
    <div className="pb-6">
      {/* About */}
      <h3 className={sectionLabel}>About</h3>
      <div className="px-3">
        {isDM && other ? (
          <div className="flex items-start gap-3 py-2">
            <TeamAvatar name={`${other.user.firstName} ${other.user.lastName}`} avatar={other.user.avatar} size={40} />
            <div className="min-w-0">
              <p className="m-0 truncate text-base font-medium text-ink">{other.user.firstName} {other.user.lastName}</p>
              <p className="m-0 truncate text-xs text-ink-2">
                {[other.user.role?.title, other.user.department?.name].filter(Boolean).join(" · ") || other.user.email}
              </p>
              <a href={`/people/${other.userId}`} className="mt-1 inline-block text-xs font-medium text-[var(--os-brand-deep)] hover:underline">
                View profile
              </a>
            </div>
          </div>
        ) : editingTopic ? (
          <div className="py-1">
            <textarea
              value={topicDraft}
              autoFocus
              rows={3}
              maxLength={280}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setEditingTopic(false); setTopicDraft(conversation.topic ?? ""); } }}
              className="w-full resize-none rounded-md border border-line-strong bg-app p-2 text-sm text-ink outline-none"
              placeholder="What is this channel for?"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveTopic()}
                disabled={savingTopic}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink hover:bg-hover"
              >
                {savingTopic ? <Dots variant="pending" label="Saving" /> : <Check className="h-3.5 w-3.5" />} Save
              </button>
              <button
                type="button"
                onClick={() => { setEditingTopic(false); setTopicDraft(conversation.topic ?? ""); }}
                className="h-7 rounded-md px-2 text-xs text-ink-2 hover:bg-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="group/topic flex items-start gap-2 py-1">
            <p className="m-0 flex-1 text-sm text-ink">
              {conversation.topic || <span className="text-ink-3">No topic yet</span>}
            </p>
            {canEditTopic(conversation, role) ? (
              <button
                type="button"
                onClick={() => setEditingTopic(true)}
                aria-label="Edit topic"
                className="os-touch-visible hidden h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink group-hover/topic:flex focus-visible:flex"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )}
        {owner ? (
          <p className="m-0 pt-1 text-xs text-ink-3">
            Created by {owner.user.firstName} {owner.user.lastName}
            {conversation.createdAt ? ` · ${fmtDate(conversation.createdAt, "date")}` : ""}
          </p>
        ) : null}
      </div>

      {/* Notifications */}
      <h3 className={sectionLabel}>Notifications</h3>
      <div className="px-3">
        <SegmentedControl
          label="Notifications for this conversation"
          size="sm"
          value={myNotify}
          onChange={(v) => onChangeNotify(v)}
          options={[
            { value: "all", label: "All messages" },
            { value: "mentions", label: "Mentions only" },
            { value: "mute", label: "Muted" },
          ]}
        />
      </div>

      {/* Visibility, channels only, Full holders only */}
      {conversation.type === "CHANNEL" && canSetVisibility(conversation, role) ? (
        <>
          <h3 className={sectionLabel}>Who can reach this channel</h3>
          <div className="px-3">
            <label className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-ink">Restricted</span>
                <span className="block text-xs text-ink-2">Only people you add can open it. It stops appearing in Browse channels.</span>
              </span>
              <Switch
                checked={conversation.restricted}
                aria-label="Restricted"
                onChange={(v) => onSetVisibility({ restricted: v })}
              />
            </label>
            {!conversation.restricted ? (
              <label className="flex items-center justify-between gap-3 border-t border-line-soft py-2">
                <span className="min-w-0">
                  <span className="block text-sm text-ink">Findable</span>
                  <span className="block text-xs text-ink-2">Listed in Browse channels for everyone at this company.</span>
                </span>
                <Switch
                  checked={conversation.findable}
                  aria-label="Findable"
                  onChange={(v) => onSetVisibility({ findable: v })}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Members */}
      {!isDM ? (
        <>
          <h3 className={sectionLabel}>Members ({conversation.members.length})</h3>
          <div className="px-1.5">
            {canAddPeople(conversation, role) ? (
              <button
                type="button"
                onClick={onAddPeople}
                className="flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-sm font-medium text-[var(--os-brand-deep)] hover:bg-hover"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-line-strong">
                  <Plus className="h-3 w-3" />
                </span>
                Add people
              </button>
            ) : null}
            {conversation.members.map((m) => {
              const name = `${m.user.firstName} ${m.user.lastName}`.trim();
              const isOwner = m.userId === conversation.createdById;
              return (
                <div key={m.userId} className="group/member flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
                  <TeamAvatar name={name} avatar={m.user.avatar} size={20} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}{m.userId === meId ? " (you)" : ""}</span>
                  {isOwner ? <span className="shrink-0 text-xs text-ink-2">Owner</span> : null}
                  {canManageMembers(conversation, role) && m.userId !== meId ? (
                    <span className="os-touch-visible hidden shrink-0 items-center group-hover/member:flex focus-within:flex">
                      {!isOwner ? (
                        <button
                          type="button"
                          onClick={() => onTransfer(m.userId, name)}
                          title={`Make ${name} the owner`}
                          aria-label={`Make ${name} the owner`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-subtle hover:text-ink"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {!isOwner ? (
                        <button
                          type="button"
                          onClick={() => onRemoveMember(m.userId, name)}
                          title={`Remove ${name}`}
                          aria-label={`Remove ${name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-subtle hover:text-danger-text"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Files */}
      {/*
        No number next to "Files" on purpose. The route pages this list (it
        flattens attachments out of a bounded window of messages, there being
        no file table to count), so what comes back is one page, not a total.
        Printing its length put "Files (20)" above a channel holding forty of
        them, and the "Show all files" link underneath made that read as the
        whole tally. A count we cannot stand behind is worse than no count, so
        the heading names the section and the link owns "all".
      */}
      <h3 className={sectionLabel}>Files</h3>
      <div className="px-1.5">
        {files === null && !filesError ? (
          <div className="px-1.5"><SkeletonRows rows={3} rowHeight="32px" /></div>
        ) : filesError ? (
          <button type="button" onClick={() => void loadFiles()} className="px-1.5 py-2 text-sm text-ink-2 underline underline-offset-2">
            Couldn&rsquo;t load files. Retry
          </button>
        ) : files && files.length === 0 ? (
          <p className="m-0 px-1.5 py-2 text-sm text-ink-2">No files shared yet</p>
        ) : (
          <>
            {files?.map((f) => (
              <a
                key={`${f.messageId}-${f.name}`}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-hover"
              >
                <FileText className="h-4 w-4 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{f.name}</span>
                  <span className="block truncate text-xs text-ink-2">{f.author.name} · {relative(f.createdAt)}</span>
                </span>
              </a>
            ))}
            {files && files.length > 0 ? (
              <button type="button" onClick={onOpenSearch} className="px-1.5 py-2 text-xs font-medium text-[var(--os-brand-deep)] hover:underline">
                Show all files
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Guest link */}
      {!archived && conversation.call?.guestUrl && conversation.type !== "DM" ? (
        <>
          <h3 className={sectionLabel}>Guest link</h3>
          <div className="px-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={conversation.call.guestUrl}
                aria-label="Guest link"
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-app px-2 text-xs text-ink-2 outline-none"
              />
              <button
                type="button"
                onClick={onCopyGuestLink}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink hover:bg-hover"
              >
                <Link2 className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <p className="m-0 mt-1.5 text-xs text-ink-2">
              Anyone with this link can join this conversation&rsquo;s calls
              {conversation.call.guestExpiresAt ? ` until ${fmtDate(conversation.call.guestExpiresAt, "datetime")}` : ""}. No account needed.
              {canResetGuestLink(conversation, role) ? (
                <>
                  {" "}
                  <button type="button" onClick={onResetGuestLink} className="font-medium text-[var(--os-brand-deep)] underline underline-offset-2 hover:no-underline">
                    Reset
                  </button>
                </>
              ) : null}
            </p>
          </div>
        </>
      ) : null}

      {/* Danger zone: archive and restore. Never on #general. */}
      {canArchive(conversation, role) && !general ? (
        <div className="mx-3 mt-5 rounded-lg border p-3"
          style={{ borderColor: "var(--signal-danger-border)" }}>
          <p className="m-0 text-sm font-medium text-ink">{archived ? "This channel is archived" : "Archive this channel"}</p>
          <p className="m-0 mt-0.5 text-xs text-ink-2">
            {archived
              ? "Nobody can post in it. Its history stays, and restoring it brings everything back."
              : "It becomes read-only for everyone. Nothing is deleted, and you can restore it."}
          </p>
          <button
            type="button"
            onClick={() => onArchive(!archived)}
            className={`mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${
              archived ? "border border-line text-ink hover:bg-hover" : "text-danger-text hover:bg-danger-bg"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" /> {archived ? "Restore channel" : "Archive channel"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Search ───────────────────────────── */

type SearchHit = {
  messageId: string;
  author: { id: string; firstName: string; lastName: string };
  snippet: string;
  createdAt: string;
  inThread: boolean;
  attachmentNames: string[];
};

export function SearchPanel({
  conversationId,
  members,
  initialFiles = false,
  onOpenMessage,
}: {
  conversationId: string;
  members: { userId: string; user: ChatUserLite }[];
  initialFiles?: boolean;
  onOpenMessage: (messageId: string) => void;
}) {
  const { date: fmtDate } = useFormat();
  const [q, setQ] = useState("");
  const [filesOnly, setFilesOnly] = useState(initialFiles);
  const [from, setFrom] = useState<string>("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);

  const run = useCallback(async () => {
    const mine = ++reqRef.current;
    const query = q.trim();
    if (query.length < 2 && !filesOnly && !from) { setHits(null); setFailed(false); return; }
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ conversationId });
      if (query.length >= 2) params.set("q", query);
      if (filesOnly) params.set("files", "1");
      if (from) params.set("from", from);
      const r = await apiFetch<{ results?: SearchHit[] }>(`/api/conversations/search-messages?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.error);
      if (reqRef.current !== mine) return;
      setHits(Array.isArray(r.data?.results) ? r.data.results : []);
    } catch {
      if (reqRef.current === mine) { setFailed(true); setHits(null); }
    } finally {
      if (reqRef.current === mine) setLoading(false);
    }
  }, [conversationId, q, filesOnly, from]);

  // Debounced: a search panel that fires per keystroke is a search panel that
  // rate-limits its own user.
  useEffect(() => {
    const t = setTimeout(() => void run(), 220);
    return () => clearTimeout(t);
  }, [run]);

  const people = useMemo(
    () => members.map((m) => ({ id: m.userId, name: `${m.user.firstName} ${m.user.lastName}`.trim() })),
    [members],
  );

  const chip = (active: boolean) =>
    `inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs ${
      active ? "border-[var(--os-brand)] bg-selected text-[var(--os-brand-deep)]" : "border-line text-ink-2 hover:border-line-strong"
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-app px-2">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this conversation"
            aria-label="Search this conversation"
            className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setFilesOnly((v) => !v)} className={chip(filesOnly)} aria-pressed={filesOnly}>
            Files
          </button>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Filter by person</span>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${chip(Boolean(from))} appearance-none bg-transparent pe-1`}
            >
              <option value="">From anyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && hits === null ? (
          <div className="p-3"><SkeletonRows rows={4} rowHeight="44px" /></div>
        ) : failed ? (
          <OsEmptyView title="Couldn't search" hint="Something went wrong reading this conversation." variant="error" action={{ label: "Retry", onClick: () => void run() }} />
        ) : hits === null ? (
          <p className="m-0 p-4 text-sm text-ink-2">Type to search, or pick a filter.</p>
        ) : hits.length === 0 ? (
          <p className="m-0 p-4 text-sm text-ink-2">Nothing matched.</p>
        ) : (
          <ul className="m-0 list-none p-1.5">
            {hits.map((h) => (
              <li key={h.messageId}>
                <button
                  type="button"
                  onClick={() => onOpenMessage(h.messageId)}
                  className="w-full rounded-md px-2 py-2 text-start hover:bg-hover"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{h.author.firstName} {h.author.lastName}</span>
                    <span className="shrink-0 text-xs text-ink-3">{fmtDate(h.createdAt, "smart")}</span>
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs text-ink-2">{h.snippet || "(no text)"}</span>
                  {h.attachmentNames.length > 0 ? (
                    <span className="mt-1 block truncate text-xs text-ink-3">{h.attachmentNames.join(", ")}</span>
                  ) : null}
                  {h.inThread ? <span className="mt-0.5 block text-xs text-ink-3">In a thread</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The channel glyph the panel headers and the conversation header share. */
export function ConversationGlyph({ type, restricted, size = 20 }: { type: string; restricted?: boolean; size?: number }) {
  const cls = "text-ink-2";
  const style = { width: size, height: size };
  if (type === "CHANNEL") {
    return restricted
      ? <Lock className={cls} style={style} aria-label="Private channel" />
      : <Hash className={cls} style={style} aria-hidden />;
  }
  return <Users className={cls} style={style} aria-hidden />;
}
