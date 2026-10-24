// Handing focus back to a popover's trigger when the popover closes.
//
// A popover that unmounts while focus is inside it (a day in DateField's
// grid, a row in a Picker's list, its search field) drops focus to the page,
// so a keyboard user lands at the top and a screen reader loses its place.
// PickerSelect solved it first (settings-cleanup fix M2); DateField,
// DateTimeField and TimeField share the same rule since the settings
// clean-up's Phase 3 review (M3), so it lives here, in ui/, where all four
// can reach it.

/**
 * Whether closing should put focus back on the trigger: always after a
 * choice; after Esc or a click outside only when focus was lost (on the
 * page, gone with the popover, still inside it, or on a box that holds the
 * trigger: the click-out catcher's mousedown hands focus to the nearest
 * focusable ancestor, such as <main tabindex=-1> or the drawer), never when
 * it has moved to another control, such as a dialog the choice opened.
 */
export function shouldReturnFocus(
  reason: "select" | "dismiss",
  active: { isConnected?: boolean; contains?(node: unknown): boolean } | null,
  page: unknown,
  popover: { contains(node: unknown): boolean } | null,
  trigger?: unknown,
): boolean {
  if (reason === "select") return true;
  if (!active || active === page || active.isConnected === false) return true;
  if (popover && popover.contains(active)) return true;
  return !!trigger && active !== trigger && !!active.contains?.(trigger);
}

/**
 * Close-time focus: back to `trigger` when shouldReturnFocus says so, and
 * once more after the click-out catcher's mousedown has settled (it moves
 * focus to the catcher's focusable ancestor AFTER the close runs). `scope`
 * is the element that holds the trigger and its popover.
 */
export function returnFocusOnClose(
  reason: "select" | "dismiss",
  trigger: { focus(options?: { preventScroll?: boolean }): void } | null,
  scope: { contains(node: unknown): boolean } | null,
): void {
  if (!trigger || typeof document === "undefined") return;
  if (shouldReturnFocus(reason, document.activeElement, document.body, scope, trigger)) trigger.focus({ preventScroll: true });
  window.setTimeout(() => {
    if (shouldReturnFocus("dismiss", document.activeElement, document.body, scope, trigger)) trigger.focus({ preventScroll: true });
  }, 0);
}

/** A useId() value as an id token that is safe inside a space-separated aria-labelledby. */
export function idToken(prefix: string, reactId: string): string {
  return `${prefix}${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
