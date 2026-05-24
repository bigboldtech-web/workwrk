"use client";

// useActiveWorkspace — read the user's currently-selected workspace
// for a given product, kept in sync with the AppWorkspaceNav switcher
// via localStorage. Board pages call this and pass the returned id
// as `?workspace=<id>` to their API + on create.
//
// AppWorkspaceNav writes the key when the user picks a workspace
// from the popover; this hook reads + listens for `storage` events
// so the active page reflects the switch immediately even across
// tabs.

import { useEffect, useState } from "react";

function storageKey(productSlug: string) {
  return `workwrk.activeWorkspace.${productSlug}`;
}

export function useActiveWorkspace(productSlug: string | null | undefined): string | null {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!productSlug) {
      setWorkspaceId(null);
      return;
    }
    const key = storageKey(productSlug);
    // Initial read.
    if (typeof window !== "undefined") {
      setWorkspaceId(window.localStorage.getItem(key));
    }
    // Listen to cross-tab storage events.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setWorkspaceId(e.newValue);
    };
    // Same-tab updates: AppWorkspaceNav doesn't fire `storage`, so
    // we also poll on focus + on a custom event the nav can dispatch.
    const onFocus = () => {
      if (typeof window !== "undefined") {
        setWorkspaceId(window.localStorage.getItem(key));
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("workwrk:workspace-change", onFocus as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("workwrk:workspace-change", onFocus as EventListener);
    };
  }, [productSlug]);

  return workspaceId;
}
