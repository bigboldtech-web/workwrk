// What the AutosaveIndicator says, as a pure function of the save state.
//
// The indicator itself is a few lines of markup around this. The decision it
// makes is the data-integrity contract (design-system 5.17): a save that
// failed must be visible and retryable, never silent, and never conveyed by
// colour alone. That is a rule worth a test, and the repo's vitest runs pure
// modules only (no jsdom, no RTL), so the rule lives here where it can be
// tested and the component stays presentation.

import type { AutosaveStatus } from "@/hooks/use-autosave";

export type AutosaveLabels = {
  saving?: string;
  saved?: string;
  error?: string;
  dirty?: string;
  idle?: string;
};

export type AutosaveDisplay = {
  /** Which dot to draw, or none. */
  dot: "brand" | "success" | "danger" | null;
  /** The word beside it. `null` draws nothing. */
  text: string | null;
  /** `true` when the words must read as an error, not just look like one. */
  danger: boolean;
  /** Render the Retry link. */
  retry: boolean;
  /** The whole indicator is blank right now (a faded "Saved"). */
  blank: boolean;
};

export function autosaveDisplay(
  status: AutosaveStatus,
  opts: { hasRetry?: boolean; savedVisible?: boolean; labels?: AutosaveLabels } = {},
): AutosaveDisplay {
  const { hasRetry = false, savedVisible = true, labels } = opts;

  if (status === "saving") {
    return { dot: "brand", text: labels?.saving ?? "Saving…", danger: false, retry: false, blank: false };
  }
  if (status === "saved") {
    if (!savedVisible) return { dot: null, text: null, danger: false, retry: false, blank: true };
    return { dot: "success", text: labels?.saved ?? "Saved", danger: false, retry: false, blank: false };
  }
  if (status === "error") {
    // With a retry in hand the word is "Not saved" and the link does the
    // saying. Without one the app is still trying, and says so. Either way
    // there is a word: never a red dot on its own.
    return {
      dot: "danger",
      text: hasRetry ? "Not saved" : (labels?.error ?? "Not saved, retrying"),
      danger: true,
      retry: hasRetry,
      blank: false,
    };
  }
  if (status === "dirty") {
    return { dot: null, text: labels?.dirty ?? "Unsaved changes", danger: false, retry: false, blank: false };
  }
  return { dot: null, text: labels?.idle ?? null, danger: false, retry: false, blank: false };
}
