// People · Roles — job-title library. Manager door: role definitions are
// managed here; an employee reads their OWN role's definition via the
// link on their career home (/people/me → role page stays readable).

import { Suspense } from "react";
import RolesClient from "./roles-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requireManagerPage();
  return (
    <Suspense>
      <RolesClient />
    </Suspense>
  );
}
