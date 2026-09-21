// The one save model for every SOP kind (spec-process section 2 `/sops/[id]`,
// "Save model, one rule for every kind"): drafts autosave, published SOPs
// save on an explicit Save, and the header always tells the truth about it.
//
// Two pure functions, each with a test per state:
//   deriveSopSaveState  what the AutosaveIndicator shows and whether the
//                       sticky save bar renders
//   nextRetryDelay      the backoff between failed attempts (800ms doubling,
//                       four tries) and "give up" past the budget, after which
//                       the indicator reads "Not saved" with a Retry link.
//
// The engine that drives them (src/components/sops/sop-editor-page.tsx) is a
// pure observer of the PATCH it always made; nothing about keepalive or the
// request body lives here.

import type { AutosaveStatus } from "@/hooks/use-autosave";

export interface SopSaveInput {
  /** A PATCH is in flight. */
  saving: boolean;
  /** The most recent PATCH failed and nothing has succeeded since. */
  failed: boolean;
  /** Retries are still scheduled for the failure. */
  retrying: boolean;
  /** Local state differs from the last saved snapshot. */
  dirty: boolean;
  /** Drafts autosave; published SOPs never do. */
  autosaves: boolean;
  lastSaved: Date | null;
}

export interface SopSaveState {
  status: AutosaveStatus;
  /** The Retry link beside "Not saved" (the retry budget is spent). */
  showRetry: boolean;
  /** The sticky "Unsaved changes · Cancel · Save" bar. */
  showSaveBar: boolean;
  /** The tab-close guard is armed. */
  leaveGuard: boolean;
}

export function deriveSopSaveState(i: SopSaveInput): SopSaveState {
  if (i.saving) {
    return { status: "saving", showRetry: false, showSaveBar: !i.autosaves, leaveGuard: true };
  }
  if (i.failed) {
    return { status: "error", showRetry: !i.retrying, showSaveBar: true, leaveGuard: true };
  }
  if (i.dirty) {
    return { status: "dirty", showRetry: false, showSaveBar: !i.autosaves, leaveGuard: true };
  }
  if (i.lastSaved) {
    return { status: "saved", showRetry: false, showSaveBar: false, leaveGuard: false };
  }
  return { status: "idle", showRetry: false, showSaveBar: false, leaveGuard: false };
}

export const SAVE_RETRY_BASE_MS = 800;
export const SAVE_RETRY_MAX_ATTEMPTS = 4;

/** ms until the next attempt after `attempt` failures (0-based), or null when the budget is spent. */
export function nextRetryDelay(attempt: number): number | null {
  if (attempt >= SAVE_RETRY_MAX_ATTEMPTS - 1) return null;
  return SAVE_RETRY_BASE_MS * 2 ** attempt;
}

/**
 * Create-on-first-change: nothing is written until the first NON-EMPTY change.
 * A blank title with an empty body is not a change.
 */
export function isMeaningfulFirstChange(title: string, contentHasSomething: boolean): boolean {
  return title.trim().length > 0 || contentHasSomething;
}
