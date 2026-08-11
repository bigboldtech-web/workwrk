// Reviews — performance review cycle administration. HR-admin door
// (matches the catalog gate): managers act on their reports via
// /team/reviews; a person reads their own reviews on their career home.

import { Suspense } from "react";
import ReviewsClient from "./reviews-client";
import { requireHrAdminPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  await requireHrAdminPage();
  return (
    <Suspense>
      <ReviewsClient />
    </Suspense>
  );
}
