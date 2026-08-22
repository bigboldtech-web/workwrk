"use client";

// Tiny event bus so any mutation — creating a list/doc/folder, renaming from the
// doc editor on another route, moving things between folders, deleting — can tell
// the Spaces sidebar to re-fetch itself. No manual page reload.
//
// Fire-and-forget: call refreshSidebar() after a successful mutation; every
// mounted sidebar piece listening via onSidebarRefresh() re-loads its data.

const EVT = "workwrk:sidebar-refresh";

export function refreshSidebar(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function onSidebarRefresh(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

/**
 * Doc mutations (create / rename / trash / restore) must reflect INSTANTLY in
 * BOTH sidebars: the Docs app tree listens on "workwrk:docs-changed", the
 * Spaces tree on "workwrk:sidebar-refresh". Firing only one leaves the other
 * stale until a manual reload — always use this for doc changes.
 */
export function notifyDocsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
  refreshSidebar();
}

/**
 * Table (worksheet) mutations mirror the docs pattern: the Tables app
 * sidebar listens on "workwrk:tables-changed" so a sheet created or renamed
 * anywhere (sidebar "+", list page, CSV import) appears without a reload.
 */
export function notifyTablesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:tables-changed"));
  refreshSidebar();
}
