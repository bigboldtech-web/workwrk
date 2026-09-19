// "Did this tab ARRIVE here, or navigate here?"
//
// The task drawer needs the answer and Next will not give it. The rule the
// spec writes down is simple: a soft navigation to `/item/<id>` renders the
// drawer over the list you came from, a hard load of the same URL renders the
// full page. Intercepting routes are almost that rule, and the gap is
// measured, not theoretical: on Next 16 in this repo a hard load of
// `/item/<id>` correctly falls through to the page, but a hard load of
// `/item/<id>?comment=<x>` matches the INTERCEPT as well, so a comment
// notification opened in a new tab arrived as a drawer floating over a full
// page of the same task. Every mention and comment notification builds exactly
// that URL (src/lib/notify-item.ts).
//
// The obvious fix, and the one that has to be avoided: do NOT gate the
// intercept on where the navigation came from. When the intercept matches and
// renders nothing, Next has already held `children` on the previous surface,
// so the URL becomes the task's and the task is shown nowhere at all. That is
// a silent removal of every door into a task that is not a migrated list.
//
// So the question is asked the other way round, of the TAB rather than of the
// navigation: this module remembers the first path the shell ever rendered and
// whether the tab has since moved off it. The one state that means "the
// document was loaded at this URL" is `entry === pathname && !navigated`, and
// it is false forever after the first navigation, so returning to the same
// task later in the session is a soft navigation like any other.
//
// Pure module, no imports: one shell call records, one host asks.

let entry: string | null = null;
let navigated = false;

/**
 * Called by the shell on every render with the current pathname. The shell is
 * the drawer slot's parent, so this has always run before the slot's own
 * render asks the question.
 */
export function recordShellPath(pathname: string | null | undefined): void {
  if (!pathname) return;
  if (entry === null) {
    entry = pathname;
    return;
  }
  if (pathname !== entry) navigated = true;
}

/** True only while this path is the one the document was loaded at. */
export function isInitialEntryPath(pathname: string): boolean {
  return !navigated && entry === pathname;
}

/** Test seam: forget what this module remembers. */
export function resetEntryPathForTest(): void {
  entry = null;
  navigated = false;
}
