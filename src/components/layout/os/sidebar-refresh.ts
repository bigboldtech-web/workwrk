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
