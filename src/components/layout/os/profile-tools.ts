// PROFILE_TOOLS — the "Personal Tools" catalog shown in the profile
// dropdown. Each entry can be pinned to the top bar's quick-access
// strip via toggleProfileToolPin in shell-context.
//
// Keep this list short and curated. New per-user shortcuts (e.g.
// Create dashboard) should land here so they get the same pin/unpin
// affordance as the existing ones.

import {
  CheckSquare, Briefcase, Clock, NotepadText, Video,
  AlarmClock, FileText, PencilRuler, Users, BarChart3, Sparkles, Mic,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Inline action a quick-tool fires (handled in ClickTopbar), vs a hard nav. */
export type ToolAction = "create-task" | "my-work" | "notepad" | "reminder" | "doc" | "voice";

export type ProfileTool = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Hard navigation target. Null = action-only (handled inline). */
  href: string | null;
  /** Inline action; takes precedence over href when set. */
  action?: ToolAction;
  /** Optional tooltip override for the top-bar quick icon. */
  tooltip?: string;
};

export const PROFILE_TOOLS: ProfileTool[] = [
  { key: "create-task",       label: "Quick task",        Icon: CheckSquare,  href: null, action: "create-task", tooltip: "Quick task  ⌘T" },
  { key: "my-work",           label: "My Work",           Icon: Briefcase,    href: null, action: "my-work" },
  { key: "notepad",           label: "Notepad",           Icon: NotepadText,  href: null, action: "notepad" },
  { key: "create-reminder",   label: "Reminder",          Icon: AlarmClock,   href: null, action: "reminder" },
  { key: "create-doc",        label: "Quick doc",         Icon: FileText,     href: null, action: "doc" },
  { key: "voice",             label: "Voice to text",     Icon: Mic,          href: null, action: "voice" },
  { key: "track-time",        label: "Track Time",        Icon: Clock,        href: "/timesheets" },
  { key: "record-clip",       label: "Record a Clip",     Icon: Video,        href: "/notetaker" },
  { key: "create-whiteboard", label: "Create Whiteboard", Icon: PencilRuler,  href: "/build?new=whiteboard" },
  { key: "view-people",       label: "View People",       Icon: Users,        href: "/people" },
  { key: "create-dashboard",  label: "Create Dashboard",  Icon: BarChart3,    href: "/boards?new=dashboard" },
  { key: "ai-notetaker",      label: "AI Notetaker",      Icon: Sparkles,     href: "/notetaker" },
];

export const PROFILE_TOOL_MAP: Record<string, ProfileTool> = PROFILE_TOOLS.reduce(
  (acc, t) => { acc[t.key] = t; return acc; },
  {} as Record<string, ProfileTool>,
);

export function getProfileTool(key: string): ProfileTool | undefined {
  return PROFILE_TOOL_MAP[key];
}
