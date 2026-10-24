"use client";

// The consent page's Allow, armed only by a person looking at the page
// (src/lib/oauth/allow-guard.ts; final review of the MCP server, security
// M1). Drawn disabled, in the button's existing :disabled style, so with no
// script it stays off; once armed it carries the field the decision asks
// for. Deny is the form's own plain button, never guarded.

import { useEffect, useState } from "react";
import { ARMED_FIELD, ARMED_VALUE, allowGuard } from "@/lib/oauth/allow-guard";

export function GuardedAllow({ label }: { label: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const guard = allowGuard({
      now: () => performance.now(),
      focused: () => document.hasFocus(),
      visible: () => document.visibilityState === "visible",
      setArmed,
    });
    guard.focus();
    const onFocus = () => guard.focus();
    const onBlur = () => guard.blur();
    const onVisibility = () => guard.visibility();
    const onInteract = () => guard.interact();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onInteract, { passive: true });
    window.addEventListener("keydown", onInteract);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onInteract);
      window.removeEventListener("keydown", onInteract);
    };
  }, []);
  return (
    <>
      {armed ? <input type="hidden" name={ARMED_FIELD} value={ARMED_VALUE} /> : null}
      <button type="submit" name="action" value="allow" className="wa-btn wa-btn--primary wa-btn--block" disabled={!armed}>
        {label}
      </button>
    </>
  );
}
