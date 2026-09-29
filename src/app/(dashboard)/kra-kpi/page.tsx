// Teams > KRAs & KPIs: the definitions per job title. Every Member reads
// (the `kra-kpi` APP_RULES row, access section 9 kras.view); the create and
// attach controls render only for the kras permissions the routes ask.
// A person's own numbers stay on their profile (/people/me?tab=kras).

import { Suspense } from "react";
import KraKpiWorkspaceClient from "./workspace-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function KraKpiPage() {
  await gatePage("view", { type: "app", key: "kra-kpi" }, { callbackUrl: "/kra-kpi" });
  return (
    <Suspense>
      <KraKpiWorkspaceClient />
    </Suspense>
  );
}
