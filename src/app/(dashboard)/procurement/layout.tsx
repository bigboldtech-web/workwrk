import { requireManagerOrRedirect } from "@/lib/route-guard";

// Procurement is manager+ only. Vendor roster, PO totals, and
// invoice amounts shape downstream finance reporting.
export default async function ProcurementLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
