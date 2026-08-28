// Route gate for the Talk module. A server layout (there is no middleware and
// the dashboard layout is a client component) so a bookmarked /tlk can't
// bypass the Settings → Modules toggle. When the org hasn't turned Talk on,
// the module's pages are replaced by the honest "enable in Settings" screen.

import { requireSessionUser } from "@/lib/page-gates";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { ModuleDisabledScreen } from "@/components/layout/module-disabled";

const MOD = MODULE_BY_SLUG["workwrk-talk"];
const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

export default async function TalkModuleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  if (await isModuleActive(user.organizationId, MOD.productSlug)) return <>{children}</>;
  return (
    <ModuleDisabledScreen
      label={MOD.label}
      competesWith={MOD.competesWith}
      blurb={MOD.blurb}
      canEnable={ADMIN_LEVELS.has(user.accessLevel)}
    />
  );
}
