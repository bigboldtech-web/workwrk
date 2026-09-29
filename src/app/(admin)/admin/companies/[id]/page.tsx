"use client";

// /admin/companies/[id] as a FULL PAGE: a pasted or bookmarked link, a
// refresh, a new tab. A click on a Companies row opens the same URL as the
// 520 drawer instead ((admin)/@drawer/(.)admin/companies/[id]). Both render
// CompanyRecord, so the two can never disagree.

import { useParams } from "next/navigation";
import { CompanyRecord } from "./company-record";

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  return <CompanyRecord id={id} presentation="page" />;
}
