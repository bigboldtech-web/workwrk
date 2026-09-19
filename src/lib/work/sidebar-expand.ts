// Which rows of the Spaces tree are open, and which Spaces a person hid.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Tree data):
// "Expand state per user in `UserPreference.sidebar.expanded[]` (new key under
// the existing `sidebar` JSON column) so it survives reload (today session
// memory only)" and "Hidden Spaces: 'Hide from sidebar' writes
// `UserPreference.sidebar.hiddenSpaceIds[]`".
//
// WHAT WAS WRONG. `space-tree-row.tsx` kept both expand maps in module-level
// `Map`s. That survives the rail's hover-preview unmount, which is what they
// were added for, and nothing else: a reload, a second tab, another machine or
// tomorrow all start collapsed. A person who works in one Space re-opened the
// same three rows every single morning.
//
// THE SHAPE OF THIS MODULE. The in-memory maps stay as the fast path (a tree
// row must decide "am I open?" during render, not after a fetch), and this adds
// a hydrate-once read and a debounced write around them. Everything degrades to
// the old behaviour if the preference read or write fails: session memory, no
// error, no lost work, because nothing here is user content.
//
// The keys are in `src/lib/preferences-schema.ts` (`sidebarPatchSchema`), which
// is a `strictObject`: a key that is not declared there is a 400 and a
// preference that silently never persists.

/** Debounce window for the PATCH. A person expands several rows in a burst. */
const WRITE_DELAY_MS = 800;

let expandedIds = new Set<string>();
let hiddenSpaceIds = new Set<string>();
let hydrated = false;
/** Distinct from `hydrated`: true only when the stored value actually ARRIVED. */
let hydrateOk = false;
let hydrating: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

// THE WIPE THIS PREVENTS. The write sends the whole in-memory set, and the set
// starts empty and is only filled by the hydrate read. A row expanded inside
// the first few hundred milliseconds, or any expand at all after a failed
// read, therefore persisted a list built from an empty base: every other
// expanded row, and worse, every Space the person had HIDDEN, quietly came
// back. So two rules. One: nothing is persisted until the read has succeeded.
// Two: a toggle made before the read lands is remembered here and re-applied
// on top of the stored value, so waiting costs the person nothing.
const pendingExpand = new Map<string, boolean>();
const pendingHidden = new Map<string, boolean>();

function applyPending(): void {
  for (const [id, open] of pendingExpand) {
    if (open) expandedIds.add(id);
    else expandedIds.delete(id);
  }
  for (const [id, hidden] of pendingHidden) {
    if (hidden) hiddenSpaceIds.add(id);
    else hiddenSpaceIds.delete(id);
  }
}

/** Subscribers re-render when the hydrate lands or a hide changes the list. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* one bad subscriber must not stop the rest */ }
  }
}

export function subscribeSidebarState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Read the stored state once per page load. Safe to call from every row. */
export async function hydrateSidebarState(): Promise<void> {
  if (hydrated) return;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const res = await fetch("/api/preferences", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const sidebar = data?.effective?.sidebar ?? {};
        if (Array.isArray(sidebar.expanded)) expandedIds = new Set(sidebar.expanded as string[]);
        if (Array.isArray(sidebar.hiddenSpaceIds)) hiddenSpaceIds = new Set(sidebar.hiddenSpaceIds as string[]);
        hydrateOk = true;
        applyPending();
      }
    } catch {
      // Session memory it is. The tree still works; it just forgets on reload,
      // and (hydrateOk staying false) it never overwrites what is stored.
    } finally {
      hydrated = true;
      hydrating = null;
      pendingExpand.clear();
      pendingHidden.clear();
      notify();
    }
  })();
  return hydrating;
}

export function isHydrated(): boolean {
  return hydrated;
}

export function isExpanded(id: string): boolean {
  return expandedIds.has(id);
}

export function setExpanded(id: string, open: boolean): void {
  if (open === expandedIds.has(id)) return;
  if (open) expandedIds.add(id);
  else expandedIds.delete(id);
  if (!hydrated) pendingExpand.set(id, open);
  schedulePersist();
}

export function hiddenSpaces(): string[] {
  return [...hiddenSpaceIds];
}

export function isSpaceHidden(id: string): boolean {
  return hiddenSpaceIds.has(id);
}

export function setSpaceHidden(id: string, hidden: boolean): void {
  if (hidden === hiddenSpaceIds.has(id)) return;
  if (hidden) hiddenSpaceIds.add(id);
  else hiddenSpaceIds.delete(id);
  if (!hydrated) pendingHidden.set(id, hidden);
  notify();
  schedulePersist();
}

/** Expand or collapse every currently known row: the section menu's two rows. */
export function setAllExpanded(ids: readonly string[], open: boolean): void {
  for (const id of ids) {
    if (open) expandedIds.add(id);
    else expandedIds.delete(id);
    if (!hydrated) pendingExpand.set(id, open);
  }
  notify();
  schedulePersist();
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void (async () => {
      // Never write a list built on an empty base: that is how a hide vanishes.
      await hydrateSidebarState();
      if (!hydrateOk) return;
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // `keepalive` so a tab closed right after an expand still records it.
        keepalive: true,
        body: JSON.stringify({
          sidebar: {
            // Capped: a tree of ten thousand open rows is not a preference, and
            // an unbounded array in a JSON column is how one gets slow.
            expanded: [...expandedIds].slice(0, 500),
            hiddenSpaceIds: [...hiddenSpaceIds].slice(0, 500),
          },
        }),
      }).catch(() => {
        // A failed write costs the memory of one expand, never any content.
      });
    })();
  }, WRITE_DELAY_MS);
}

/** Tests and the rail's remount path: forget everything without writing. */
export function resetSidebarStateForTest(): void {
  expandedIds = new Set();
  hiddenSpaceIds = new Set();
  hydrated = false;
  hydrateOk = false;
  hydrating = null;
  pendingExpand.clear();
  pendingHidden.clear();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  listeners.clear();
}
