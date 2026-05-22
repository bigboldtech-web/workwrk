// /learning now redirects to the default board (My courses). See
// src/lib/products/boards.ts for the workwrk-learn board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function LearningIndexPage() {
  const board = getDefaultBoardKey("workwrk-learn") ?? "mine";
  redirect(`/learning/${board}`);
}
