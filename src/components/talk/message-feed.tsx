"use client";

// The message feed shared by the main conversation pane and thread
// panels: day dividers, author grouping, reactions, attachments,
// mention highlighting, call cards, edit-in-place, and thread chips.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ClipboardCopy, Link2, MessageSquare, MoreHorizontal, Paperclip, Pencil, Phone,
  Smile, Trash2, Video, X,
} from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";
import { Dots } from "@/components/ui/dots";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { RichBody } from "@/components/talk/rich-body";
import type { ChatUserLite } from "@/components/talk/conversation-utils";
import { QUICK_REACTIONS as QUICK_THREE } from "@/lib/emoji-data";
import { useFormat } from "@/lib/format/use-date-prefs";
import { dayKey, type DateFormatPrefs } from "@/lib/format/date";

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
  /** Thread chip: when the last reply landed, and up to three repliers. */
  lastReplyAt?: string | null;
  replyAuthorIds?: string[];
  metadata?: {
    kind?: string;
    reactions?: Record<string, string[]>;
    attachments?: ChatAttachment[];
    mentions?: string[];
    /// Call cards: cumulative participant roll + finish stamp.
    names?: string[];
    endedAt?: string;
    durationMin?: number;
  } | null;
  author: ChatUserLite;
  /** Client-only send states. */
  pending?: boolean;
  failed?: boolean;
};

// The three quick reactions shown at rest, and the full picker behind the
// React button, both come from src/lib/emoji-data.ts. The nine-emoji literal
// that used to live here could not produce clap, which the reaction endpoint
// accepts, so the picker and the server disagreed about what a reaction is.
export { REACTION_EMOJI as QUICK_REACTIONS } from "@/lib/emoji-data";

export function MessageFeed({ messages, meId, memberNames, onRetry, onJoinCall, onReact, onEdit, onDelete, onOpenThread, activeCall, highlightId, readOnly = false, canReact = true, onCopyLink, onDiscardFailed, showDayDividers = true }: {
  messages: FeedMessage[];
  meId: string | null;
  /** userId -> display name, for reaction tooltips and mention highlighting. */
  memberNames: Map<string, string>;
  onRetry: (m: FeedMessage) => void;
  onJoinCall: () => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, newBody: string) => void;
  onDelete: (m: FeedMessage) => void;
  /** Absent inside a thread panel: threads do not nest. */
  onOpenThread?: (m: FeedMessage) => void;
  /** The conversation's live call, if one is running, drives the
   *  LIVE card variant on the latest un-ended call card. */
  activeCall?: { participants: { identity: string; name: string }[]; startedAt: string } | null;
  /** ?m=<id>: scroll this message into view and paint it for 1.6s. */
  highlightId?: string | null;
  /** Archived or Can view: no action bar, no reactions, no edit. */
  readOnly?: boolean;
  /** Can comment and above. False strips reactions and thread replies. */
  canReact?: boolean;
  /** Copy a link to one message (the "…" menu). */
  onCopyLink?: (m: FeedMessage) => void;
  /** Throw away a message that will not send, rather than retrying forever. */
  onDiscardFailed?: (m: FeedMessage) => void;
  /** Off for the thread panel's parent: one message does not need a date
   *  above it, and with it on the panel printed "Today" twice. */
  showDayDividers?: boolean;
}) {
  const { date: fmtDate, relative: fmtRelative, prefs } = useFormat();
  const liveCardId = useMemo(() => {
    if (!activeCall) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const meta = messages[i].metadata;
      if (meta?.kind === "call") return meta.endedAt ? null : messages[i].id;
    }
    return null;
  }, [messages, activeCall]);

  const items = useMemo(() => {
    const out: Array<{ kind: "day"; key: string; label: string } | { kind: "msg"; key: string; msg: FeedMessage; head: boolean }> = [];
    let prevDay = "";
    let prevAuthor = "";
    let prevTime = 0;
    for (const m of messages) {
      const d = new Date(m.createdAt);
      // The divider buckets by the VIEWER'S day, from the same preference the
      // row times read. `d.toDateString()` was the BROWSER'S day, so a person
      // in New York reading with home.locale.timezone set to Asia/Kolkata got
      // one "Today" over two Indian calendar days, with the times below it
      // running 15:30 then 00:30 under the same heading.
      const day = dayKey(d, prefs);
      if (day !== prevDay) {
        if (showDayDividers) out.push({ kind: "day", key: `day-${day}`, label: dayLabel(d, prefs, fmtDate) });
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
  }, [messages, fmtDate, prefs, showDayDividers]);

  return (
    <div className="flex flex-col">
      {items.map((it) => it.kind === "day" ? (
        <div key={it.key} className="relative flex items-center justify-center py-3">
          <span className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
          <span className="relative rounded-full border border-line bg-raised px-3 py-0.5 text-xs font-medium text-ink-2">
            {it.label}
          </span>
        </div>
      ) : (
        <MessageRow
          key={it.key}
          msg={it.msg}
          head={it.head}
          live={it.msg.id === liveCardId ? activeCall ?? null : null}
          mine={it.msg.authorId === meId}
          meId={meId}
          memberNames={memberNames}
          onRetry={onRetry}
          onJoinCall={onJoinCall}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenThread={onOpenThread}
          highlighted={highlightId === it.msg.id}
          readOnly={readOnly}
          canReact={canReact}
          onCopyLink={onCopyLink}
          onDiscardFailed={onDiscardFailed}
          fmtDate={fmtDate}
          fmtRelative={fmtRelative}
        />
      ))}
    </div>
  );
}

function MessageRow({ msg, head, live, mine, meId, memberNames, onRetry, onJoinCall, onReact, onEdit, onDelete, onOpenThread, highlighted, readOnly, canReact, onCopyLink, onDiscardFailed, fmtDate, fmtRelative }: {
  msg: FeedMessage;
  head: boolean;
  live: { participants: { identity: string; name: string }[]; startedAt: string } | null;
  mine: boolean;
  meId: string | null;
  memberNames: Map<string, string>;
  onRetry: (m: FeedMessage) => void;
  onJoinCall: () => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, newBody: string) => void;
  onDelete: (m: FeedMessage) => void;
  onOpenThread?: (m: FeedMessage) => void;
  highlighted: boolean;
  readOnly: boolean;
  canReact: boolean;
  onCopyLink?: (m: FeedMessage) => void;
  onDiscardFailed?: (m: FeedMessage) => void;
  fmtDate: (v: Date | string | number | null | undefined, style?: "smart" | "date" | "datetime" | "time" | "weekday") => string;
  fmtRelative: (v: Date | string | number | null | undefined) => string;
}) {
  const [reactOpen, setReactOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);
  const rowRef = useRef<HTMLDivElement>(null);

  // ?m=<id> lands here: bring the message into view once, then let the paint
  // fade on its own. Scrolling in an effect (rather than at render) is what
  // makes a deep link work on a feed that is still measuring itself.
  useEffect(() => {
    if (!highlighted) return;
    const el = rowRef.current;
    if (!el) return;
    const t = setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [highlighted]);

  // Every clock time in this unit reads the viewer's zone and 12/24h choice
  // (spec-talk section 1 Dates and times). It used to be hard-coded "en-US",
  // which printed an Indian team's afternoon as somebody else's morning.
  const time = fmtDate(msg.createdAt, "time");
  // DEFENSIVE, and it earned it: a thread opened from a URL used to hand this
  // component a stub message with only an id, and reading `.author.firstName`
  // off it took the whole page down with a white screen. The stub is gone
  // (ConversationView now loads the parent before rendering it), and a row
  // that somehow arrives without an author renders as "Someone" rather than
  // as nothing at all. One missing name is a blemish; a crashed feed loses
  // somebody their conversation.
  const author = msg.author ?? { id: msg.authorId, firstName: "Someone", lastName: "", avatar: null };
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
    <div
      ref={rowRef}
      data-message-id={msg.id}
      className={`group os-touch-row relative flex gap-2.5 rounded-md px-1 transition-colors duration-500 hover:bg-subtle/60 ${head ? "mt-2.5" : "mt-0.5"} ${highlighted ? "bg-selected" : ""}`}
    >
      <div className="w-8 shrink-0 pt-0.5">
        {head ? (
          <TeamAvatar name={`${author.firstName} ${author.lastName}`.trim()} avatar={author.avatar} size={30} />
        ) : (
          <span className="hidden group-hover:block text-xs text-ink-3 tabular-nums pt-1.5 text-right pr-0.5">{time}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {head && (
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-ink-strong">
              {mine ? "You" : `${author.firstName} ${author.lastName}`.trim()}
            </span>
            <span className="text-xs text-ink-3 tabular-nums">{time}</span>
          </div>
        )}

        {isCall ? (
          live ? (
            <div className="mt-1 rounded-lg border border-[var(--signal-success-border)] bg-[var(--signal-success-bg)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-ink-strong">
                  {live.participants.map((p) => p.name).slice(0, 3).join(", ")}
                  {live.participants.length > 3 ? ` +${live.participants.length - 3}` : ""} {live.participants.length === 1 ? "is" : "are"} in the call
                </span>
                <span className="inline-flex items-center rounded-full bg-success-solid px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-white">Live</span>
              </div>
              <button type="button" onClick={onJoinCall} className="mt-2 inline-flex h-8 items-center gap-2 rounded-lg border border-success-text/30 bg-raised px-3 text-sm font-medium text-success-text hover:bg-success-bg">
                <Video className="h-4 w-4" /> Join call
              </button>
            </div>
          ) : msg.metadata?.endedAt ? (
            <div className="mt-1 flex items-start gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-ink-2"><Phone className="w-4 h-4" /></span>
              <span>
                <span className="block text-base font-semibold text-ink-strong">A call happened</span>
                <span className="block text-sm text-ink-2">
                  {formatCallRoll(msg.metadata?.names, meId ? memberNames.get(meId) : undefined)} in the call for {msg.metadata.durationMin ?? 0}m.
                </span>
              </span>
            </div>
          ) : (
            // SECONDARY, not blue. spec-talk 2.2 gives the call card "one
            // secondary Join 28px" and reserves the page's one blue for the
            // Send button; on Talk home this card sat beside the toolbar's
            // blue New message, which is two primaries on one plane.
            <div className="mt-1 inline-flex items-center gap-3 rounded-lg border border-line bg-subtle px-3 py-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--os-brand-soft)] text-[var(--os-brand)]"><Video className="w-4 h-4" /></span>
              <span className="text-base text-ink">{msg.body}</span>
              <button type="button" onClick={onJoinCall} className="h-7 rounded-md border border-line-strong px-3 text-sm font-medium text-ink hover:bg-hover">
                Join
              </button>
            </div>
          )
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
              className="w-full resize-none rounded-md border border-line-strong px-2 py-1.5 text-base leading-6 outline-none focus:border-[var(--os-brand)]"
              autoFocus
            />
            <div className="mt-1 flex items-center gap-2 text-xs">
              <button type="button" onClick={saveEdit} className="inline-flex items-center gap-1 text-[var(--os-brand)] font-medium"><Check className="w-3.5 h-3.5" /> Save</button>
              <button type="button" onClick={() => { setEditing(false); setDraft(msg.body); }} className="inline-flex items-center gap-1 text-ink-2"><X className="w-3.5 h-3.5" /> Cancel</button>
              <span className="text-ink-3">Enter saves · Esc cancels</span>
            </div>
          </div>
        ) : (
          <>
            {(msg.body || deleted) && (
              deleted ? (
                <p className="text-base leading-6 italic text-ink-3">Message removed</p>
              ) : (
                <div className={`text-ink ${msg.pending ? "opacity-60" : ""}`}>
                  <RichBody body={msg.body} memberNames={memberNames} />
                  {msg.editedAt && <span className="ml-1 text-xs text-ink-3">(edited)</span>}
                </div>
              )
            )}
            {!deleted && attachments.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {attachments.map((a, i) => a.type.startsWith("image/") ? (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.name} className="max-h-56 max-w-[320px] rounded-lg border border-line object-cover" />
                  </a>
                ) : (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" download={a.name}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-ink hover:bg-hover">
                    <Paperclip className="w-3.5 h-3.5 text-ink-3" />
                    <span className="max-w-[220px] truncate">{a.name}</span>
                    {a.size > 0 && <span className="text-xs text-ink-3">{prettySize(a.size)}</span>}
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
                onClick={() => { if (canReact && !readOnly) onReact(msg, emoji); }}
                disabled={!canReact || readOnly}
                title={users.map((u) => (u === meId ? "You" : memberNames.get(u) ?? "Someone")).join(", ")}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs tabular-nums ${
                  meId && users.includes(meId)
                    ? "border-[var(--os-brand)]/40 bg-[var(--os-brand-soft)] text-[var(--os-brand)]"
                    : "border-line bg-raised text-ink-2 hover:border-line-strong"
                }`}
              >
                <span>{emoji}</span> {users.length}
              </button>
            ))}
          </div>
        )}

        {/* Thread chip: "3 replies · Last reply 2h ago" with the repliers'
            faces beside it (spec-talk 2.2). The count alone said a thread
            existed and nothing about whether it was still moving. */}
        {onOpenThread && !msg.parentId && (msg.replyCount ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => onOpenThread(msg)}
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--os-brand-deep)] hover:underline"
          >
            {(msg.replyAuthorIds ?? []).length > 0 ? (
              <span className="flex -space-x-1">
                {(msg.replyAuthorIds ?? []).slice(0, 2).map((uid) => (
                  <TeamAvatar key={uid} name={memberNames.get(uid) ?? "Someone"} avatar={null} size={16} />
                ))}
              </span>
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
            {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
            {msg.lastReplyAt ? (
              <span className="font-normal text-ink-3">· Last reply {fmtRelative(msg.lastReplyAt)}</span>
            ) : null}
          </button>
        )}

        {msg.pending && !msg.failed && (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-ink-3">
            <Dots variant="pending" label="Sending" /> Sending
          </span>
        )}
        {msg.failed && (
          // The message STAYS on screen and stays retryable. A send that
          // fails is never dropped and never silently swallowed: this row is
          // the visible failure state the save-path rule asks for.
          <span className="mt-0.5 inline-flex items-center gap-2 text-xs font-medium text-danger-text">
            Not sent
            <button type="button" onClick={() => onRetry(msg)} className="underline underline-offset-2 hover:no-underline">Retry</button>
            {onDiscardFailed ? (
              <button type="button" onClick={() => onDiscardFailed(msg)} className="text-ink-3 underline underline-offset-2 hover:no-underline">Delete</button>
            ) : null}
          </span>
        )}
      </div>

      {/* The message action bar (spec-talk 2.2): three quick reactions,
          React, Reply in thread, then a "…" holding Copy link, Copy text,
          Edit and Delete.
          NOT hover-only (section 1 Mobile / narrow, critic #10): on a coarse
          pointer, or under 1024, `.os-touch-visible` renders it at rest.
          WHAT THE "…" FIXED. Flattened into eight icon buttons in a row the
          bar measured 198px, and the rest-state reserve in os.css was 148, so
          on every phone and every touch laptop the bar printed itself across
          the words of every message. At rest on those pointers only the 28px
          "…" shows (`.os-touch-collapse` folds the rest away), which is both
          what the spec asks for and a bar the row can actually make space
          for. Nothing moves out of reach: the menu carries every action, and
          the quick reactions come back inside it at 44px cells. */}
      {canAct && !editing && !readOnly && (
        <div className="os-touch-visible absolute -top-3 end-2 hidden items-center rounded-md border border-line bg-raised shadow-[var(--os-shadow-pop)] group-hover:flex group-focus-within:flex">
          <span className="os-touch-collapse contents">
            {canReact ? QUICK_THREE.map((e) => (
              <button key={e} type="button" onClick={() => onReact(msg, e)} title={`React ${e}`} aria-label={`React ${e}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-hover">
                {e}
              </button>
            )) : null}
            {canReact ? (
              <span className="relative inline-flex">
                <button type="button" onClick={() => setReactOpen((v) => !v)} title="React" aria-label="React" aria-expanded={reactOpen} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                  <Smile className="h-4 w-4" />
                </button>
                <EmojiPicker
                  open={reactOpen}
                  onClose={() => setReactOpen(false)}
                  onPick={(e) => { setReactOpen(false); onReact(msg, e); }}
                  side="bottom"
                  align="end"
                  label="React with an emoji"
                />
              </span>
            ) : null}
            {onOpenThread && canReact && !msg.parentId && !isCall && (
              <button type="button" onClick={() => onOpenThread(msg)} title="Reply in thread" aria-label="Reply in thread" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
          </span>

          <span className="relative inline-flex">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              title="More message actions"
              aria-label="More message actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen ? (
              <>
                <span className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <span role="menu" className="absolute end-0 top-8 z-40 flex w-52 flex-col rounded-lg border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]">
                  {/* At rest on a touch pointer the quick reactions are folded
                      away above, so they reappear here as 44px cells. */}
                  {canReact ? (
                    <span className="os-touch-only flex items-center gap-1 px-2 pb-1">
                      {QUICK_THREE.map((e) => (
                        <button key={e} type="button" role="menuitem" onClick={() => { setMoreOpen(false); onReact(msg, e); }} aria-label={`React ${e}`} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-base hover:bg-hover">
                          {e}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  {onOpenThread && canReact && !msg.parentId && !isCall ? (
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenThread(msg); }} className="os-touch-only flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-ink hover:bg-subtle">
                      <MessageSquare className="h-4 w-4 text-ink-3" /> Reply in thread
                    </button>
                  ) : null}
                  {onCopyLink && !isCall ? (
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopyLink(msg); }} className="flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-ink hover:bg-subtle">
                      <Link2 className="h-4 w-4 text-ink-3" /> Copy link
                    </button>
                  ) : null}
                  {!isCall && !deleted ? (
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void copyText(msg.body); }} className="flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-ink hover:bg-subtle">
                      <ClipboardCopy className="h-4 w-4 text-ink-3" /> Copy text
                    </button>
                  ) : null}
                  {mine && !isCall ? (
                    <>
                      <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setDraft(msg.body); setEditing(true); }} className="flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-ink hover:bg-subtle">
                        <Pencil className="h-4 w-4 text-ink-3" /> Edit
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onDelete(msg); }} className="flex h-8 w-full items-center gap-2 px-3 text-start text-sm text-danger-text hover:bg-danger-bg">
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </>
                  ) : null}
                </span>
              </>
            ) : null}
          </span>
        </div>
      )}
    </div>
  );
}

/** "You and Pranjal were" / "Sam was", the ended-card participant roll. */
function formatCallRoll(names: string[] | undefined, myName: string | undefined): string {
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return "People were";
  const display = list.map((n) => (myName && n === myName ? "You" : n));
  // "You" leads, like Slack.
  display.sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : 0));
  const head = display.slice(0, 3);
  const extra = display.length - head.length;
  const joined = head.length === 1 ? head[0] : `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]}`;
  const subject = extra > 0 ? `${joined} +${extra}` : joined;
  return `${subject} ${display.length === 1 && display[0] !== "You" ? "was" : "were"}`;
}

/** Day dividers bucket by the VIEWER'S local day, not UTC, not the server's
 *  zone and not the browser's (spec-talk section 1 Dates and times). Today
 *  and Yesterday are decided on the same dayKey the grouping uses, so the
 *  label and the bucket can never disagree. */
function dayLabel(
  d: Date,
  prefs: DateFormatPrefs,
  fmtDate: (v: Date, style?: "smart" | "date" | "datetime" | "time" | "weekday") => string,
): string {
  const now = new Date();
  if (dayKey(d, prefs) === dayKey(now, prefs)) return "Today";
  if (dayKey(d, prefs) === dayKey(new Date(now.getTime() - 86_400_000), prefs)) return "Yesterday";
  return fmtDate(d, "date");
}

/** Copy a message's own words (the "…" menu's Copy text). Silent on a
 *  browser that refuses the clipboard: the menu closing is the whole
 *  interaction, and a toast for a copy nobody asked twice for is noise. */
async function copyText(body: string): Promise<void> {
  try { await navigator.clipboard.writeText(body); } catch { /* clipboard denied */ }
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

