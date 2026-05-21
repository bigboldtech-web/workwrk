"use client";

// BoardHeaderActions — monday-style board chrome on the right side
// of any module page header. Inline pills for the high-frequency
// actions (Invite, Link copy), and a `…` menu that hosts everything
// secondary: Activity log, Permissions, Settings, Archive, Delete.
//
// Pages opt-in by dropping this into their header row:
//
//   <BoardHeaderActions
//     activityHref="/crm/activity"
//     onArchive={...}
//     onDelete={...}
//   />
//
// All actions are optional — omit a prop and the menu item hides.
// This lets each module wire only the bits it implements without
// dead menu items.

import {
  Link as LinkIcon,
  UserPlus,
  Activity,
  Bell,
  Lock,
  Settings,
  Archive,
  Trash2,
  ChevronRight,
  MoreHorizontal,
  Share2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface Props {
  /** Optional invite count badge label, e.g. "1" or "5". */
  inviteCount?: number | string;
  onInvite?: () => void;
  /** Copies a deep link to clipboard. Caller controls the URL. */
  onCopyLink?: () => void;
  /** Routes / handlers for the … menu. Omit any to hide the item. */
  onActivityLog?: () => void;
  onDiscussion?: () => void;
  onNotificationsSettings?: () => void;
  onPermissions?: () => void;
  onSettings?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /** Optional custom items injected above the destructive group. */
  extraMenuItems?: React.ReactNode;
}

export function BoardHeaderActions(props: Props) {
  const {
    inviteCount, onInvite, onCopyLink,
    onActivityLog, onDiscussion, onNotificationsSettings,
    onPermissions, onSettings, onArchive, onDelete, extraMenuItems,
  } = props;

  return (
    <div className="flex items-center gap-1">
      {onInvite && (
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium border border-border text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          title="Invite people"
        >
          <UserPlus size={13} />
          <span>Invite</span>
          {inviteCount != null && (
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-surface-2 text-[10px] tabular-nums">{inviteCount}</span>
          )}
        </button>
      )}
      {onCopyLink && (
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          aria-label="Copy link"
          title="Copy link"
        >
          <LinkIcon size={14} />
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            aria-label="More options"
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Board options</DropdownMenuLabel>
          {(onActivityLog || onDiscussion) && <DropdownMenuSeparator />}
          {onActivityLog && (
            <DropdownMenuItem onSelect={onActivityLog}>
              <Activity size={14} className="mr-2" /> Activity log
            </DropdownMenuItem>
          )}
          {onDiscussion && (
            <DropdownMenuItem onSelect={onDiscussion}>
              <Share2 size={14} className="mr-2" /> Discussion
            </DropdownMenuItem>
          )}
          {(onNotificationsSettings || onPermissions || onSettings) && <DropdownMenuSeparator />}
          {onNotificationsSettings && (
            <DropdownMenuItem onSelect={onNotificationsSettings}>
              <Bell size={14} className="mr-2" /> Notifications
            </DropdownMenuItem>
          )}
          {onPermissions && (
            <DropdownMenuItem onSelect={onPermissions}>
              <Lock size={14} className="mr-2" /> Permissions
            </DropdownMenuItem>
          )}
          {onSettings && (
            <DropdownMenuItem onSelect={onSettings}>
              <Settings size={14} className="mr-2" /> Settings
              <ChevronRight size={12} className="ml-auto opacity-50" />
            </DropdownMenuItem>
          )}
          {extraMenuItems}
          {(onArchive || onDelete) && <DropdownMenuSeparator />}
          {onArchive && (
            <DropdownMenuItem onSelect={onArchive}>
              <Archive size={14} className="mr-2" /> Archive
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem onSelect={onDelete} className="text-rose-600 dark:text-rose-400">
              <Trash2 size={14} className="mr-2" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
