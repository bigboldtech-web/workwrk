// Sidebar personalization: pinned items + recent-visit history.
//
// Both lists are scoped per-browser (localStorage) and keyed off the
// `NavItem.key` strings declared in [sidebar.tsx]. We store keys, not
// hrefs, so a route move doesn't orphan a pin. Subscribers (sidebar +
// command palette) react to the `workwrk:sidebar-prefs` event so two
// open tabs stay in sync.

const PINNED_KEY = "workwrk:sidebar:pinned";
const RECENT_KEY = "workwrk:sidebar:recent";
const EVENT = "workwrk:sidebar-prefs";
const RECENT_MAX = 6;

function readArr(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeArr(key: string, arr: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(arr));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getPinned(): string[] {
  return readArr(PINNED_KEY);
}

export function isPinned(navKey: string): boolean {
  return getPinned().includes(navKey);
}

export function togglePin(navKey: string): string[] {
  const current = getPinned();
  const next = current.includes(navKey) ? current.filter((k) => k !== navKey) : [...current, navKey];
  writeArr(PINNED_KEY, next);
  return next;
}

export function getRecent(): string[] {
  return readArr(RECENT_KEY);
}

/** Push `navKey` to the front of the recent list (deduped, capped). */
export function trackRecent(navKey: string) {
  const current = getRecent();
  const next = [navKey, ...current.filter((k) => k !== navKey)].slice(0, RECENT_MAX);
  // Only write if changed — avoids dispatching events on every tick of
  // a route the user is already sitting on.
  if (next.length !== current.length || next[0] !== current[0]) {
    writeArr(RECENT_KEY, next);
  }
}

/** Subscribe to pin / recent changes. Returns an unsubscribe function. */
export function subscribeSidebarPrefs(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // We listen for both our internal event AND the cross-tab `storage`
  // event, since CustomEvents don't traverse tabs but localStorage
  // writes do.
  const handler = () => cb();
  const storageHandler = (e: StorageEvent) => {
    if (e.key === PINNED_KEY || e.key === RECENT_KEY) cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
