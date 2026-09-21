// One policy's acknowledgement ledger: people data, so a manager's page.
//
// spec-process section 1: "/policies/[id]/compliance | Owner, Admin, People
// team (org); hasReports over their chain | everyone else: 404 inside the
// shell. The policy is discoverable but its ledger is people data and the
// '...' > Acknowledgements row is not rendered for them, so the ledger URL is
// not discoverable either."
//
// The policy page itself stays open to every Member: only this child gates.

import { requireManagerOr404 } from "@/lib/route-guard";

export default async function PolicyLedgerLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOr404();
  return <>{children}</>;
}
