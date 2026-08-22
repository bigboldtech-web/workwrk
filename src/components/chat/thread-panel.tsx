"use client";

// Thread panel — Slack-style side sheet inside the conversation pane.
// Presentational: the parent page owns all state (replies arrive through
// its single poll) and passes handlers down. Absolute-positioned inside
// the pane's relative wrapper — no portals, no fixed positioning.

import { X } from "lucide-react";
import { MessageFeed, type FeedMessage } from "@/components/chat/message-feed";
import { ChatComposer, type ComposerPayload } from "@/components/chat/chat-composer";
import type { ChatUserLite } from "@/components/chat/conversation-utils";

export function ThreadPanel({ parent, replies, meId, members, memberNames, onClose, onSend, onReact, onEdit, onDelete, onRetry, onError }: {
  parent: FeedMessage;
  replies: FeedMessage[];
  meId: string | null;
  members: { userId: string; user: ChatUserLite }[];
  memberNames: Map<string, string>;
  onClose: () => void;
  onSend: (payload: ComposerPayload) => void;
  onReact: (m: FeedMessage, emoji: string) => void;
  onEdit: (m: FeedMessage, newBody: string) => void;
  onDelete: (m: FeedMessage) => void;
  onRetry: (m: FeedMessage) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-zinc-200 bg-white shadow-xl">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-zinc-100 shrink-0">
        <h2 className="flex-1 text-[14px] font-semibold text-zinc-900">Thread</h2>
        <button type="button" onClick={onClose} aria-label="Close thread" className="inline-flex items-center justify-center h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <MessageFeed
          messages={[parent]}
          meId={meId}
          memberNames={memberNames}
          onRetry={onRetry}
          onJoinCall={() => {}}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
        />
        <div className="my-2 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-100" />
          <span className="text-[11px] text-zinc-400">
            {replies.filter((r) => !r.deletedAt).length} {replies.filter((r) => !r.deletedAt).length === 1 ? "reply" : "replies"}
          </span>
          <span className="h-px flex-1 bg-zinc-100" />
        </div>
        <MessageFeed
          messages={replies}
          meId={meId}
          memberNames={memberNames}
          onRetry={onRetry}
          onJoinCall={() => {}}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
      <div className="px-3 pb-3 pt-1 shrink-0">
        <ChatComposer
          members={members}
          meId={meId}
          placeholder="Reply in thread"
          autoFocus
          onSend={onSend}
          onError={onError}
        />
      </div>
    </div>
  );
}
