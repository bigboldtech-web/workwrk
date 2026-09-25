// PERSONAL_TOOLS: the one-click tools a person can pin to the top bar.
//
// The bar used to carry a strip of these (Quick task, My Work, Notepad,
// Reminder, Quick doc, Voice to text, Track Time, Create Canvas, View People,
// AI Notetaker), each pinned or unpinned from Avatar > Personal tools. Phase 1
// removed the strip and left the tools two clicks deep in the "+" menu or
// inside their hubs. The strip is back, on the navy chrome as 32px
// ChromeIconButtons, and the pins live in `sidebar.quickTools`, the
// preference key the schema has carried for them all along.
//
// Client-safe: no React, just the catalogue. The bar and the avatar menu both
// read it, so a new tool lands in both places at once.

import {
  AlarmClock, BriefcaseBusiness, CheckSquare, Clock, FileText, Frame, Mic, NotebookPen, Sparkles, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** An in-shell action the bar runs itself, as opposed to a navigation. */
export type PersonalToolAction = "create-task" | "my-work" | "notepad" | "reminder" | "doc" | "voice" | "canvas";

export interface PersonalTool {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Navigation target; null when the tool is an in-shell action. */
  href: string | null;
  action?: PersonalToolAction;
  /** The registry shortcut id whose chord the tooltip prints, if any. */
  shortcutId?: string;
  /** Voice needs the Web Speech API; the row and the pin are absent without it. */
  needsSpeech?: boolean;
}

export const PERSONAL_TOOLS: readonly PersonalTool[] = [
  { key: "create-task", label: "Quick task", Icon: CheckSquare, href: null, action: "create-task", shortcutId: "create-task" },
  { key: "my-work", label: "My Work", Icon: BriefcaseBusiness, href: null, action: "my-work" },
  { key: "notepad", label: "Notepad", Icon: NotebookPen, href: null, action: "notepad" },
  { key: "create-reminder", label: "Reminder", Icon: AlarmClock, href: null, action: "reminder" },
  { key: "create-doc", label: "Quick doc", Icon: FileText, href: null, action: "doc" },
  { key: "voice", label: "Voice to text", Icon: Mic, href: null, action: "voice", needsSpeech: true },
  { key: "track-time", label: "Track time", Icon: Clock, href: "/timesheets" },
  // An action, not the /canvas?new=1 link it was: the bar makes the canvas
  // and opens it in the section the person is in, so a canvas made from the
  // bar while in Work opens in Work (use-personal-tools.ts).
  { key: "create-whiteboard", label: "Create canvas", Icon: Frame, href: null, action: "canvas" },
  { key: "view-people", label: "View people", Icon: Users, href: "/people" },
  { key: "ai-notetaker", label: "AI Notetaker", Icon: Sparkles, href: "/notetaker" },
];

/** What a person who never opened Personal tools sees pinned. */
export const DEFAULT_TOOL_PINS: readonly string[] = ["create-task", "notepad", "create-reminder"];

/**
 * Keys the old profile-tools strip stored under other names. A person whose
 * preference still says "reminder" keeps their pin instead of silently
 * losing it (the strip rendered two pins for a stored three).
 */
const LEGACY_TOOL_KEYS: Record<string, string> = {
  reminder: "create-reminder",
  doc: "create-doc",
  whiteboard: "create-whiteboard",
  canvas: "create-whiteboard",
  people: "view-people",
  "quick-task": "create-task",
  notetaker: "ai-notetaker",
};

/** The stored pin list, or the default when nothing was ever stored. */
export function readToolPins(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [...DEFAULT_TOOL_PINS];
  const known = new Set(PERSONAL_TOOLS.map((t) => t.key));
  const out: string[] = [];
  for (const raw of stored) {
    if (typeof raw !== "string") continue;
    const k = LEGACY_TOOL_KEYS[raw] ?? raw;
    if (known.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function togglePin(pins: readonly string[], key: string): string[] {
  return pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
}
