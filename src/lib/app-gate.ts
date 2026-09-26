// One app-key gate for API routes (access-model-spec 5.2.1 and 5.5), for the
// Phase 7 surfaces: Ask AI, Agents, Automation, Marketplace, Integrations,
// Build apps, Tools and Assets.
//
// It delegates to requireCan, so the access engine stays inert and every
// denial has the one shape: 401 signed out, 404 for a viewer outside the
// app's audience (a Guest, a Member on an Owner-and-Admin app), 403
// { error: "app_off", app } when the org hid or floored the app (or, for
// `ai`, turned AI features off).

import { NextResponse } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import type { Action, AppKey, SettingsPageKey, Viewer } from "@/lib/access/types";

export type GateResult = { viewer: Viewer } | { error: NextResponse };

function toResponse(e: unknown): NextResponse {
  if (e instanceof AccessError) return NextResponse.json(e.body, { status: e.status });
  throw e;
}

/** `view` (or another action) on an app key. */
export async function requireApp(key: AppKey, action: Action = "view"): Promise<GateResult> {
  try {
    const { viewer } = await requireCan(action, { type: "app", key });
    return { viewer };
  } catch (e) {
    return { error: toResponse(e) };
  }
}

/**
 * The Owner-and-Admin write gate for org-level installs: turning a module on,
 * adding or scheduling an agent (access section 9, settings.manageIntegrations,
 * which resolves through the Apps settings page gate).
 */
export async function requireManageApps(page: SettingsPageKey = "apps"): Promise<GateResult> {
  try {
    const { viewer } = await requireCan("manage", { type: "settings", page });
    return { viewer };
  } catch (e) {
    return { error: toResponse(e) };
  }
}

export function isOwnerOrAdmin(viewer: Viewer): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
}
