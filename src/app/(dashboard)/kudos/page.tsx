// Teams > Kudos. Gate: every Member (the `kudos` APP_RULES row); a Guest
// gets the in-shell 404 (spec-teams-performance section 1 Access).

import { cultureGate } from "@/lib/people/culture-gate";
import KudosClient from "./kudos-client";

export const dynamic = "force-dynamic";

export default async function KudosPage() {
  await cultureGate("kudos", "/kudos");
  return <KudosClient />;
}
