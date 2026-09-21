// What an editor does when its save comes back 409.
//
// THE BUG THIS EXISTS TO PREVENT. The doc editor used to answer a 409 by
// re-reading the row's updatedAt, adopting it, and re-sending its own buffer
// once. The server accepted that second PUT, so the peer's committed version
// was gone: no banner, no toast, no draft of theirs, and the ConflictStrip
// only appeared later, from the 30 second poll, telling the person to "reload
// to see their version" after that version had already been overwritten.
//
// The rule now: a 409 stops the writing and says so. The typed text is safe
// in the local draft either way (useLocalDraft mirrors every queued save), so
// the choice is the person's: Reload takes the other version, Dismiss says "I
// know, keep going" and lets the saves resume.
//
// Pure so it can be tested without a DOM.

export type SaveConflictState = {
  /** A 409 has been seen and neither Reload nor Dismiss has answered it. */
  held: boolean;
};

export const noConflict: SaveConflictState = { held: false };

/** A 409 arrived: hold the writes and raise the strip. */
export function onConflict(): SaveConflictState {
  return { held: true };
}

/** The person chose to keep going: writes resume, their version wins. */
export function onDismissConflict(): SaveConflictState {
  return { held: false };
}

/**
 * May this editor send a save right now?
 *
 * `false` is never silent: the caller shows the ConflictStrip and an unsaved
 * indicator while it holds, and the draft keeps the text.
 */
export function canSend(state: SaveConflictState): boolean {
  return !state.held;
}
