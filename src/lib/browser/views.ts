// What the browser routes answer (docs/plans/ai-teammates-phase4.md step 2):
// a session as its person sees it, its steps as kinds and hosts only (never a
// page's address path, an element's words or typed text, Decision 23), and
// the workspace's policy as Owners and Admins see it, usage as numbers only
// (Decision 30).
//
// Pure: types and words, safe on the client.

import { BROWSER_PANEL_COPY } from "@/lib/agents/teammate-copy";
import type { EndReason, SessionStatus, StepKind, StepOutcome } from "./types";

/** Why the computer cannot be used here, each its own reason (Decision 33; sessions.ts computerAccess). */
export type ComputerRefusal = "not_configured" | "workspace_closed" | "trial" | "plan" | "workspace_off" | "no_sites";

export interface BrowserUsage {
  minutesUsed: number;
  minutesCap: number;
  atOnce: number;
  atOnceCap: number;
  sessionsToday: number;
  sessionsTodayCap: number;
  /** About this month's cost, from the rate the founder set (Decision 34), or null. */
  costCents: number | null;
}

export interface BrowserStepView {
  seq: number;
  kind: StepKind;
  site: string | null;
  outcome: StepOutcome;
  code: string | null;
  at: string;
  shotId: string | null;
  line: string;
}

export interface BrowserSessionView {
  id: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  site: string | null;
  startedAt: string;
  endsBy: string;
  endedAt: string | null;
  endReason: EndReason | null;
  endedLine: string | null;
  minutes: number;
  waiting: { actionId: string; kind: "act" | "take_over" } | null;
  steps: BrowserStepView[];
  shots: Array<{ id: string; kind: "page" | "element"; at: string; expiresAt: string }>;
}

export interface BrowserPolicyView {
  /** The computer can be turned on here: this WorkwrK offers it, the plan has it, the workspace is live and not on a trial. */
  available: boolean;
  /** Why not, when not (never workspace_off, which is the switch itself). */
  reason: ComputerRefusal | null;
  plan: string;
  region: string | null;
  enabled: boolean;
  allowSites: string[];
  blockSites: string[];
  usage: BrowserUsage | null;
  updatedAt: string | null;
}

const STEP_WORDS = BROWSER_PANEL_COPY.STEP_WORDS;

/** What a step did, by its kind and host alone. */
export function stepLine(s: { kind: StepKind; site: string | null; outcome: StepOutcome }): string {
  const site = s.site && s.site.trim() ? s.site : STEP_WORDS.unknownSite;
  switch (s.kind) {
    case "open":
    case "read":
    case "find":
    case "scroll":
    case "show":
    case "click":
    case "type":
    case "select":
    case "take_over":
      return STEP_WORDS[s.kind](site);
    case "give_back":
      return STEP_WORDS.give_back;
    case "close":
      return STEP_WORDS.close;
    default:
      return STEP_WORDS.end;
  }
}

/** Why a session closed, as its card and the chat line say it. */
export function endedLine(reason: EndReason | null): string {
  if (!reason) return BROWSER_PANEL_COPY.closed;
  const words = (BROWSER_PANEL_COPY.ENDED_WORDS as Readonly<Record<string, string>>)[reason];
  return words ?? BROWSER_PANEL_COPY.closed;
}

/** A session row's minutes: what it was billed once ended, else the minutes it has run, at least one once started. */
export function sessionMinutes(row: { status: string; startedAt: Date; endedAt: Date | null; billedMinutes: number | null; reservedMinutes: number }, now: Date): number {
  if (row.status === "ended") return Math.max(0, row.billedMinutes ?? row.reservedMinutes);
  const ran = Math.ceil((now.getTime() - row.startedAt.getTime()) / 60_000);
  return Math.max(0, Math.min(row.reservedMinutes, ran));
}
