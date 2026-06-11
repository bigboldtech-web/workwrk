/**
 * Taupe accent — the ClickUp-themed accent used by the task-creation
 * surfaces (create-task / create-list modals, tasks page). Kept separate
 * from the app's violet brand (`--accent`) on purpose: these surfaces
 * mirror a warm, neutral ClickUp theme. Centralized here so the hex
 * never drifts across files.
 */
export const TAUPE = {
  /** Primary fill (buttons, selected dates). */
  base: "#9d7d70",
  /** Primary fill hover. */
  hover: "#8e7165",
  /** Focus rings + input borders (lighter). */
  ring: "#c39b8c",
  /** Checks, active accents on neutral ground. */
  soft: "#a78b80",
} as const;

/** Class string for the solid taupe CTA. Backed by the real `.btn-taupe`
 *  rule in globals.css (fill + hover + disabled) so it renders reliably;
 *  the utilities here only add weight + motion. */
export const taupeButton = "btn-taupe font-semibold transition-colors";
