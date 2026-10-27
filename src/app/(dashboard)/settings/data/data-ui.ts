// Settings > Data's small pure decisions (settings-cleanup Phase 6), kept
// out of the page (a Next page file exports only the page) so each is
// tested on its own.

/**
 * Which cards the Retention & privacy tab draws for its two reads (pure;
 * tested): nothing but the loading rows until BOTH have answered, so the
 * tab never paints one card and then pushes it down with another; then
 * each card over its own read, a failed one as that card's ErrorState. The
 * Retention card is drawn only where it is shown at all (Show upcoming
 * features, or the Trash purge on).
 */
export function retentionTabView(
  retention: "loading" | "ready" | "error",
  privacy: "loading" | "ready" | "error",
  showRetention: boolean,
): { kind: "loading" } | { kind: "cards"; retention: "form" | "error" | null; privacy: "form" | "error" } {
  if ((showRetention && retention === "loading") || privacy === "loading") return { kind: "loading" };
  return {
    kind: "cards",
    retention: showRetention ? (retention === "error" ? "error" : "form") : null,
    privacy: privacy === "error" ? "error" : "form",
  };
}

