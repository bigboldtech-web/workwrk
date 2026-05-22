"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { CatalogTab } from "@/components/learning/tabs";

export default function LearningCatalogPage() {
  return (
    <BoardShell productSlug="workwrk-learn" boardKey="catalog" viewMode="table">
      <CatalogTab />
    </BoardShell>
  );
}
