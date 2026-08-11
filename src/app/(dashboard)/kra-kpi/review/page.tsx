// KRA/KPI · Review — manager cadence review of direct reports. Manager
// door; employees record their own numbers on their career home instead.

import ReviewClient from "./review-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function KraKpiReviewPage() {
  await requireManagerPage();
  return <ReviewClient />;
}
