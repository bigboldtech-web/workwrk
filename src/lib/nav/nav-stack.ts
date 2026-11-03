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

// ── Drawer runs ─────────────────────────────────────────────────────
//
// The task and person drawers each live at their own URL (/item/<id>,
// /people/<id>) over the page they were opened from, and every row clicked
// while one is open pushes another such URL. Close must land on the page
// under them in one go, not walk back through each record opened on the way.

const PEOPLE_PAGES = new Set(["me", "departments", "roles", "skills"]);

/** Is this mirror entry a drawer's own URL: a task, or a person (not one of the pages beside the record)? */
export function isDrawerEntry(url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const item = /^\/item\/[^/]+$/.exec(path);
  if (item) return true;
  const person = /^\/people\/([^/]+)$/.exec(path);
  return !!person && !PEOPLE_PAGES.has(person[1]);
}

/**
 * How many steps back a drawer's Close goes: past every drawer entry in a
 * row ending at the cursor, to the page under them. When the run starts the
 * mirror (the first of them was loaded as a full page), it stops on that
 * first entry. 0 when the current entry is not a drawer's or is the first.
 */
export function drawerStepsBack(cur: NavStack): number {
  if (cur.idx < 1 || cur.idx >= cur.stack.length || !isDrawerEntry(cur.stack[cur.idx])) return 0;
  let run = 0;
  while (cur.idx - run >= 0 && isDrawerEntry(cur.stack[cur.idx - run])) run++;
  return Math.min(run, cur.idx);
}
