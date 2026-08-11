// People · Departments — manager door (org-structure administration).

import DepartmentsClient from "./departments-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  await requireManagerPage();
  return <DepartmentsClient />;
}
