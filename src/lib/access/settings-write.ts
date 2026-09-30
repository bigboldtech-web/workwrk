// Every org write API on its settings page's rule (settings-architecture 3.1
// and 9, spec-settings-workspace S1: "every org write API on the page rule").
//
// One call per write route, naming the Workspace settings page the setting
// lives on. The actor is re-read from the database first
// (freshWorkspaceActor), so an Admin demoted a moment ago, or a session the
// account has moved past, is refused now and not at the five-minute check.
//
//   Owner pages (Billing, Security, API)   the Owner split's rule: every Admin
//                                          while SETTINGS_OWNER_SPLIT is off,
//                                          else an Owner or an Admin holding
//                                          the page's scope
//   every other page                       an Owner or an Admin; with the
//                                          engine deciding the settings door
//                                          (ACCESS_V2_RESOLVER on, log-only
//                                          off) the engine's `manage` answer
//                                          on the page must agree as well
//
// The People team reads four pages (Members, Structure, Access, Scoring) and
// writes none of their org settings here: its writes (people fields, the
// process section) have their own rules.
//
// Server-only.

import { NextResponse } from "next/server";
import type { SettingsPageKey } from "./types";
import { OWNER_SETTINGS_PAGES } from "./settings-legacy";
import { delegateOn } from "./flags";
import { freshMayManageOwnerPage, freshWorkspaceActor, ownerSplitOn, scopeForOwnerPage, sessionIsWorkspaceAdmin, type FreshActor } from "./workspace-admin";

export type SettingsWriteResult = { ok: true; actor: Extract<FreshActor, { ok: true }> } | { ok: false; response: NextResponse };

/**
 * The denial body every settings gate answers with (names the page, never a
 * bare 403). The sentence says what the rule in force is today: an Owner
 * page is every Admin's while SETTINGS_OWNER_SPLIT is off, and "see" on a
 * read (a key list, an export), "change" on a write.
 */
export function settingsWriteDenied(page: SettingsPageKey, ownerPage: boolean, verb: "change" | "see" = "change"): NextResponse {
  const who = ownerPage && ownerSplitOn() ? "the workspace Owner, or an Admin given this page," : "a workspace Owner or Admin";
  return NextResponse.json(
    {
      error: `Only ${who} can ${verb} this`,
      code: ownerPage ? "owner_only" : "admin_only",
      page,
    },
    { status: 403 },
  );
}

/**
 * May the signed-in person write (or, with `{ read: true }`, read) the org
 * setting that lives on `page`? Returns the fresh actor on success, the
 * response to send otherwise. A read route passes `read` so its refusal says
 * "see", never "change".
 */
export async function settingsWriteGate(session: unknown, page: SettingsPageKey, opts: { read?: boolean } = {}): Promise<SettingsWriteResult> {
  const verb = opts.read ? "see" : "change";
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) {
    return { ok: false, response: NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status }) };
  }
  const ownerPage = OWNER_SETTINGS_PAGES.has(page);
  const allowed = ownerPage ? freshMayManageOwnerPage(fresh, scopeForOwnerPage(page)) : fresh.admin;
  if (!allowed) return { ok: false, response: settingsWriteDenied(page, ownerPage, verb) };
  if (!ownerPage && delegateOn("settings")) {
    const { can, viewerFromSession } = await import("./index");
    const viewer = await viewerFromSession();
    if (!viewer || !(await can(viewer, "manage", { type: "settings", page })).allowed) {
      return { ok: false, response: settingsWriteDenied(page, false, verb) };
    }
  }
  return { ok: true, actor: fresh };
}

/**
 * The read-side twin for a page's `canEdit` flag (no database read): an Owner
 * or an Admin by the session. A write still goes through settingsWriteGate,
 * so a stale flag can only show a control the server then refuses, never the
 * other way round.
 */
export function sessionMayEditSettings(session: unknown): boolean {
  return sessionIsWorkspaceAdmin(session);
}
