// Any /settings/* path no page owns lands on the Workspace settings Overview
// (spec-settings-workspace section 3, AskAnAdminStrip row: "no 404 anywhere
// under /settings/*"). The Overview carries its own gate, so an Owner or Admin
// sees the Overview and everyone else sees the Ask-an-admin strip over their
// own My settings > Profile, the same denial as every other Workspace page
// (settings-gate.tsx SettingsDenied). Next resolves a
// catch-all last, so this never shadows a real page; a moved old URL answers
// from the registry twin first, with its exact target.
//
// A temporary redirect on purpose: an unknown path is not a permanent move.

import { permanentRedirect, redirect } from "next/navigation";
import { settingsRedirectFor, settingsRedirectTarget } from "@/lib/settings-registry";

export const dynamic = "force-dynamic";

export default async function UnknownSettingsPath({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  const path = `/settings/${(rest ?? []).map(encodeURIComponent).join("/")}`;
  const moved = settingsRedirectFor(path);
  if (moved) permanentRedirect(settingsRedirectTarget(moved));
  redirect("/settings");
}
