// Route gate for the Tables module. A server layout (there is no middleware
// and the dashboard layout is a client component) so a bookmarked /tables
// can't bypass the Settings → Modules toggle. When the org hasn't turned
// Tables on, the module's pages are replaced by the honest "enable" screen.

import { requireSessionUser } from "@/lib/page-gates";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { ModuleDisabledScreen } from "@/components/layout/module-disabled";

const MOD = MODULE_BY_SLUG["workwrk-tables"];
const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

export default async function TablesModuleLayout({ children }: { children: React.ReactNode }) {
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
