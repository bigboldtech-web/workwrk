import { settingsGateAllows, SettingsDenied } from "@/components/settings/settings-gate";
import { SettingsOverviewClient } from "./overview-client";
import { permanentRedirect } from "next/navigation";
import { settingsRedirectFor, settingsRedirectTarget } from "@/lib/settings-registry";

// The Workspace settings Overview (registry gate owner-admin). A signed-in
// person below Admin who types /settings gets the Ask-an-admin strip over their own Profile at the same
// URL (spec-shell 1.6, 2.8): never a redirect and never a 404, because the
// personal door shares the prefix. The card body is overview-client.tsx.
// The avatar menu's old query rows (/settings?tab=themes, ?tab=shortcuts)
// 308 to the personal door (settings-architecture 8.4). next.config.ts
// answers them in production before routing; this is the same rule for a
// server that has not re-read its config, and for anyone, so a person below
// Admin reaches their own Preferences rather than the AdminOnly card.
export default async function SettingsOverviewPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = (await searchParams) ?? {};
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.append(k, v);
    else if (Array.isArray(v)) for (const x of v) qs.append(k, x);
  }
  const search = qs.toString() ? `?${qs.toString()}` : "";
  const moved = settingsRedirectFor("/settings", search);
  if (moved) permanentRedirect(settingsRedirectTarget(moved, search));

  if (!(await settingsGateAllows("overview"))) return <SettingsDenied page="overview" />;
  return <SettingsOverviewClient />;
}
