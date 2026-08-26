"use client";

// The message feed shared by the main conversation pane and thread
// panels: day dividers, author grouping, reactions, attachments,
// mention highlighting, call cards, edit-in-place, and thread chips.

import { useMemo, useState } from "react";
import {
  Check, MessageSquare, Paperclip, Pencil, RefreshCw, Smile, Trash2, Video, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { RichBody } from "@/components/chat/rich-body";
import type { ChatUserLite } from "@/components/chat/conversation-utils";

export type ChatAttachment = { url: string; name: string; type: string; size: number; s3Key?: string };

export type FeedMessage = {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  parentId?: string | null;
  replyCount?: number;
  metadata?: {
    kind?: string;
    reactions?: Record<string, string[]>;
    attachments?: ChatAttachment[];
    mentions?: string[];
  } | null;
  author: ChatUserLite;
  /** Client-only send states. */
  pending?: boolean;
  failed?: boolean;
};

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "😮", "🙏"];

export function MessageFeed({ messages, meId, memberNames, onRetry, onJoinCall, onReact, onEdit, onDelete, onOpenThread }: {
  messages: FeedMessage[];
  meId: string | null;
  /** userId → display name, for reaction tooltips + mention highlighting. */
  memberNames: Map<string, string>;
  onRetry: (m: FeedMessage) => void;
  onJoinCall: () => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, newBody: string) => void;
  onDelete: (m: FeedMessage) => void;
  /** Absent inside a thread panel — threads don't nest. */
  onOpenThread?: (m: FeedMessage) => void;
}) {
  const items = useMemo(() => {
    const out: Array<{ kind: "day"; key: string; label: string } | { kind: "msg"; key: string; msg: FeedMessage; head: boolean }> = [];
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
        <div key={it.key} className="relative flex items-center justify-center py-3">
          <span className="absolute inset-x-0 top-1/2 h-px bg-zinc-100" />
          <span className="relative rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] font-semibold text-zinc-600 shadow-sm">
            {it.label}
          </span>
        </div>
      ) : (
        <MessageRow
          key={it.key}
          msg={it.msg}
          head={it.head}
          mine={it.msg.authorId === meId}
          meId={meId}
          memberNames={memberNames}
          onRetry={onRetry}
          onJoinCall={onJoinCall}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  );
}

function MessageRow({ msg, head, mine, meId, memberNames, onRetry, onJoinCall, onReact, onEdit, onDelete, onOpenThread }: {
  msg: FeedMessage;
  head: boolean;
  mine: boolean;
  meId: string | null;
  memberNames: Map<string, string>;
  onRetry: (m: FeedMessage) => void;
  onJoinCall: () => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, newBody: string) => void;
  onDelete: (m: FeedMessage) => void;
  onOpenThread?: (m: FeedMessage) => void;
}) {
  const [reactOpen, setReactOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);

  const time = new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isCall = msg.metadata?.kind === "call";
  const reactions = msg.metadata?.reactions ?? {};
  const attachments = msg.metadata?.attachments ?? [];
  const deleted = Boolean(msg.deletedAt);
  const canAct = !deleted && !msg.pending && !msg.failed;

  const saveEdit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== msg.body) onEdit(msg, trimmed);
    else setDraft(msg.body);
  };

  return (
    <div className={`group relative flex gap-2.5 px-1 rounded-md hover:bg-zinc-50/60 ${head ? "mt-2.5" : "mt-0.5"}`}>
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
        ) : editing ? (
          <div className="mt-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") { setEditing(false); setDraft(msg.body); }
              }}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              className="w-full resize-none rounded-md border border-zinc-300 px-2 py-1.5 text-[14px] leading-6 outline-none focus:border-[#0073EA]"
              autoFocus
            />
            <div className="mt-1 flex items-center gap-2 text-[12px]">
              <button type="button" onClick={saveEdit} className="inline-flex items-center gap-1 text-[#0073EA] font-medium"><Check className="w-3.5 h-3.5" /> Save</button>
              <button type="button" onClick={() => { setEditing(false); setDraft(msg.body); }} className="inline-flex items-center gap-1 text-zinc-500"><X className="w-3.5 h-3.5" /> Cancel</button>
              <span className="text-zinc-400">Enter saves · Esc cancels</span>
            </div>
          </div>
        ) : (
          <>
            {(msg.body || deleted) && (
              deleted ? (
                <p className="text-[14px] leading-6 italic text-zinc-400">Message removed</p>
              ) : (
                <div className={`text-zinc-800 ${msg.pending ? "opacity-60" : ""}`}>
                  <RichBody body={msg.body} memberNames={memberNames} />
                  {msg.editedAt && <span className="ml-1 text-[11px] text-zinc-400">(edited)</span>}
                </div>
              )
            )}
            {!deleted && attachments.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {attachments.map((a, i) => a.type.startsWith("image/") ? (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.name} className="max-h-56 max-w-[320px] rounded-lg border border-zinc-200 object-cover" />
                  </a>
                ) : (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" download={a.name}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-100">
                    <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="max-w-[220px] truncate">{a.name}</span>
                    {a.size > 0 && <span className="text-[11px] text-zinc-400">{prettySize(a.size)}</span>}
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {/* Reaction chips */}
        {!deleted && Object.keys(reactions).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(reactions).map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(msg, emoji)}
                title={users.map((u) => (u === meId ? "You" : memberNames.get(u) ?? "Someone")).join(", ")}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[12px] tabular-nums ${
                  meId && users.includes(meId)
                    ? "border-[#0073EA]/40 bg-[#0073EA]/8 text-[#0073EA]"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                }`}
              >
                <span>{emoji}</span> {users.length}
              </button>
            ))}
          </div>
        )}

        {/* Thread chip */}
        {onOpenThread && !msg.parentId && (msg.replyCount ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => onOpenThread(msg)}
            className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0073EA] hover:underline"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {msg.failed && (
          <button type="button" onClick={() => onRetry(msg)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-red-600 hover:text-red-700">
            <RefreshCw className="w-3 h-3" /> Failed to send — retry
          </button>
        )}
      </div>

      {/* Hover actions */}
      {canAct && !editing && (
        <div className="absolute -top-3 right-2 hidden group-hover:flex items-center rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="relative">
            <button type="button" onClick={() => setReactOpen((v) => !v)} title="React" className="h-7 w-7 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700">
              <Smile className="w-4 h-4" />
            </button>
            {reactOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setReactOpen(false)} />
                <div className="absolute right-0 top-8 z-20 flex gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
                  {QUICK_REACTIONS.map((e) => (
                    <button key={e} type="button" onClick={() => { setReactOpen(false); onReact(msg, e); }} className="h-7 w-7 rounded-md hover:bg-zinc-100 text-[15px]">
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {onOpenThread && !msg.parentId && !isCall && (
            <button type="button" onClick={() => onOpenThread(msg)} title="Reply in thread" className="h-7 w-7 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700">
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          {mine && !isCall && (
            <>
              <button type="button" onClick={() => { setDraft(msg.body); setEditing(true); }} title="Edit" className="h-7 w-7 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700">
                <Pencil className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => onDelete(msg)} title="Delete" className="h-7 w-7 inline-flex items-center justify-center text-zinc-400 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
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

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

