// /benefits now redirects to the default board (Plans). See
// src/lib/products/boards.ts for the workwrk-benefits board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function BenefitsIndexPage() {
  const board = getDefaultBoardKey("workwrk-benefits") ?? "plans";
  redirect(`/benefits/${board}`);
}
