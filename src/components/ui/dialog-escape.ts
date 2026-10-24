// Esc inside a dialog (settings-cleanup Phase 3 review, follow-up).
//
// Radix hears Esc before the shell does (a capture listener on the
// document), so with a date list, a time list or any Picker open INSIDE a
// dialog, one Esc closed the whole dialog and the form in it: a New meeting
// half filled in was gone. The rule AccountDialog already kept
// (account-ui.tsx) now holds for every ui/dialog: while a popover is the top
// layer of the shell's layer stack, Esc closes that popover alone and the
// dialog stays open with its form. Esc with nothing open above the dialog is
// the dialog's own Esc, as before: its caller's onEscapeKeyDown runs and
// Radix closes it unless that handler prevents it. preventDefault also tells
// the shell's own Esc listener the key was used (it skips a defaultPrevented
// event), so a second layer never closes on the same key.

/** The part of the shell's layer stack this reads (useLayerStack's value). */
export interface EscapeLayers {
  topLayerKind: string | null;
  closeTopLayer: () => unknown;
}

/** What one Esc in a dialog did: closed the popover above it, or went to the dialog. */
export function dialogEscape<E extends { preventDefault(): void }>(
  event: E,
  layers: EscapeLayers | null | undefined,
  next?: (event: E) => void,
): "layer" | "dialog" {
  if (layers?.topLayerKind === "popover") {
    event.preventDefault();
    layers.closeTopLayer();
    return "layer";
  }
  next?.(event);
  return "dialog";
}
