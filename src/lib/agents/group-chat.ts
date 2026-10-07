// Group chats: one person with two to five of their AI teammates
// (docs/plans/ai-teammates-phase2.md, Decisions 13 to 15). This is the pure
// half: the limits, who answers a message, and the checks on who may be in a
// group. The routes and the reads are group-server.ts.
//
// WHO ANSWERS. A message that names teammates ("@Triage then @Project
// Manager") goes to them, in the order they are named, at most three. One
// that names nobody goes to the lead: the first member made from the Chief
// of Staff template, else the first by position, skipping any that cannot
// answer now (paused, removed, or one the person can no longer use), so a
// paused lead never silently takes every message.
//
// NAMING. "@<name>" counts without case, only where the "@" starts a word
// (so an email address names nobody) and only when no letter, digit or "_"
// follows the name. Longer names are tried first, so "@PM Lead" never also
// counts as "@PM". Two members may not share a name, so a name is never
// ambiguous.

import { clampText } from "./clamp";
import { GROUP_COPY } from "./teammate-copy";

export const GROUP_LIMITS = { minMembers: 2, maxMembers: 5, maxAnswerers: 3, perPerson: 20, nameMax: 60 } as const;

/** The Chief of Staff template's key (templates.ts): the group's lead when it is in one. */
const LEAD_TEMPLATE = "chief-of-staff";

export interface GroupMember {
  agentId: string;
  slug: string;
  name: string;
  template: string | null;
  position: number;
  status: "ENABLED" | "DISABLED" | "ARCHIVED";
  /** canUseAgent(agent, viewer) now */
  usable: boolean;
}

export type SkipReason = "paused" | "removed" | "no_access";

/** Why a member cannot answer now, or null when it can. */
export function skipReasonOf(m: GroupMember): SkipReason | null {
  if (m.status === "ARCHIVED") return "removed";
  if (!m.usable) return "no_access";
  if (m.status === "DISABLED") return "paused";
  return null;
}

function byPosition(members: readonly GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => a.position - b.position);
}

/** Who answers a message that names nobody, or null when no member can answer. */
export function leadOf(members: readonly GroupMember[]): GroupMember | null {
  const answerable = byPosition(members).filter((m) => skipReasonOf(m) === null);
  return answerable.find((m) => m.template === LEAD_TEMPLATE) ?? answerable[0] ?? null;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** The members a message names, in order of first appearance, each once, at most maxAnswerers. */
export function namedIn(text: string, members: readonly GroupMember[]): GroupMember[] {
  // Longest name first; for one name, a member that can answer before one
  // that cannot (a removed teammate keeps its row), then by position.
  const candidates = members
    .map((m) => ({ m, key: m.name.trim().toLowerCase() }))
    .filter((c) => c.key.length > 0)
    .sort(
      (a, b) =>
        b.key.length - a.key.length ||
        Number(skipReasonOf(a.m) !== null) - Number(skipReasonOf(b.m) !== null) ||
        a.m.position - b.m.position,
    );
  const lower = text.toLowerCase();
  const out: GroupMember[] = [];
  let i = 0;
  while (out.length < GROUP_LIMITS.maxAnswerers) {
    const at = lower.indexOf("@", i);
    if (at < 0) break;
    i = at + 1;
    // Read `lower` only: lowering can change a string's length, so its
    // indexes are not the original's.
    if (at > 0 && WORD_CHAR.test(lower.charAt(at - 1))) continue;
    const hit = candidates.find((c) => lower.startsWith(c.key, at + 1) && !WORD_CHAR.test(lower.charAt(at + 1 + c.key.length)));
    if (!hit) continue;
    i = at + 1 + hit.key.length;
    if (!out.some((m) => m.agentId === hit.m.agentId)) out.push(hit.m);
  }
  return out;
}

/**
 * Who answers a message: the members it names, each with why it cannot
 * answer (if so), or the lead when it names nobody. `answerers` is empty when
 * nobody named can be found and no member can answer.
 */
export function pickAnswerers(
  text: string,
  members: readonly GroupMember[],
): { named: boolean; answerers: Array<{ member: GroupMember; skip: SkipReason | null }> } {
  const named = namedIn(text, members);
  if (named.length > 0) return { named: true, answerers: named.map((member) => ({ member, skip: skipReasonOf(member) })) };
  const lead = leadOf(members);
  return { named: false, answerers: lead ? [{ member: lead, skip: null }] : [] };
}

/** Why a group cannot have these members: too few or too many still in the workspace, or two sharing a name. */
export function memberProblem(members: readonly { name: string; status?: string }[]): "too_few" | "too_many" | "duplicate_name" | null {
  const live = members.filter((m) => m.status !== "ARCHIVED");
  if (live.length < GROUP_LIMITS.minMembers) return "too_few";
  if (live.length > GROUP_LIMITS.maxMembers) return "too_many";
  const names = live.map((m) => m.name.trim().toLowerCase());
  return new Set(names).size === names.length ? null : "duplicate_name";
}

/** The group's name: the one given, trimmed and cut to 60, else its first three teammates' names. */
export function groupNameFrom(input: string | null | undefined, memberNames: readonly string[]): string {
  const given = (input ?? "").trim();
  return clampText(given || GROUP_COPY.groupDefaultName(memberNames.slice(0, 3)), GROUP_LIMITS.nameMax).trim();
}
