// The Tools or Goals app door for a person OTHER than the one asking (batch 7,
// review round 3). A share is worth nothing to someone their app refuses (a
// Tools floor in Settings > Apps, or a Guest), so the dialog must not tell
// anyone otherwise: not in the row, not in Check access, not in the notice.
// Asked with can(), never requireCan: nobody tried to open anything, so no
// denial is logged.

import { prisma } from "@/lib/prisma";
import { parseOrgAppsConfig } from "../settings";
import { accessV2Resolver, settingsGateLogOnly } from "../flags";
import { settingsGateMode } from "../settings-gate-engine";
import { RULE_1_DENIED_STATUSES } from "../resolve";

export type DoorKind = "tool" | "goal";

const KEY: Readonly<Record<DoorKind, "tools" | "goals">> = { tool: "tools", goal: "goals" };

/** Goals keep people out by the app row only once the engine enforces app gates (the goal page's rule). */
const goalGatesEnforced = () => settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() }) === "engine";

/**
 * Does the workspace limit this app at all (hidden, or a floor)? Read once
 * per panel: with no limit nobody but a Guest is kept out, so a panel asks no
 * per-person question.
 */
export async function appLimited(organizationId: string, kind: DoorKind): Promise<boolean> {
  if (kind === "goal" && !goalGatesEnforced()) return false;
  const pref = await prisma.orgPreference.findUnique({ where: { organizationId }, select: { sidebarDefault: true } });
  const sidebar = pref?.sidebarDefault && typeof pref.sidebarDefault === "object" && !Array.isArray(pref.sidebarDefault)
    ? (pref.sidebarDefault as Record<string, unknown>)
    : {};
  const apps = parseOrgAppsConfig(sidebar.apps);
  return (apps.hidden ?? []).includes(KEY[kind]) || !!apps.minAccess?.[KEY[kind]];
}

/**
 * The app door for this person, by the engine as them: "open"; "inactive"
 * for a deactivated account (or one no longer in the workspace), whom no
 * door lets in; "closed" when the app keeps them out.
 */
export async function appDoorFor(organizationId: string, userId: string, kind: DoorKind): Promise<"open" | "closed" | "inactive"> {
  try {
    const row = await prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { status: true } });
    if (!row || RULE_1_DENIED_STATUSES.has(String(row.status))) return "inactive";
    const { viewerForUser } = await import("../viewer");
    const { can } = await import("../index");
    const viewer = await viewerForUser(organizationId, userId);
    if (!viewer) return "inactive";
    const decision = await can(viewer, "view", { type: "app", key: KEY[kind] });
    if (decision.allowed) return "open";
    // Goals outside engine mode: only a Guest is kept out (requireGoalPage's
    // notFound); a hidden or floored app is not.
    return kind === "goal" && !goalGatesEnforced() && decision.discoverable ? "open" : "closed";
  } catch {
    return "closed";
  }
}

/** Is the app open to this person? */
export async function appOpenFor(organizationId: string, userId: string, kind: DoorKind): Promise<boolean> {
  return (await appDoorFor(organizationId, userId, kind)) === "open";
}

/** Check access when the door is not open: a deactivated account, or the app closed to them. */
export const DOOR_SENTENCE: Readonly<Record<DoorKind, Record<"closed" | "inactive", string>>> = {
  tool: { closed: "No access. The Tools app is closed to them in this workspace.", inactive: "No access. Their account is deactivated." },
  goal: { closed: "No access. The Goals app is closed to them in this workspace.", inactive: "No access. Their account is deactivated." },
};

/** On the maker's row, which holds no share: they cannot open the tool either. */
export const MAKER_APP_CLOSED_NOTE = "The Tools app is closed to them, so they can't open this tool until it opens.";

export const APP_CLOSED_NOTE: Readonly<Record<DoorKind, string>> = {
  tool: "The Tools app is closed to them, so this share gives them nothing until it opens.",
  goal: "The Goals app is closed to them, so they can't open this goal until it opens.",
};
