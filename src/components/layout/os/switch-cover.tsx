"use client";

// The boot cover over a workspace switch (spec-account-auth "Switch
// workspace" step 4): the navy boot screen with the pulsing four-dot mark
// and the workspace being opened, between the switch request and the full
// document navigation. Portalled to <body> so nothing of the old tenant's
// frame shows through, and it swallows every pointer and key, so a second
// click cannot start a second switch.

import { createPortal } from "react-dom";
import { Logo } from "@/components/brand/logo";

export function SwitchCover({ orgName }: { orgName: string | null }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={orgName ? `Opening ${orgName}` : "Opening workspace"}
      onKeyDownCapture={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--os-nv900, #1B2537)",
        color: "var(--os-chrome-fg, white)",
        fontFamily: "var(--os-font, Inter, sans-serif)",
      }}
    >
      <Logo width={28} pulsing title="Opening workspace" />
      {orgName ? <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.8)" }}>Opening {orgName}</p> : null}
    </div>,
    document.body,
  );
}
