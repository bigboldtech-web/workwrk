// One policy's acknowledgement ledger: people data, so a manager's page.
//
// spec-process section 1: "/policies/[id]/compliance | Owner, Admin, People
// team (org); hasReports over their chain | everyone else: 404 inside the
// shell. The policy is discoverable but its ledger is people data and the
// '...' > Acknowledgements row is not rendered for them, so the ledger URL is
// not discoverable either."
//
// The policy page itself stays open to every Member: only this child gates.

import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { personScope } from "@/lib/process-scope";

export default async function PolicyLedgerLayout({ children }: { children: React.ReactNode }) {
  // The ledger's own API rule (personScope, the chain, the People team and
  // admins), so the page and GET /api/.../compliance give one answer: a
  // person the API would refuse gets the in-shell 404, not a load error.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!(await personScope(session)).canView) notFound();
  return <>{children}</>;
}
