// /payroll now redirects to the default board (Pay runs). See
// src/lib/products/boards.ts for the workwrk-pay board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function PayrollIndexPage() {
  const board = getDefaultBoardKey("workwrk-pay") ?? "runs";
  redirect(`/payroll/${board}`);
}
