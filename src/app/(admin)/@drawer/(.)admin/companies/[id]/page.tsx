// The company drawer: an INTERCEPT of /admin/companies/[id] in the Staff
// console's @drawer slot (the product's @drawer/(.)people/[id] pattern). A
// click on a Companies row renders the company in the 520 drawer over the
// list, which stays mounted with its filters and scroll; a hard load, a new
// tab or a refresh renders the full page at admin/companies/[id].

import { CompanyDrawerHost } from "@/app/(admin)/company-drawer-host";

export default async function InterceptedCompanyDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyDrawerHost companyId={id} />;
}
