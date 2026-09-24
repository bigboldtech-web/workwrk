import Link from "next/link";
import { SettingsShell } from "@/components/layout/os/settings-shell";
import { AdminOnly } from "@/components/access";
import { requireSessionUser } from "@/lib/page-gates";
import { isGuestViewer, isOrgAdminViewer } from "@/lib/route-guard";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { SHELL_LABELS } from "@/lib/nav/labels";

// /imports renders inside the settings takeover (spec-shell 2.8): it is the
// one SETTINGS_ROUTES member outside the two door prefixes, with the Data
// row active, until the settings unit 308s it into /settings/data?tab=import.
//
// It gates on the `data` settings page rule (Owners and Admins), exactly like
// /settings/data. Everyone else gets the AdminOnly card at the same URL, never
// a redirect and never a 404 (nothing under the settings door 404s for a
// signed-in person), and the card is NOT a dead end: bringing a CSV into a
// table is a Member's everyday act, so a viewer who can see the Tables hub
// gets "Import a CSV into a table", which opens the in-place CSV dialog on
// /tables (spec-tables-forms section 2 /imports, the ?import=1 latch).
export default async function ImportsLayout({ children }: { children: React.ReactNode }) {
  if (await isOrgAdminViewer()) return <SettingsShell>{children}</SettingsShell>;
  const user = await requireSessionUser();
  const tablesOn = !(await isGuestViewer()) && (await isModuleActive(user.organizationId, MODULE_BY_SLUG["workwrk-tables"].productSlug));
  return (
    <SettingsShell>
      <AdminOnly page="Import" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }}>
        {/* Not "import people": no People importer exists for anyone until
            Settings > Data > Import (Phase 8), so the strip promises only
            what an admin can do here today. */}
        <p className="m-0 mt-3 text-sm text-ink-2">Imports on this page are run by an admin.</p>
        {tablesOn ? (
          <Link href="/tables?import=1" className="mt-2 text-sm font-medium text-brand-deep hover:underline">
            Import a CSV into a table
          </Link>
        ) : null}
      </AdminOnly>
    </SettingsShell>
  );
}
