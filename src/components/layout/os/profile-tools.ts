// PROFILE_TOOLS — the "Personal Tools" catalog shown in the profile
// dropdown. Each entry can be pinned to the top bar's quick-access
// strip via toggleProfileToolPin in shell-context.
//
// Keep this list short and curated. New per-user shortcuts (e.g.
// Create dashboard) should land here so they get the same pin/unpin
// affordance as the existing ones.

import {
  CheckSquare, Briefcase, Clock, NotepadText, Video,
  AlarmClock, FileText, PencilRuler, Users, BarChart3, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ProfileTool = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Hard navigation target. Null = action-only (handled inline). */
  href: string | null;
  /** Optional tooltip override for the top-bar quick icon. */
  tooltip?: string;
};

export const PROFILE_TOOLS: ProfileTool[] = [
  { key: "create-task",       label: "Create task",       Icon: CheckSquare,  href: "/tasks?new=1" },
  { key: "my-work",           label: "My Work",           Icon: Briefcase,    href: "/today" },
  { key: "track-time",        label: "Track Time",        Icon: Clock,        href: "/timesheets" },
  { key: "notepad",           label: "Notepad",           Icon: NotepadText,  href: "/docs?type=notepad" },
  { key: "record-clip",       label: "Record a Clip",     Icon: Video,        href: "/notetaker" },
  { key: "create-reminder",   label: "Create Reminder",   Icon: AlarmClock,   href: "/today?reminder=1" },
  { key: "create-doc",        label: "Create Doc",        Icon: FileText,     href: "/docs?new=1" },
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
