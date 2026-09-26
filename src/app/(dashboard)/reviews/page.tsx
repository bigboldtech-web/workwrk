// Teams > Review cycles. Gate (Phase 6): the `reviews` APP_RULES row, anyone
// with reports (their chain), the People team and Admin (the org). The
// cycle list is scoped by GET /api/reviews; the write controls render from
// review-cycle-rules.ts (People team, Admin, or the manager who started the
// cycle). A subject reaches their own review by the cycle link they are sent.

import { Suspense } from "react";
import ReviewsClient from "./reviews-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  await gatePage("view", { type: "app", key: "reviews" }, { callbackUrl: "/reviews" });
  return (
    <Suspense>
      <ReviewsClient />
    </Suspense>
  );
}
