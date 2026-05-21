// /crm now redirects to the default board (Pipeline). The product is
// no longer a single page — it's an app with multiple boards declared
// in src/lib/products/boards.ts.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function CrmIndexPage() {
  const board = getDefaultBoardKey("workwrk-crm") ?? "pipeline";
  redirect(`/crm/${board}`);
}
