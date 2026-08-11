// Review cycle detail — HR-admin door (cycle administration; the API
// additionally filters review rows + anonymous givers server-side).

import ReviewDetailClient from "./review-detail-client";
import { requireHrAdminPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function ReviewCycleDetailPage() {
  await requireHrAdminPage();
  return <ReviewDetailClient />;
}
