// /agreements: Contracts. Owner, Admin and the People team.
//
// Spec: docs/plans/ui-refresh/spec-process.md section 1 (the row table:
// "/agreements | Owner, Admin, People team (the `agreements` app key, access
// section 5.2.1) | others: 404 inside the shell, row absent") and
// sidebar-map.md section 6 row 15.
//
// WHY THIS FILE EXISTS. The Docs sidebar hides the Contracts row from anyone
// below the People team, and APP_RULES gives the `agreements` key the
// audience "people-team-admin". The PAGE had no gate at all, so a plain
// Member who typed the URL got the whole Contracts surface: tabs, a blue
// "New contract", and an empty state reading "No contracts yet" when the
// truth was "you may not see contracts". Every API call underneath answered
// 403. Hiding a row is not a gate; this is.
//
// THE GATE IS ON THE PAGE, NOT ON A LAYOUT, and that is deliberate.
// /agreements/[id] must stay reachable for a Member who is a PARTY to a
// contract (spec section 1: "a party who is a Member: Can view, their own
// signing link only"), and a layout here would 404 them out of their own
// signature. The list is the thing the app key gates.

import { gatePage } from "@/lib/access/gate";
import { AgreementsClient } from "./agreements-client";

export const dynamic = "force-dynamic";

export default async function AgreementsPage() {
  await gatePage("view", { type: "app", key: "agreements" }, { callbackUrl: "/agreements" });
  return <AgreementsClient />;
}
