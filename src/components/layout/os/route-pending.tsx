"use client";

// RoutePendingSignal: rendered by loading.tsx, it flags the shell that a
// route transition is pending. After 200ms the rail's logo dots pulse
// (design-system 5.15); on unmount the pulse stops. Safe outside the shell.

import { useContext, useEffect } from "react";
import { useOsShell } from "./shell-context";

export function RoutePendingSignal() {
  return <Inner />;
}

function Inner() {
  let shell: ReturnType<typeof useOsShell> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shell = useOsShell();
  } catch {
    shell = null;
  }
  const setRoutePending = shell?.setRoutePending;
  useEffect(() => {
    if (!setRoutePending) return;
    const t = window.setTimeout(() => setRoutePending(true), 200);
    return () => {
      window.clearTimeout(t);
      setRoutePending(false);
    };
  }, [setRoutePending]);
  void useContext;
  return null;
}
