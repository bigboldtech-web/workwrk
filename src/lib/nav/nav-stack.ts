// The in-app history mirror's arithmetic, pure.
//
// The browser exposes no way to read its own history, so the shell keeps a
// mirror (top-bar/nav-history.tsx): a list of visited URLs and a cursor, which
// BackButton, goBackOr and the bar's back and forward buttons read. These are
// the four moves that mirror makes, written once so the pathname recorder and
// the same-path entries a page pushes (a Bird's eye focus) keep it true the
// same way, and so a test can pin them without a browser.

export interface NavStack {
  stack: string[];
  idx: number;
}

/** A fresh entry: everything forward of the cursor is dropped, as the browser drops it. */
export function navPush(cur: NavStack, url: string, max = 100): NavStack {
  const kept = cur.idx >= 0 ? cur.stack.slice(0, cur.idx + 1) : [];
  const stack = [...kept, url].slice(-max);
  return { stack, idx: stack.length - 1 };
}

/** The current entry now names `url` (history.replaceState). An empty mirror is seeded with it. */
export function navReplace(cur: NavStack, url: string): NavStack {
  if (cur.idx < 0 || cur.idx >= cur.stack.length) return { stack: [url], idx: 0 };
  if (cur.stack[cur.idx] === url) return cur;
  const stack = [...cur.stack];
  stack[cur.idx] = url;
  return { stack, idx: cur.idx };
}

/**
 * A back or forward step landed on `url` (popstate). The cursor moves to the
 * neighbour that holds it; when neither does (an entry the mirror never saw),
 * the current entry is rewritten, so the mirror is never left pointing at a
 * URL the tab is not on.
 */
export function navPop(cur: NavStack, url: string): NavStack {
  if (cur.stack[cur.idx] === url) return cur;
  if (cur.idx > 0 && cur.stack[cur.idx - 1] === url) return { stack: cur.stack, idx: cur.idx - 1 };
  if (cur.idx >= 0 && cur.idx < cur.stack.length - 1 && cur.stack[cur.idx + 1] === url) {
    return { stack: cur.stack, idx: cur.idx + 1 };
  }
  return navReplace(cur, url);
}

/** Is the entry one step back exactly `url`? */
export function navPreviousIs(cur: NavStack, url: string): boolean {
  return cur.idx > 0 && cur.stack[cur.idx - 1] === url;
}
